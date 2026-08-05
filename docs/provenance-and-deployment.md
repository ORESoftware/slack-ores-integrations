# Provenance and deployment boundaries

This repository is the canonical home for the reviewed `alex-main-agent` Slack integration source,
manifest, local Slack CLI workflow, and deterministic compatibility tests. It does not redefine the
production signed ingress or the Kubernetes deployment authority.

## Immutable source relationships

`provenance.json` and `config/runtime-integration.json` record separate responsibilities:

| Responsibility | Repository | Pinning rule |
| --- | --- | --- |
| Reviewed source imported during canonicalization | `ORESoftware/devops-slack` | Exact 40-character Git commit |
| Production signed Slack ingress and runtime contract | `ORESoftware/ai-agent-bridge.rs` | Exact 40-character Git commit |
| Production deployment and secret references | `ORESoftware/k8s-cluster` | GitOps-owned path and deployment revision |

CI fails when source/runtime pins become mutable, the source and production runtime are conflated,
unknown provenance fields are introduced, or the six Slack aliases drift from the configured command
surface and the two canonical signed ingress endpoints.

## Runtime boundary

The JavaScript/Bolt implementation in this repository is used for:

- local `slack run` development and deterministic command testing;
- generated-manifest validation;
- provider/profile compatibility testing;
- CLI and browser end-to-end coverage; and
- reviewable reference behavior for queues, timeouts, context handling, and output safety.

Production Slack ingress, request-signature enforcement, durable runs, and project-aware dispatch
remain owned by the pinned Rust runtime. Production Kubernetes configuration, Argo CD reconciliation,
workload identity, and secret references remain owned by `ORESoftware/k8s-cluster`.

Do not copy production credentials into this repository or convert local `.env` examples into a
secret-distribution mechanism.

## Change procedure

1. Update application, manifest, or compatibility behavior in a feature branch.
2. Update tests and regenerate `manifest.json` when command configuration changes.
3. Change provenance/runtime pins only as deliberate review items with immutable replacement commits.
4. Run `npm run validate`, CLI E2E, and all three browser suites.
5. Review and merge through a pull request after GitHub Actions passes.
6. Consume the exact merged commit or its verified source artifact from GitOps; do not deploy a
   floating branch name.
7. Record the merge commit, workflow run, artifact name, checksum evidence, and deployment revision
   in Linear and the owning GitHub Project item.

## Secret and evidence policy

Allowed evidence includes repository names, commit SHAs, pull-request numbers, workflow/run IDs,
artifact names, checksums, and sanitized test summaries.

Never store Slack tokens, signing secrets, provider keys, GitHub credentials, raw signed request
bodies, or captured channel content in Git, pull-request text, Linear, GitHub Projects, logs, or CI
artifacts. Any credential pasted into chat or issue text must be treated as exposed and rotated.
