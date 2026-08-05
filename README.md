# slack-ores-integrations

Canonical, config-driven Slack slash-command integration for the `alex-main-agent` Slack app
(`A0BMBAMM5NJ`) in workspace `T01B3C83PMK`.

This repository owns the reviewed Slack manifest, local Bolt/Slack CLI implementation, compatibility
tests, and source artifacts. Production signed ingress remains pinned to
`ORESoftware/ai-agent-bridge.rs`; Kubernetes deployment and secret references remain owned by
`ORESoftware/k8s-cluster`. See [provenance and deployment boundaries](docs/provenance-and-deployment.md).

## Commands

| Command | Provider | Profile |
| --- | --- | --- |
| `/x-claude` | Anthropic | X |
| `/x-chatgpt` | OpenAI | X |
| `/ores-claude` | Anthropic | ORES engineering |
| `/ores-chatgpt` | OpenAI | ORES engineering |
| `/my-claude` | Anthropic | Personal |
| `/my-chatgpt` | OpenAI | Personal |

Every command accepts:

- `--public` to post the final answer in-channel; responses are ephemeral by default.
- `--model MODEL` to override the provider's configured model for one invocation.
- `--help` to show usage without calling a provider.
- `--` to stop parsing options when the prompt itself starts with `--`.

Example:

```text
/ores-chatgpt --public --model gpt-5.6 audit this deployment plan for failure modes
```

By default, the app supplies up to five recent human-authored messages from the current Slack
conversation as background context. Authors, Slack IDs, bot messages, system events, and recognizable
credential formats are removed before this context is sent to a provider. The current command is kept
separate, and history is explicitly marked as untrusted quoted data. Retrieval follows at most
`SLACK_CONTEXT_MAX_PAGES` cursors and applies `SLACK_CONTEXT_FETCH_TIMEOUT_MS` to each page. Set
`SLACK_CONTEXT_MESSAGE_COUNT=0` to disable this behavior. See
[bounded Slack context retrieval](docs/slack-context-retrieval.md).

The current command text is also scanned before provider processing. Recognizable provider, Slack,
GitHub, bearer, and configured environment credentials are replaced with redaction markers, and the
Slack response states when this occurred. See
[credential-like command text](docs/prompt-secret-redaction.md).

## Local setup

The app uses Slack Socket Mode, so local development does not require a public request URL.

```bash
cd ~/codes/ores/slack-ores-integrations
cp .env.example .env
npm install
```

Set `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, and at least one provider API key in `.env`.

Install and authenticate the Slack CLI if needed:

```bash
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
slack login
```

Link this project to the existing app and workspace, validate the manifest, then run it:

```bash
slack app link --app A0BMBAMM5NJ --team T01B3C83PMK
slack manifest validate --app A0BMBAMM5NJ
slack run --app A0BMBAMM5NJ --team T01B3C83PMK
```

Review the manifest diff before allowing the CLI to update the existing app configuration.

## App tokens and scopes

The manifest requests these bot scopes:

- `commands`
- `chat:write`
- `channels:history`
- `groups:history`
- `im:history`
- `mpim:history`

Socket Mode also requires an app-level token with `connections:write`. Do not commit any token. The
history scopes are used only to load bounded context for conversations the bot can access. After
adding these scopes to an existing installation, reinstall the app so Slack grants them.

## Add or change a command

1. Add or update one entry in `config/commands.json`.
2. Reuse or add a profile in `config/profiles.json` and `agents/`.
3. Run `npm run manifest:generate`.
4. Update runtime/provenance pins only when an immutable source or production relationship changes.
5. Run `npm run test:all`.
6. Run `slack manifest validate` and apply the reviewed manifest to the linked app.

The runtime registers every command from the same JSON file used to generate `manifest.json`.
`npm run provenance:check` and the runtime-ownership tests verify that the six aliases match the
executable configuration and two canonical signed ingress routes.

## HTTP mode

For a deployed HTTP receiver, set:

```dotenv
SLACK_SOCKET_MODE=false
SLACK_SIGNING_SECRET=...
PORT=3000
```

Then configure each slash-command request URL in Slack. Socket Mode remains the default and expected
path for `slack run`; production signed-ingress deployment is managed outside this repository.

## Safety and operations

- Provider calls time out after `AGENT_TIMEOUT_MS`.
- Optional provider base URLs must be HTTP(S), cannot embed credentials, and are validated before startup.
- Prompt and response sizes are capped.
- Active and queued work are bounded by fair global and per-user admission controls.
- Queued commands expire after `MAX_QUEUE_WAIT_MS`.
- Slack retries are deduplicated by `trigger_id` with a bounded TTL map.
- Shutdown rejects new commands and drains in-flight work for `SHUTDOWN_GRACE_MS`.
- Optional Slack user/channel and provider-model allowlists are supported.
- Public responses can be disabled with `ALLOW_PUBLIC_RESPONSES=false`.
- Slack team, channel, and user IDs are excluded from provider prompts by default.
- Recent context is redacted, identifier-free, character-bounded, TTL/LRU-cached, workspace-isolated,
  page-bounded, deadline-bounded, and supplied as untrusted context.
- Context lookup failures degrade to a context-free provider request rather than failing the command.
- Credential-like values in the current command are redacted before provider processing.
- API errors and structured logs redact known token formats and configured secrets.
- Generated Slack mentions are neutralized; model-generated link/media unfurls are disabled.
- OpenAI Responses requests set `store: false`.
- Configuration rejects duplicate commands, unknown fields, invalid values, and profile path traversal.
- Direct npm dependencies are exact-version pinned and CI enforces that policy.
- GitHub Actions are pinned to immutable commit SHAs.
- Source, production runtime, and GitOps responsibilities are recorded in reviewed configuration and
  validated in CI.

## Tests

Unit tests live in `test/`.

CLI E2E tests live in `tests/e2e/cli/`. They execute all six commands through the real parser, access
checks, router, admission controls, response chunking, Slack context retrieval, and Slack response
handler with deterministic provider and Slack API doubles.

Browser E2E tests live in `tests/e2e/browser/` and drive a local command console through:

- Playwright
- Puppeteer
- Selenium WebDriver

The browser suites cover private/public command paths, multi-page Slack context, model overrides,
help, provider failures, credential redaction, output-injection safety, strict security headers, and
public-response policy enforcement.

Run the suites with:

```bash
npm run dependencies:check
npm run manifest:check
npm run provenance:check
npm run check
npm run lint
npm run test:unit
npm run test:e2e:cli
E2E_BROWSER_PATH=/usr/bin/chromium npm run test:e2e:browser
npm run test:all
```

The local E2E harness does not call live AI providers or modify the Slack workspace. Live Slack
validation remains a separate approved smoke test using the linked app and real workspace credentials.

## GitHub Actions and artifacts

CI runs for pull requests, pushes to `main`, matching `v*` tags, and manual workflow dispatches. It
includes:

- unit, CLI E2E, manifest, provenance, syntax, and lint checks on Node.js 22 and 24;
- independent Playwright, Puppeteer, and Selenium jobs;
- a high-severity production dependency audit;
- browser screenshots and Playwright traces as workflow artifacts; and
- commit-addressed source archives, standalone Slack manifests, build metadata, and SHA-256 checksums
  retained for 30 days.

Generate the same source artifact set locally with:

```bash
npm run artifacts:build
sha256sum -c dist/SHA256SUMS
```

See [source artifact publication](docs/artifact-publication.md) for contents and verification steps.
A full-history Git bundle is intentionally not published because historical commits have a wider
secret-exposure surface than one reviewed source tree.

## Planning and evidence

Linear and GitHub planning records should carry immutable evidence—PR numbers, merge SHAs, workflow
runs, artifact names, checksums, and GitOps revisions—without secrets or captured Slack content. See
[Linear and GitHub Project tracking](docs/work-tracking.md).

Dependabot is configured for npm and GitHub Actions updates. Workflow policy tests reject mutable
action tags.

A full transitive `package-lock.json` should be generated and committed from a trusted npm registry
before production deployment; do not synthesize one without registry metadata.
