# Runbook — alex-main-agent slash commands

| | |
|---|---|
| App | `alex-main-agent` (`A0BMBAMM5NJ`) |
| Workspace | `oresoftware-workspace.slack.com` (`T01B3C83PMK`) |
| Handler | `fiducia-slack-command` in `ai-agent-bridge` |
| Commands | `/x-ores-claude`, `/x-ores-chatgpt` |
| Interactivity URL | `https://api.fiducia.cloud/slack/interactions` |

## Order of operations

Reconcile the manifest **after** the handler is deployed, never before. Slack
begins delivering to a request URL the moment the manifest names it; if the
route is not yet registered, users get dispatch failures in the composer.

1. Deploy the handler with the `/x-ores-*` routes.
2. `curl -fsS https://api.fiducia.cloud/readyz` — must be ready.
3. `make verify BRIDGE=../ai-agent-bridge` — must be 39/39.
4. `scripts/reconcile-manifest.sh` — applies `app/manifest.yaml`.
5. Reinstall the app to the workspace. Slash-command changes do not take effect
   until reinstall.
6. Work through `tests/live-smoke.md` in `#oresoftware`.

## Required environment

```sh
SLACK_SIGNING_SECRET=…            # required
SLACK_BOT_TOKEN=xoxb-…            # required
SLACK_EXPECTED_APP_ID=A0BMBAMM5NJ # required
SLACK_EXPECTED_TEAM_ID=T01B3C83PMK# required
SLACK_PROJECT_REGISTRY_PATH=/…    # required, absolute
SLACK_COMMAND_STATE_DIR=/var/lib/slack-command/runs
SLACK_COMMAND_DRY_RUN=true        # defaults true — flip deliberately
```

`SLACK_EXPECTED_APP_ID` and `SLACK_EXPECTED_TEAM_ID` are **not optional**, and
binding `127.0.0.1` no longer waives them. That exemption used to exist and it
was backwards: production terminates TLS in a same-host proxy and forwards to
loopback, so the internet-facing deployment was the one running unpinned. The
waiver is now `SLACK_ALLOW_UNPINNED_IDENTITY=true`, for local test harnesses
only. If the process refuses to start complaining about these two variables,
set them — do not set the waiver.

`SLACK_COMMAND_DRY_RUN` defaults to **true**. A dry run posts a `:test_tube:`
message to the channel and writes nothing to the coordinator, the bridge,
Linear, or GitHub. Confirm you see real workflow IDs before believing a run
happened.

## Verifying without touching the workspace

```sh
make verify BRIDGE=../ai-agent-bridge   # manifest <-> handler contract
cd ../ai-agent-bridge && cargo test --locked slack
```

The contract check needs no toolchain and no network — it is the one to run in
CI on both repositories.

## Rollback

1. Disable both slash commands in the Slack app, or blank their request URLs.
   This stops delivery immediately without a redeploy.
2. Redeploy the previous handler revision.
3. Restore the previous `app/manifest.yaml` and reinstall.

Rolling the handler back without rolling the manifest back leaves Slack pointing
at routes that no longer exist — users see dispatch errors rather than a clean
"command not found".

## Reading a failure

| Symptom | Cause |
|---|---|
| Command missing from autocomplete | Manifest applied but app not reinstalled |
| `dispatch_failed` / timeout in Slack | Endpoint unreachable, or the 3 s ack was missed |
| `Request authentication failed.` | Signing secret mismatch, or clock skew past ±300 s |
| `403` with no body on interactions | `api_app_id` or `team_id` did not match the pinned pair |
| `This channel or user is not authorized.` | Channel is not in the reviewed registry — fix the registry, not the policy |
| `The agent queue is at capacity.` | `SLACK_COMMAND_MAX_CONCURRENT_RUNS` saturated. A *duplicate* now reports "already accepted" instead, so this means genuinely new load |
| `The durable run journal is unavailable.` | `SLACK_COMMAND_STATE_DIR` unwritable or full |
