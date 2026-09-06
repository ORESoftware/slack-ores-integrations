# Commands

```text
/x-ores-claude  [task]
/x-ores-chatgpt [task]
```

| Command | Provider | Request URL (Request URL transport only) |
|---|---|---|
| `/x-ores-claude` | Claude | `https://api.fiducia.cloud/slack/commands/x-ores-claude` |
| `/x-ores-chatgpt` | ChatGPT | `https://api.fiducia.cloud/slack/commands/x-ores-chatgpt` |

Interactivity (Request URL transport): `https://api.fiducia.cloud/slack/interactions`

Under Socket Mode the commands are identical and carry no URLs — see
[transports.md](transports.md).

## One command, one URL

On the Request URL transport the service recovers the provider from the path the
request arrived on, then re-derives it from the signed `command` field and
refuses the request unless the two agree. That is why the two commands must not
share a request URL: a shared URL makes the path ambiguous and the disagreement
check meaningless.

`scripts/verify_contract.py` enforces this. It is not a style rule.

## Retired names

`/ores-claude` · `/ores-chatgpt` · `/x-claude` · `/x-chatgpt` · `/my-claude` ·
`/my-chatgpt`

Six aliases over the same two endpoints. They are gone: no provider arm, no
registered route, and an explicit negative test for each. A stale manifest
produces a 404 rather than a silent success under an old name.

Slack's `apps.manifest.update` does not delete commands that vanish from a
manifest. After reconciling, open the app's Slash Commands page and confirm no
retired name is still installed.

## Scopes

`commands` · `chat:write` · `channels:history` · `groups:history` ·
`usergroups:read`

`usergroups:read` backs the channel authorization check. Without it the policy
resolve fails and every command is refused.
