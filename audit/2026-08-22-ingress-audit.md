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

---

# Addendum — the live app, inspected 2026-08-22

The code audit above was written against the repository. This section is what
the Slack app configuration actually says, read directly from
`api.slack.com/apps/A0BMBAMM5NJ`. It diverges from the repository in ways that
change which findings are load-bearing.

## The app has no slash commands

The Slash Commands page is empty. Not `/x-ores-*`, not `/ores-*`, not `/x-*`,
not `/my-*` — nothing. The manifest tracked in `ai-agent-bridge/slack-app/` was
written, tested against, and documented, but never applied to the app.

Everything in `docs/slack-ores-commands.md` describing six working commands
described an intended state, not an observed one.

## Socket Mode is enabled, and the manifest says it is not

The Interactivity & Shortcuts page reports "Socket Mode is enabled. You won't
need to specify a Request URL." The reviewed manifest carried
`socket_mode_enabled: false`, and `docs/slack-ingress-security.md` presented the
signed Request URL as the production posture.

This inverts the weight of the Socket Mode caveat added above. It was written as
a documentation gap about an opt-in transport that was off by default. In the
live app it is the *only* configured transport — so on the app as it stands
today, there is no per-request HMAC and no replay window at all. The signature
verification the audit spent most of its effort confirming is correct is, on the
live configuration, not on the path.

## The Request URL endpoint is not serving

`https://api.fiducia.cloud/readyz` returns Cloudflare **522 Connection timed
out**. DNS resolves to Cloudflare and the CDN edge answers, but no origin
completes the request. Nothing is deployed behind that hostname.

## What follows

Socket Mode is the only transport that can work today, and it needs the two
commands created before anything at all happens. The repository now carries both
configurations as generated artifacts — `app/manifest.socket-mode.yaml` and
`app/manifest.request-url.yaml` — rendered from one source so the command set
cannot drift between them, plus contract checks that fail if a socket manifest
carries a request URL (Slack fails such a command with `invalid_url`) or if
either manifest disagrees with the handler.

Two audit items change priority given this configuration:

**Identity pinning matters more, not less.** Socket Mode has no signature, so
`api_app_id` and `team_id` are a larger share of what stands between the handler
and an unintended payload. The pinning fix above applies to both transports —
socket frames are re-encoded into form bytes and pushed through the same
`validate_slash_envelope` — and it should be treated as required configuration,
not a hardening nicety.

**The socket path has no route to cross-check against.** On HTTP the provider is
recovered from the route and then re-derived from the signed `command` field,
with a mismatch refused. A socket frame has no path, so `Provider::from_command`
is the sole authority and a stale mapping drops frames silently rather than
erroring. `scripts/verify_contract.py` in `slack-ores-integrations` guards this
by requiring the command map and the route table to agree.
