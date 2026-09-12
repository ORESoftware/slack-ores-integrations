# Transports

The handler supports both. Slack runs one at a time. This page is how to pick,
and how to move.

## What the handler does

`fiducia-slack-command` always mounts the HTTP listener — health, readiness, and
both `/slack/commands/x-ores-*` routes. Setting `SLACK_SOCKET_MODE=true`
*additionally* opens an outbound WebSocket to Slack. The two are additive in one
process, so a deployment can move between them without a code change or a
rebuild.

Both ingresses converge immediately. A socket frame is re-encoded into the exact
form encoding the HTTP path validates, then handed to the same
`validate_slash_envelope` and the same `SlashCommand::parse`. Socket Mode
therefore cannot accept a command the Request URL path would reject.

## Where they differ

| | Request URL | Socket Mode |
|---|---|---|
| Per-request signature | `v0` HMAC-SHA256, constant-time compare | none |
| Replay window | ±300s on `X-Slack-Request-Timestamp` | none |
| Provider derived from | the route path, then cross-checked against the signed `command` field | the `command` field only |
| App/team pinning | yes | yes |
| Channel policy, run journal, 2.5s ack | yes | yes |
| Public endpoint required | yes | no |
| Token | signing secret + `xoxb-` bot token | `xapp-` app token + `xoxb-` bot token |

Socket Mode's authentication is the connection, not the message. That is a real
reduction in per-request assurance, not a formality — it is why the handler
keeps it opt-in and why the manifest for it is a separate document.

The one structural asymmetry: on HTTP, the provider comes from the route and is
then re-derived from the signed `command` field, with a mismatch refused. A
socket frame has no path, so there is nothing to cross-check against. A stale
`Provider::from_command` disables Socket Mode silently — the frame is dropped
with no ack — while HTTP would still route. `make verify` guards this by
requiring the command map and the route table to agree.

## Choosing

**Socket Mode** when there is no public endpoint, when you are iterating
locally, or when inbound ingress is not worth standing up yet. It is the right
answer for a pilot.

**Request URLs** for the reviewed production posture. Per-request
authentication and a bounded replay window are the difference, and they matter
once the app can dispatch real work.

## Switching

Both directions are the same three steps. Order matters in opposite ways.

### To Request URLs

1. Deploy the handler and confirm `GET /readyz` answers over the public
   hostname. Do this **first** — Slack begins delivering the moment the manifest
   names a URL.
2. `BRIDGE=../ai-agent-bridge scripts/reconcile-manifest.sh request-url`
3. Reinstall the app. Slash-command changes are inert until you do.

Leave `SLACK_SOCKET_MODE=true` on the handler during the cutover if you like —
the socket simply stops receiving once Slack switches, and the HTTP routes were
already mounted.

### To Socket Mode

1. Set `SLACK_APP_TOKEN=xapp-…` and `SLACK_SOCKET_MODE=true`, and restart the
   handler **first**. It validates the token shape at startup rather than at
   connect time, so a bad token fails loudly and immediately.
2. `BRIDGE=../ai-agent-bridge scripts/reconcile-manifest.sh socket-mode`
3. Reinstall the app.

Slack does not remove a request URL from a command when you apply a Socket Mode
manifest — `apps.manifest.update` adds and updates, it does not prune. A command
left holding a URL while Socket Mode is on fails with `invalid_url`, which looks
exactly like a broken deployment. Check the Slash Commands page by hand after
the switch.

## App-level token

Socket Mode needs an app-level token with `connections:write`, created under
Basic Information → App-Level Tokens. It is not the bot token, and the handler
rejects a `xoxb-` value in `SLACK_APP_TOKEN` at startup rather than letting it
fail at connect.
