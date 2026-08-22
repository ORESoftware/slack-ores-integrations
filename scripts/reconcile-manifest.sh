#!/usr/bin/env bash
# Apply app/manifest.yaml to the Slack app. Reads credentials from the
# environment only — nothing is accepted on the command line, where it would
# land in shell history and process listings.
#
#   SLACK_CONFIG_TOKEN=xoxe-…  scripts/reconcile-manifest.sh [--dry-run]
#
# Get a configuration token at https://api.slack.com/apps → "Your app
# configuration tokens". They expire in 12 hours; that is deliberate.
set -euo pipefail

APP_ID="${SLACK_APP_ID:-A0BMBAMM5NJ}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/app/manifest.yaml"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

for tool in curl jq python3; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

: "${SLACK_CONFIG_TOKEN:?set SLACK_CONFIG_TOKEN (xoxe-…) in the environment}"

echo "==> contract check"
python3 "$ROOT/scripts/verify_contract.py" --bridge "${BRIDGE:-$ROOT/../ai-agent-bridge}"

echo "==> converting manifest to JSON"
manifest_json="$(python3 -c '
import json, sys, yaml
print(json.dumps(yaml.safe_load(open(sys.argv[1]))))
' "$MANIFEST")"

echo "==> validating against Slack"
validate="$(curl -sS -X POST https://slack.com/api/apps.manifest.validate \
  -H "Authorization: Bearer $SLACK_CONFIG_TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data "$(jq -n --arg app_id "$APP_ID" --arg manifest "$manifest_json" \
            '{app_id:$app_id, manifest:$manifest}')")"
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

echo "==> applying to app $APP_ID"
update="$(curl -sS -X POST https://slack.com/api/apps.manifest.update \
  -H "Authorization: Bearer $SLACK_CONFIG_TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data "$(jq -n --arg app_id "$APP_ID" --arg manifest "$manifest_json" \
            '{app_id:$app_id, manifest:$manifest}')")"
jq '.' <<<"$update"
[[ "$(jq -r '.ok' <<<"$update")" == "true" ]] || exit 1

cat <<'NOTE'

Applied. Two things Slack will not do for you:

  1. Reinstall the app to the workspace. Slash-command changes are inert until
     you do, so autocomplete will still show the old set.
  2. Delete commands you removed from the manifest. apps.manifest.update adds
     and updates; it does not prune. Check the app's Slash Commands page and
     delete any retired name by hand, then re-run scripts/verify_contract.py
     against what is actually installed.

NOTE
