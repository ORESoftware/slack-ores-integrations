# Runbook — alex-main-agent slash commands

| | |
|---|---|
| App | `alex-main-agent` (`A0BMBAMM5NJ`) |
| Workspace | `oresoftware-workspace.slack.com` (`T01B3C83PMK`) |
| Handler | `fiducia-slack-command` in `ai-agent-bridge` |
| Commands | `/x-ores-claude`, `/x-ores-chatgpt` |
| Transports | Both. See [transports.md](transports.md). |

## Current state, as observed 2026-08-22

Read this before assuming anything works.

- The app has **zero slash commands registered**. Neither `/x-ores-*` nor any
  retired name is installed. The manifest in the repository was never applied.
- **Socket Mode is enabled** on the app, and Interactivity reports "Socket Mode
  is enabled. You won't need to specify a Request URL."
- `https://api.fiducia.cloud` returns **Cloudflare 522** — DNS and the CDN are
  configured, but no origin is answering. The Request URL transport has nothing
  behind it.

So the only transport that can work today is Socket Mode, and it needs the two
commands created first.

## Bringing it up on Socket Mode

1. Create an app-level token with `connections:write` (Basic Information →
   App-Level Tokens) if one does not exist. The app already has `all-main` and
   `Default alex-main-agent App Token`.
2. Configure and start the handler:
   ```sh
   SLACK_SOCKET_MODE=true
   SLACK_APP_TOKEN=xapp-…
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_SIGNING_SECRET=…              # still required; HTTP routes stay mounted
   SLACK_EXPECTED_APP_ID=A0BMBAMM5NJ
   SLACK_EXPECTED_TEAM_ID=T01B3C83PMK
   SLACK_PROJECT_REGISTRY_PATH=/…      # absolute
   SLACK_COMMAND_DRY_RUN=true
   ```
3. `SLACK_CONFIG_TOKEN=xoxe-… scripts/reconcile-manifest.sh socket-mode`
4. Reinstall the app to the workspace.
5. Work through [`tests/live-smoke.md`](../tests/live-smoke.md).

## Bringing up the Request URL transport

Do not apply that manifest until the endpoint answers — Slack starts delivering
the moment the URL is named, and every command fails in the composer until
something is listening.

1. Deploy the handler behind `api.fiducia.cloud`. Fix the 522 first.
2. `curl -fsS https://api.fiducia.cloud/readyz` must return 200.
3. `SLACK_CONFIG_TOKEN=xoxe-… scripts/reconcile-manifest.sh request-url`
   (the script re-checks `/readyz` and makes you confirm if it is not 200)
4. Reinstall the app.
5. Delete any command still holding a stale URL by hand — `apps.manifest.update`
   does not prune.

## Required environment

```sh
SLACK_SIGNING_SECRET=…             # required on both transports
SLACK_BOT_TOKEN=xoxb-…             # required
SLACK_EXPECTED_APP_ID=A0BMBAMM5NJ  # required
SLACK_EXPECTED_TEAM_ID=T01B3C83PMK # required
SLACK_PROJECT_REGISTRY_PATH=/…     # required, absolute
SLACK_COMMAND_STATE_DIR=/var/lib/slack-command/runs
SLACK_COMMAND_DRY_RUN=true         # defaults true — flip deliberately
SLACK_SOCKET_MODE=false            # true additionally opens the socket
SLACK_APP_TOKEN=xapp-…             # required when SLACK_SOCKET_MODE=true
```

`SLACK_EXPECTED_APP_ID` and `SLACK_EXPECTED_TEAM_ID` are **not optional**, and
binding `127.0.0.1` no longer waives them. That exemption used to exist and it
was backwards: production terminates TLS in a same-host proxy and forwards to
loopback, so the internet-facing deployment was the one running unpinned. The
waiver is now `SLACK_ALLOW_UNPINNED_IDENTITY=true`, for local test harnesses
only. If startup refuses over these two variables, set them — not the waiver.

`SLACK_COMMAND_DRY_RUN` defaults to **true**. A dry run posts a `:test_tube:`
message and writes nothing to the coordinator, bridge, Linear, or GitHub.
Confirm you see real workflow IDs before believing a run happened.

## Verifying without touching the workspace

```sh
make verify BRIDGE=../ai-agent-bridge   # 70 checks, both transports, no deps
cd ../ai-agent-bridge && cargo test --locked slack
```

`make verify` runs `render --check` first, so a manifest edited by hand instead
of through `app/app.json` fails there rather than silently shipping.

## Rollback

1. Disable both slash commands in the Slack app, or blank their request URLs.
   Stops delivery immediately, no redeploy.
2. Redeploy the previous handler revision.
3. Restore the previous `app/app.json`, `make render`, reconcile, reinstall.

Rolling the handler back without the manifest leaves Slack pointing at routes
that no longer exist — dispatch errors rather than a clean "command not found".

## Reading a failure

| Symptom | Cause |
|---|---|
| Command missing from autocomplete | Manifest applied but app not reinstalled |
| `invalid_url` | A command still carries a request URL while Socket Mode is on |
| `dispatch_failed` / timeout | Endpoint unreachable, or the 3s ack was missed |
| Cloudflare 522 at the endpoint | CDN is up, origin is not — the handler is not deployed |
| `Request authentication failed.` | Signing secret mismatch, or clock skew past ±300s |
| Socket connects then commands vanish | `Provider::from_command` is stale; the frame is dropped with no ack. `make verify` catches this |
| `403` with no body on interactions | `api_app_id` or `team_id` did not match the pinned pair |
| `This channel or user is not authorized.` | Channel not in the reviewed registry — fix the registry, not the policy |
| `The agent queue is at capacity.` | `SLACK_COMMAND_MAX_CONCURRENT_RUNS` saturated. A *duplicate* now reports "already accepted", so this means genuinely new load |
| `The durable run journal is unavailable.` | `SLACK_COMMAND_STATE_DIR` unwritable or full |
