# Commands

```text
/x-ores-claude  [task]
/x-ores-chatgpt [task]
```

| Command | Request URL | Provider |
|---|---|---|
| `/x-ores-claude` | `https://api.fiducia.cloud/slack/commands/x-ores-claude` | Claude |
| `/x-ores-chatgpt` | `https://api.fiducia.cloud/slack/commands/x-ores-chatgpt` | ChatGPT |

Interactivity: `https://api.fiducia.cloud/slack/interactions`

## One command, one URL

The service recovers the provider from the path the request arrived on, then
re-derives it from the signed `command` field and refuses the request unless the
two agree. That is why the two commands must not share a request URL: a shared
URL would make the path ambiguous and the disagreement check meaningless.

`scripts/verify_contract.py` enforces this. It is not a style rule.

## Retired names

`/ores-claude` · `/ores-chatgpt` · `/x-claude` · `/x-chatgpt` · `/my-claude` ·
`/my-chatgpt`

These were six aliases over the same two endpoints. They are gone: rejected at
the envelope, and their request URLs are no longer registered, so a stale
manifest produces a 404 rather than a silent success under an old name. The
handler carries explicit negative tests for each one.

Slack's `apps.manifest.update` does not delete commands that vanish from a
manifest. After reconciling, open the app's Slash Commands page and confirm no
retired name is still installed.

## Scopes

`commands` · `chat:write` · `channels:history` · `groups:history` ·
`usergroups:read`

`usergroups:read` backs the channel authorization check. Without it the policy
resolve fails and every command is refused.
