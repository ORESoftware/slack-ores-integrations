# slack-ores-integrations

Source of truth for the ORESoftware Slack app **alex-main-agent** (`A0BMBAMM5NJ`)
in workspace `oresoftware-workspace.slack.com` (`T01B3C83PMK`).

The runtime handler lives in `ai-agent-bridge` (`src/slack_commands*`, binary
`fiducia-slack-command`). This repository owns what the handler is *contracted*
to do: the app configuration for both transports, the ingress audit, and the
checks that catch Slack and the service drifting apart.

## The commands

```text
/x-ores-claude  [task]
/x-ores-chatgpt [task]
```

Two commands, two providers. No aliases. The pre-namespace names —
`/ores-claude`, `/ores-chatgpt`, `/x-claude`, `/x-chatgpt`, `/my-claude`,
`/my-chatgpt` — are retired and fail closed on both transports.

With text, a command dispatches directly. Without text, it opens the scoped task
modal (task, action, repository, write scope, context depth).

## Both transports are supported

The handler serves both at once: the HTTP listener is always mounted, and
`SLACK_SOCKET_MODE=true` additionally opens the socket. One process, either
ingress, no code change to move between them.

**Slack, however, runs one at a time.** With Socket Mode enabled a slash command
that still carries a request URL fails at invocation with `invalid_url`, so the
two configurations are genuinely different documents:

| | Transport | Authentication | Needs a public endpoint |
|---|---|---|---|
| `app/manifest.request-url.yaml` | Signed Request URLs | Per-request HMAC + ±300s replay window + app/team pinning | Yes |
| `app/manifest.socket-mode.yaml` | Socket Mode | Connection-level `xapp-` token only | No |

Both are **generated** from `app/app.json` by `scripts/render_manifest.py`, so
the command set, scopes and descriptions cannot drift between them. Edit the
source, run `make render`, commit both.

Socket Mode's trade is real and worth stating plainly: frames carry no
`X-Slack-Signature` and no timestamp, so neither the HMAC check nor the replay
window applies. The connection token is the whole of the authentication.
Everything downstream — provider agreement, app/team pinning, channel policy,
the run journal, the 2.5s ack deadline — is shared with the Request URL path.

## Why the drift check exists

Slack decides which URL a command posts to. The service decides which provider a
URL means. Those decisions live in different repositories and a disagreement
raises no error — a command just reaches the wrong model, or 404s, or keeps
working under a name you thought was gone.

```sh
make verify BRIDGE=../ai-agent-bridge
```

70 checks across both manifests and the handler: exact command sets, no shared
request URLs, socket manifests carrying no URLs, every manifest URL a registered
route, command and URL resolving to the *same* provider, no retired name
surviving anywhere, both transports reaching the same validation path, and the
ingress regression guards still in place. No dependencies, no network — safe to
run in CI on both repositories.

## Layout

| Path | What it holds |
|---|---|
| `app/app.json` | The single source. Edit this. |
| `app/manifest.request-url.yaml` | Generated. Signed Request URL configuration. |
| `app/manifest.socket-mode.yaml` | Generated. Socket Mode configuration. |
| `scripts/render_manifest.py` | Renders both; `--check` fails on a stale render. |
| `scripts/verify_contract.py` | Manifests ↔ handler drift check. |
| `scripts/reconcile-manifest.sh` | Push a chosen transport's manifest to Slack. |
| `audit/` | Ingress security audit and the live-configuration findings. |
| `docs/runbook.md` | Deploy, switch transports, verify, roll back. |
| `tests/live-smoke.md` | The manual pass to run in `#oresoftware`. |

## Related

- `ores/ai-agent-bridge` — handler, tests, `docs/slack-*.md`.
