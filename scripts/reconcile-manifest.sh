#!/usr/bin/env bash
# Apply one transport's manifest to the Slack app.
#
#   SLACK_CONFIG_TOKEN=xoxe-… scripts/reconcile-manifest.sh request-url
#   SLACK_CONFIG_TOKEN=xoxe-… scripts/reconcile-manifest.sh socket-mode [--dry-run]
#
# Credentials are read from the environment only, never from arguments, where
# they would land in shell history and process listings. Configuration tokens
# come from https://api.slack.com/apps -> "Your app configuration tokens" and
# expire in 12 hours; that is deliberate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="${SLACK_APP_ID:-A0BMBAMM5NJ}"
BRIDGE="${BRIDGE:-$ROOT/../ai-agent-bridge}"

TRANSPORT="${1:-}"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1

case "$TRANSPORT" in
  request-url|socket-mode) ;;
  *)
    cat >&2 <<USAGE
usage: $0 <request-url|socket-mode> [--dry-run]

  request-url   Signed Request URLs. Per-request HMAC and a bounded replay
                window. Requires the public endpoint to already be answering.
  socket-mode   Outbound WebSocket. No public endpoint. No per-request
                signature -- the connection token is the authentication.

See docs/transports.md before switching.
USAGE
    exit 2 ;;
esac

MANIFEST="$ROOT/app/manifest.$TRANSPORT.yaml"

for tool in curl jq python3; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done
python3 -c 'import yaml' 2>/dev/null || { echo "missing python module: pyyaml (pip install pyyaml)" >&2; exit 1; }
: "${SLACK_CONFIG_TOKEN:?set SLACK_CONFIG_TOKEN (xoxe-…) in the environment}"

echo "==> renders are current"
python3 "$ROOT/scripts/render_manifest.py" --check

echo "==> contract check"
python3 "$ROOT/scripts/verify_contract.py" --bridge "$BRIDGE"

if [[ "$TRANSPORT" == "request-url" ]]; then
  base="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["request_url_base"])' "$ROOT/app/app.json")"
  echo "==> endpoint reachability ($base/readyz)"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "$base/readyz" || echo 000)"
  if [[ "$code" != "200" ]]; then
    cat >&2 <<WARN

  $base/readyz returned $code, not 200.

  Slack begins delivering to a request URL the moment this manifest names it.
  If nothing answers, every command fails in the composer. Deploy the handler
  first, or apply the socket-mode manifest instead.

WARN
    read -r -p "  Apply anyway? [y/N] " reply
    [[ "$reply" == [yY] ]] || exit 1
  else
    echo "    endpoint is ready"
  fi
fi

echo "==> converting $TRANSPORT manifest to JSON"
manifest_json="$(python3 -c '
import json, sys, yaml
print(json.dumps(yaml.safe_load(open(sys.argv[1]))))
' "$MANIFEST")"

payload="$(jq -n --arg app_id "$APP_ID" --arg manifest "$manifest_json" \
           '{app_id:$app_id, manifest:$manifest}')"

echo "==> validating against Slack"
validate="$(curl -sS -X POST https://slack.com/api/apps.manifest.validate \
  -H "Authorization: Bearer $SLACK_CONFIG_TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' --data "$payload")"
if [[ "$(jq -r '.ok' <<<"$validate")" != "true" ]]; then
  echo "manifest rejected by Slack:" >&2
  jq '.' <<<"$validate" >&2
  exit 1
fi
echo "    manifest is valid"

if (( DRY_RUN )); then
  echo "==> --dry-run: stopping before update"
  exit 0
fi

echo "==> applying $TRANSPORT to app $APP_ID"
update="$(curl -sS -X POST https://slack.com/api/apps.manifest.update \
  -H "Authorization: Bearer $SLACK_CONFIG_TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' --data "$payload")"
jq '.' <<<"$update"
[[ "$(jq -r '.ok' <<<"$update")" == "true" ]] || exit 1

cat <<NOTE

Applied. Three things Slack will not do for you:

  1. Reinstall the app to the workspace. Slash-command changes are inert until
     you do, so autocomplete will still show the old set.

  2. Delete commands you removed. apps.manifest.update adds and updates; it does
     not prune. Open the app's Slash Commands page and delete any retired name
     by hand.

  3. Strip a request URL from a command when switching to socket-mode. A command
     still holding a URL while Socket Mode is on fails with 'invalid_url', which
     looks exactly like a broken deployment. Check that page too.

Then work through tests/live-smoke.md in #oresoftware.
NOTE
