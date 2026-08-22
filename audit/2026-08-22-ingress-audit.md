# Slack ingress audit — alex-main-agent

Date: 2026-08-22
Scope: `ai-agent-bridge` `src/slack_commands_parts/part1..15.rs`,
`src/slack_project_bindings.rs`, `slack-app/manifest.yaml`,
`docs/slack-ingress-security.md`.
Branch carrying the fixes: `feat/x-ores-command-namespace`.

## Summary

The cryptographic core is sound. HMAC construction, the constant-time
comparison, raw-body handling, the replay window, and the URL-encoded form
decoder were all examined specifically for the usual failure modes and none of
them is present. There is no signature-forgery or parser-confusion bug.

The real findings are about *deployment shape* and *the acknowledgement path*:
one guard inferred exposure from the bind address and got it backwards for the
reviewed production topology, and blocking disk I/O sat inside a deadline that
structurally could not enforce it.

## What was verified as correct

**Signature verification** (`part5.rs`). The base string is built as
`v0:` + the **raw timestamp header string** + `:` + the raw body. Feeding the
original header rather than a re-serialised integer is the detail most
implementations get wrong; it is right here. Comparison is
`Mac::verify_slice`, which is constant-time via `subtle::ConstantTimeEq` — no
hand-rolled `==` anywhere. `decode_signature` requires exactly 64 hex characters
and rejects any version prefix other than `v0=`.

**Raw-body integrity.** The same `Bytes` value feeds the MAC, the envelope
validation, and the command parse. There is no decompression layer and `Bytes`
is the final extractor on both handlers, so the bytes that were signed are
exactly the bytes that were parsed.

**Replay window.** `now.abs_diff(timestamp) > 300` — bounded in both directions,
and `abs_diff` cannot overflow-panic on a hostile `i64::MIN`, unlike the common
`(now - ts).abs()` form. A missing or unparseable header fails closed.

**The form decoder** (`part3.rs`). The percent-decode bound is correct, not
off-by-one: a truncated `%4` falls through to the error arm. Keys are decoded
*after* splitting, and decoded-key collisions are rejected — which closes the
`team%5Fid` vs `team_id` smuggling path.

**Secret handling.** Config errors carry env-var *names*, never values. Every
ephemeral response is a fixed literal. `service_url` rejects userinfo and query
strings so a bearer cannot ride in a loggable URL, and the outbound client sets
`redirect(Policy::none())` so the bot token is never forwarded to a redirect
target.

## Findings and dispositions

### 1. Identity pinning was disabled by the normal production topology — fixed

`SLACK_EXPECTED_APP_ID` / `SLACK_EXPECTED_TEAM_ID` were required only when the
process bound a non-loopback address, on the reasoning that a loopback bind
implies an isolated deployment.

That reasoning inverts for the reviewed shape. Production terminates TLS in a
same-host proxy and forwards to `127.0.0.1`, so the *internet-facing*
deployment is a loopback bind. In that configuration the service started happily
with both variables unset, the envelope check was skipped entirely, and
`api_app_id` was never read on any code path.

Residual risk was bounded — the signing secret is per-app, and the
`(team_id, channel_id)` registry lookup pins the workspace de facto — but the
`rejected_app_identity` signal the security doc treats as load-bearing was
silently absent, and a second install of the same app in another workspace would
have been accepted.

**Fixed.** Pinning is now required. The waiver is an explicit
`SLACK_ALLOW_UNPINNED_IDENTITY` opt-in resolved once at startup into `Config`,
not re-read per request. A regression test constructs an internet-facing
loopback config and asserts it is refused.

### 2. Blocking fsync inside an unenforceable deadline — fixed

`claim()` is synchronous `std::fs` and ends in `sync_data()`. It was called
inline from the async handlers. `tokio::time::timeout` only fires at an await
point, so it cannot preempt a blocking syscall: under disk pressure the 2 500 ms
guard was inert, the handler would blow Slack's 3 s deadline, *and* it parked a
multi-thread-runtime worker, stalling unrelated in-flight requests on that
thread.

**Fixed.** The journal write runs through `spawn_blocking`. A doc comment on
`claim` records why callers must not reach it directly.

### 3. The interaction path had no deadline over its tail — fixed

The modal-submission handler wrapped only `app.resolve` in the ack deadline.
Everything after it, including the blocking claim from finding 2, ran unbounded.
The slash-command path wrapped its whole tail correctly; the interaction path
did not.

**Fixed.** The deadline now spans resolve *and* accept, matching the command
path.

### 4. Duplicate deliveries were answered "at capacity" — fixed

A capacity permit was taken before the duplicate check, so at saturation a
resubmission of an already-claimed run got `503 The agent queue is at capacity`
instead of "already accepted" — inviting a retry of work that is already
running, exactly when the service is least able to absorb it. This inverted the
ordering the security doc specifies, and its stated rationale.

**Fixed.** A cheap existence probe answers duplicates truthfully before the
semaphore is touched; the atomic claim still decides.

### 5. Unbounded field count in the form parser — fixed

`parse_form` had no cap on pair count and runs twice per request. Bounded by the
1 MiB body limit and reachable only behind a valid signature, so minor, but free
amplification with no upside.

**Fixed.** `MAX_FORM_FIELDS = 64`; Slack sends about a dozen.

### 6. Remote-controlled text echoed into structured logs — fixed

The `error` field of a bridge or coordinator response was written verbatim into
`warn!`, bounded only by the 1 MiB response cap. A misbehaving or compromised
downstream could inject arbitrary text, newlines included, into the log pipeline
— log-record forgery.

**Fixed.** `log_safe` restricts to an identifier charset and truncates to 64
bytes. Ordinary Slack error codes pass through unchanged.

## Open items, not fixed here

**Replay inside the 300 s window on the modal path.** There is no nonce cache.
The run journal dedupes runs, but the empty-text branch opens a modal without
claiming, so a captured signed command can be replayed for up to 300 s, each
replay costing a `usergroups.list` and a `views.open`. Impact is low — Slack
expires `trigger_id` in about 3 s, so no modal actually opens — but it is
unmetered outbound API traffic. The fix is an LRU keyed on
`(timestamp, signature)` with a 300 s TTL, checked right after signature
verification so it covers every route uniformly.

**The run journal is never pruned.** `state_dir` grows one inode per run
forever. Worth noting before someone adds a cleanup job: whatever retention they
pick silently becomes the deduplication window.

**Socket Mode carries no signature or replay check.** This is correct by design
— connection-level `xapp-` auth — and it is off by default, but
`docs/slack-ingress-security.md` read as though the signed Request URL were the
only ingress. A caveat section was added.

**No `Content-Type` check.** Not exploitable, since the HMAC gates the body, but
a signed JSON body is currently fed to the form decoder rather than refused.
