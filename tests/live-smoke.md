# Live smoke pass

Run in `#oresoftware` after a reinstall. Keep `SLACK_COMMAND_DRY_RUN=true` for
the first pass — every step below is satisfied by a dry run.

## Autocomplete

Type `/x-ores-` in the composer.

- [ ] `/x-ores-claude` and `/x-ores-chatgpt` both appear.
- [ ] Type `/ores-`, `/x-c`, `/my-` — no retired name appears. If one does, the
      old command was never deleted from the app; the manifest reconcile only
      adds and updates.

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

## Afterwards

- [ ] `SLACK_COMMAND_STATE_DIR` has one file per accepted run, mode `0600`.
- [ ] Logs show no `error_code` longer than 64 characters and no newline inside
      a log field.
