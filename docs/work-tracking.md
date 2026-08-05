# Linear and GitHub Project tracking

Work for `alex-main-agent` is tracked in both Linear and GitHub. The two systems have different
responsibilities and must carry the same immutable evidence rather than duplicating secrets or raw
Slack content.

## Linear ownership

| Linear item | Responsibility |
| --- | --- |
| `DEN-1298` | Live Slack event runtime, project-aware routing, and production activation |
| `DEN-1602` | Canonical `ORESoftware/slack-ores-integrations` repository and compatibility contract |
| `DEN-1973` | Completed migration from the legacy Slack stub to the hardened integration source |

Linear descriptions and comments should record the reviewed PR, merge commit, workflow run, artifact
name, checksum evidence, and GitOps deployment revision. They must not contain tokens, signed request
bodies, provider prompts, or captured channel messages.

## GitHub account project

The repository owner is the `ORESoftware` GitHub account. Its account-level planning board should be
named `ORESoftware-project` and should include the canonical source, production runtime, and GitOps
items for this feature.

Recommended fields:

- **Status:** Backlog, Ready, In progress, In review, Done, Blocked
- **Priority:** Critical, High, Medium, Low
- **Repository:** `slack-ores-integrations`, `ai-agent-bridge.rs`, `k8s-cluster`, or supporting repo
- **Linear:** issue identifier such as `DEN-1602`
- **Environment:** Local, Test, Production
- **Evidence:** merge SHA, workflow run, artifact name, or deployment revision

Minimum project items for this integration:

1. Canonical repository PR and CI/artifact publication (`DEN-1602`).
2. Production signed-ingress compatibility and runtime activation (`DEN-1298`).
3. GitOps deployment revision and secret-reference validation in `ORESoftware/k8s-cluster`.
4. Slack manifest application/reinstallation and six-command smoke test.

## Synchronization protocol

When a PR is opened:

1. Link the Linear issue in the PR body or development metadata.
2. Add the PR or its tracking issue to `ORESoftware-project`.
3. Set status to **In review** and record the head SHA.

When CI completes:

1. Record only sanitized job conclusions and run IDs.
2. Attach the commit-addressed artifact name and checksum evidence.
3. Do not copy browser screenshots containing workspace data into planning systems.

When a PR merges:

1. Record the merge commit in Linear and the project item.
2. Move the source item to **Done** only after the default-branch CI/artifact run succeeds.
3. Keep production activation items open until the pinned GitOps revision is reconciled and the six
   slash commands pass the approved Slack smoke test.

When a repository or runtime pin changes, update `provenance.json` in the same reviewed PR so CI can
reject planning/documentation drift from the executable command surface.
