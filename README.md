# slack-ores-integrations

Source of truth for the ORESoftware Slack app **alex-main-agent** (`A0BMBAMM5NJ`)
in workspace `oresoftware-workspace.slack.com` (`T01B3C83PMK`).

The runtime handler lives in `ai-agent-bridge` (`src/slack_commands*`, binary
`fiducia-slack-command`). This repository owns the parts that decide *what the
handler is contracted to do*: the app manifest, the audit of the ingress, and the
checks that catch the two repositories drifting apart.

## The commands

```text
/x-ores-claude  [task]
/x-ores-chatgpt [task]
```

Two commands, two request URLs, two providers. No aliases.

Every pre-namespace name — `/ores-claude`, `/ores-chatgpt`, `/x-claude`,
`/x-chatgpt`, `/my-claude`, `/my-chatgpt` — is retired. They are rejected at the
envelope and their request URLs are no longer registered, so a stale manifest
fails closed instead of quietly reaching a provider under an old name.

With text, a command dispatches directly. Without text, it opens the scoped task
modal (task, action, repository, write scope, context depth).

## Why the drift check exists

Slack decides which URL a command posts to. The service decides which provider a
URL means. Those two decisions live in different repositories and nothing at
runtime reports a disagreement — a command just reaches the wrong model, or
404s, or keeps working under a name you thought was gone.

`scripts/verify_contract.py` reads both sides and fails when they disagree:

```sh
make verify BRIDGE=../ai-agent-bridge
```

It checks that the manifest declares exactly the reviewed commands, that no two
commands share a request URL, that every manifest URL is a registered route,
that a command and its URL resolve to the *same* provider, that no retired name
survives on either side, and that the ingress regression guards are still in the
handler. 39 checks; all of them fail loudly rather than warn.

## Layout

| Path | What it holds |
|---|---|
| `app/manifest.yaml` | The reviewed app manifest. Reconcile Slack to this file, never the reverse. |
| `scripts/verify_contract.py` | Manifest ↔ handler drift check. Runs with no dependencies. |
| `scripts/reconcile-manifest.sh` | Push `app/manifest.yaml` to the Slack app and reinstall. |
| `audit/` | The ingress security audit and what came out of it. |
| `docs/runbook.md` | Deploying, verifying in the workspace, and rolling back. |
| `tests/live-smoke.md` | The manual pass to run in `#oresoftware` after a reinstall. |

## Related

- `ores/ai-agent-bridge` — the handler, its tests, and `docs/slack-*.md`.
- `ores/ai-agent-bridge/docs/slack-ingress-security.md` — the ingress contract
  the audit in this repository was written against.
