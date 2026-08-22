# Behavioural harness

`cargo test` is the real suite. This exists because it cannot always be run:
the sandbox this was developed in has no access to crates.io, so the handler
could not be compiled at all. Rather than ship an unverified change, the pure-
`std` logic was extracted and exercised directly with `rustc`, which needs no
registry.

It is not a substitute for `cargo test`. It covers only the functions that have
no crate dependencies — but those are the parsing and sanitisation paths where
the interesting bugs live, and it hits them far harder than a unit test would.

## Running

```sh
python3 check_verbatim.py ../../../ai-agent-bridge/src/slack_commands_parts
rustc --edition 2021 -O main.rs -o harness && ./harness
```

Sub-second. ~716,000 assertions.

## Why you can trust it

The obvious failure mode for a harness like this is drift: it keeps passing
against a copy of the code that no longer matches the code that ships, which is
worse than having no harness at all.

`check_verbatim.py` closes that. It parses every function body out of
`extracted.rs` and out of the real handler sources, normalises only the one
documented substitution (the crate's rich error enum becomes a unit struct), and
fails on any other difference. If a function drifts, the harness refuses to be
trusted before it refuses to compile.

`sha.rs` is the exception — SHA-256 and HMAC-SHA256 written here because `sha2`
and `hmac` are unreachable. They are validated against RFC 6234 and RFC 4231
vectors as the first thing the harness does, including the greater-than-block-
size key case. If those fail, nothing downstream is meaningful.

## What it covers

| Area | What is actually checked |
|---|---|
| Command routing | Every single-character substitution and deletion of both live commands (2,755 mutations) — none may resolve |
| Form parser | 300,000 mutations of *real* Slack envelopes, plus 200,000 arbitrary-byte bodies for panic-freedom |
| Identifier | 100,000 random values — every accepted one must stay inside the safe charset, with no form or path metacharacters |
| Signature scheme | The base string built exactly as `verify_signature` builds it; single-bit body edits and wrong secrets must always change the digest |
| Replay window | Both boundaries at ±300s, and the `i64::MIN` case that panics under the common `(now - ts).abs()` formulation |
| Log sanitisation | 100,000 hostile strings — always bounded, always single-line, always in charset |
| Issue extraction | 150,000 realistic strings — every extracted key must be well-formed *and* actually occur in the source text |
| Run IDs | 100,000 distinct source keys produce 100,000 distinct IDs, all 29 bytes for the coordinator's idempotency key |

The fuzzers assert on their own reach. A run that stops resolving commands, or
stops extracting issues, fails — a fuzzer that never enters the branch it is
aiming at is worse than no fuzzer, because it reports green.

## What it does not cover

Everything requiring the crate graph: the axum handlers, the HTTP and socket
ingress end to end, the policy resolve, the run journal, the modal payloads, the
bridge and coordinator calls. Those are covered by `cargo test --locked slack`
in `ai-agent-bridge`, which still needs to be run.
