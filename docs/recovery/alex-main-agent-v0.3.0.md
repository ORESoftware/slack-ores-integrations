# alex-main-agent v0.3.0 diagnostic-contract recovery

This change recovers the unique, reviewable contracts from the validated
`alex-main-agent-v0.3.0-converged.zip` work artifact without replacing the
canonical Slack runtime or copying a private route registry into this public
repository.

## Provenance

- Recovered source archive SHA-256: `f4966c9f6577d6cd557061fc878dd8fc9ccd0ab3233ec0c84e4703c78b8002cc`
- Recovered hardening patch SHA-256: `ab3a94b66ff4db00ea6e1a0fd009f6ead0b85e1e5b643a7f3b8f9c2e5a4e9b76`
- Original registry authority: `ORESoftware/ai-agent-bridge.rs`
- Original reviewed registry commit: `9bddf5c24366f7ffb67560c3451fe8d8590e0178`
- Original registry purpose: `development_snapshot_not_runtime_authority`

The archived validation report recorded 47 passing Node unit/integration tests,
three passing Chromium browser tests, a 13/13 route audit, passing syntax,
typecheck, lint, secret scan, workflow parse, and coverage thresholds of 90%
lines, 75% branches, and 85% functions.

## What is recovered here

- strict, deterministic coordinator run-envelope construction;
- bounded and chronology-checked Slack context handling;
- duplicate-key-rejecting, digest-locked registry parsing;
- explicit authority and source-commit provenance;
- policy drift rejection for route, principal, write, and budget boundaries;
- a diagnostic backend that cannot execute provider, Slack, Linear, or GitHub
  side effects;
- synthetic tests that do not publish private workspace routing data.

## Activation boundary

These modules are deliberately not wired into `app.js` or command execution in
this recovery change. Current provider modularity, command registration,
concurrency, retry deduplication, graceful shutdown, and artifact-provenance
contracts remain authoritative. Production activation requires a separately
reviewed change that loads an external, exact-digest project registry and maps
its output to the Rust bridge/coordinator workflow.
