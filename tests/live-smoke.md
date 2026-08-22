# Live smoke pass

Run in `#oresoftware` after a reinstall. Keep `SLACK_COMMAND_DRY_RUN=true` for
the first pass — every step below is satisfied by a dry run.

Note the transport you are testing. Steps marked **[URL]** apply only to the
Request URL transport; **[SOCKET]** only to Socket Mode. Everything else is
shared, and *should behave identically on both* — that equivalence is the point.

## Autocomplete

Type `/x-ores-` in the composer.

- [ ] `/x-ores-claude` and `/x-ores-chatgpt` both appear.
- [ ] Type `/ores-`, `/x-c`, `/my-` — no retired name appears. If one does, the
      old command was never deleted; `apps.manifest.update` only adds and
      updates.
- [ ] **[SOCKET]** No command fails with `invalid_url`. That means a stale
      request URL is still attached — delete it on the Slash Commands page.

## Direct dispatch

- [ ] `/x-ores-claude summarise the open DEN issues` → ephemeral
      `Accepted Claude run \`ores-…\`` within about a second.
- [ ] A `:test_tube: *Dry-run Claude task*` message follows in-channel.
- [ ] `/x-ores-chatgpt summarise the open DEN issues` → the reply says
      **ChatGPT**, not Claude. This is the check that catches a manifest whose
      two commands point at one URL.

## The modal

- [ ] `/x-ores-claude` with no text opens the scoped task modal.
- [ ] Title reads `Run Claude`; `/x-ores-chatgpt` bare reads `Run ChatGPT`.
- [ ] Write-scope options do not exceed the channel's policy — a read-only
      channel must not offer `draft_pull_request`.
- [ ] Submitting dispatches and the modal closes without an error banner.

## Duplicates and policy

- [ ] Re-run the identical command with the same text immediately. The second
      reply is `Run \`ores-…\` was already accepted.` — not a capacity error.
- [ ] Run `/x-ores-claude test` from a channel outside the reviewed registry.
      Expect `This channel or user is not authorized.` Fix the registry if that
      channel should be allowed; do not relax the policy.

## Transport-specific

- [ ] **[URL]** `curl -fsS https://api.fiducia.cloud/readyz` returns 200.
- [ ] **[URL]** A replayed capture with a timestamp older than 300s is refused
      with `Request authentication failed.`
- [ ] **[URL]** A body tampered after signing is refused the same way.
- [ ] **[SOCKET]** Restart the handler mid-session. Slack recycles connections
      every few minutes anyway; commands should resume without intervention.
- [ ] **[SOCKET]** Stop the handler entirely and run a command. Slack reports a
      dispatch failure rather than hanging — there is no queue behind the socket.

## Cross-transport equivalence

Worth doing once, after both transports are working. Run the same command text
on each and compare:

- [ ] Same ephemeral acknowledgement wording.
- [ ] Same `run_id`? **No — and that is correct.** The run key includes the
      Slack `trigger_id`, which differs per invocation. What must match is the
      provider, the channel, the write scope, and the shape of the in-channel
      post.
- [ ] The modal payload is identical on both.

## Afterwards

- [ ] `SLACK_COMMAND_STATE_DIR` has one file per accepted run, mode `0600`.
- [ ] Logs show no `error_code` longer than 64 characters and no newline inside
      a log field.
