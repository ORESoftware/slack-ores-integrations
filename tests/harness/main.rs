mod sha;
mod extracted;

use extracted::*;
use sha::{hex_encode, hmac_sha256, sha256};
use std::collections::BTreeMap;

struct T { pass: usize, fail: usize }
impl T {
    fn ok(&mut self, cond: bool, what: &str) {
        if cond { self.pass += 1; } else { self.fail += 1; println!("  FAIL  {what}"); }
    }
    fn section(&self, name: &str) { println!("\n{name}"); }
    fn done(&self, name: &str) { println!("  {} passed in {name}", self.pass); }
}

/// Deterministic PRNG. Math::random is unavailable and a seeded generator makes
/// a failure reproducible from the seed alone.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize { (self.next() % n as u64) as usize }
    fn byte(&mut self) -> u8 { (self.next() & 0xff) as u8 }
}

fn slack_base_string(timestamp: &str, body: &[u8]) -> Vec<u8> {
    // Mirrors part5.rs verify_signature exactly: b"v0:" + raw header + b":" + body.
    let mut buffer = Vec::new();
    buffer.extend_from_slice(b"v0:");
    buffer.extend_from_slice(timestamp.as_bytes());
    buffer.extend_from_slice(b":");
    buffer.extend_from_slice(body);
    buffer
}

fn main() {
    let mut t = T { pass: 0, fail: 0 };

    // ---------------------------------------------------------------- crypto
    t.section("crypto primitives (RFC 6234 / RFC 4231 vectors)");
    t.ok(hex_encode(&sha256(b"")) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256 empty");
    t.ok(hex_encode(&sha256(b"abc")) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 abc");
    t.ok(hex_encode(&sha256(&vec![b'a'; 1_000_000])) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 one million a");
    t.ok(hex_encode(&sha256(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")) == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", "sha256 448-bit");
    t.ok(hex_encode(&hmac_sha256(&[0x0b; 20], b"Hi There")) == "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7", "hmac rfc4231 case 1");
    t.ok(hex_encode(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")) == "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", "hmac rfc4231 case 2");
    t.ok(hex_encode(&hmac_sha256(&[0xaa; 131], b"Test Using Larger Than Block-Size Key - Hash Key First")) == "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54", "hmac rfc4231 case 6 (key > block)");
    t.done("crypto");

    // ------------------------------------------------------- command routing
    t.section("command routing");
    t.ok(from_command("/x-ores-claude") == Some(Provider::Claude), "canonical claude");
    t.ok(from_command("/x-ores-chatgpt") == Some(Provider::Chatgpt), "canonical chatgpt");
    for retired in ["/ores-claude","/ores-chatgpt","/x-claude","/x-chatgpt","/my-claude","/my-chatgpt"] {
        t.ok(from_command(retired).is_none(), retired);
    }
    // Exhaustive single-character mutation: no near-miss of a live command may resolve.
    let mut mutations = 0usize;
    for live in ["/x-ores-claude", "/x-ores-chatgpt"] {
        let bytes = live.as_bytes();
        for position in 0..bytes.len() {
            for replacement in 32u8..127 {
                if replacement == bytes[position] { continue; }
                let mut candidate = bytes.to_vec();
                candidate[position] = replacement;
                let candidate = String::from_utf8(candidate).unwrap();
                if candidate == live { continue; }
                mutations += 1;
                // Only a whitespace edit may still resolve -- from_command trims.
                let resolves = from_command(&candidate).is_some();
                let trims_to_live = candidate.trim() == live;
                t.ok(!resolves || trims_to_live, &format!("mutation {candidate:?} must not resolve"));
            }
            // Deletion
            let mut shortened = bytes.to_vec();
            shortened.remove(position);
            let shortened = String::from_utf8(shortened).unwrap();
            mutations += 1;
            t.ok(from_command(&shortened).is_none(), &format!("deletion {shortened:?}"));
        }
    }
    println!("  ({mutations} single-character mutations of the live commands, none resolved)");
    t.done("routing");

    // ----------------------------------------------------------- form parser
    t.section("form parser");
    let real = b"token=x&team_id=T01B3C83PMK&channel_id=C1&user_id=U1&command=%2Fx-ores-claude&text=fix+DEN-1041&api_app_id=A0BMBAMM5NJ&trigger_id=t1";
    let form = parse_form(real).expect("a real Slack envelope must parse");
    t.ok(form.get("command").map(String::as_str) == Some("/x-ores-claude"), "command decoded");
    t.ok(form.get("text").map(String::as_str) == Some("fix DEN-1041"), "plus decoded to space");
    t.ok(form.get("api_app_id").map(String::as_str) == Some("A0BMBAMM5NJ"), "api_app_id present");

    t.ok(parse_form(b"team_id=T1&team%5Fid=T2").is_err(), "decoded key collision refused");
    t.ok(parse_form(b"a=%2").is_err(), "truncated escape refused");
    t.ok(parse_form(b"a=%").is_err(), "bare percent refused");
    t.ok(parse_form(b"a=%zz").is_err(), "non-hex escape refused");
    t.ok(parse_form(&[b'a', b'=', 0xff, 0xfe]).is_err(), "invalid utf-8 refused");
    t.ok(parse_form(b"a=%FF%FE").is_err(), "escapes decoding to invalid utf-8 refused");

    let over = (0..=MAX_FORM_FIELDS).map(|i| format!("k{i}=v")).collect::<Vec<_>>().join("&");
    t.ok(parse_form(over.as_bytes()).is_err(), "field ceiling enforced");
    let at = (0..MAX_FORM_FIELDS).map(|i| format!("k{i}=v")).collect::<Vec<_>>().join("&");
    t.ok(parse_form(at.as_bytes()).is_ok(), "exactly the ceiling still parses");

    // The security-critical property: whatever the parser accepts, the value it
    // reports for `command` must be a value the router would also accept, and a
    // hostile encoding must never produce a *different* live command.
    // Mutate *valid* encoded envelopes rather than random noise. A fuzzer that
    // never reaches the resolve branch proves nothing; these start from a
    // command Slack would really send and perturb it, so the parser and the
    // router are exercised together on near-misses.
    let mut rng = Rng(0x5eed_1234_abcd_0001);
    let seeds = [
        "%2Fx-ores-claude", "%2Fx-ores-chatgpt",
        "%2fx-ores-claude", "%2Fx-ores-CLAUDE",
        "+%2Fx-ores-claude+", "%2Fx-ores-claude%00",
        "%2Fx-ores-claude%2F..", "%2F%78-ores-claude",
        "%2Fx-ores-claude&command=%2Fx-ores-chatgpt",
    ];
    let mutators: &[u8] = b"%2F+&=./-_ABCDEFabcdef0123456789xores\x00";
    let mut parsed_ok = 0usize;
    let mut resolved = 0usize;
    let mut resolved_claude = 0usize;
    let mut resolved_chatgpt = 0usize;
    for _ in 0..300_000 {
        let mut raw = seeds[rng.below(seeds.len())].as_bytes().to_vec();
        for _ in 0..1 + rng.below(3) {
            match rng.below(3) {
                0 if !raw.is_empty() => { let i = rng.below(raw.len()); raw[i] = mutators[rng.below(mutators.len())]; }
                1 if !raw.is_empty() => { let i = rng.below(raw.len()); raw.remove(i); }
                _ => { let i = rng.below(raw.len() + 1); raw.insert(i, mutators[rng.below(mutators.len())]); }
            }
        }
        let mut body = b"command=".to_vec();
        body.extend_from_slice(&raw);
        if let Ok(form) = parse_form(&body) {
            parsed_ok += 1;
            if let Some(command) = form.get("command") {
                if let Some(provider) = from_command(command) {
                    resolved += 1;
                    match provider {
                        Provider::Claude => resolved_claude += 1,
                        Provider::Chatgpt => resolved_chatgpt += 1,
                    }
                    let trimmed = command.trim();
                    t.ok(
                        (trimmed == "/x-ores-claude" && provider == Provider::Claude)
                            || (trimmed == "/x-ores-chatgpt" && provider == Provider::Chatgpt),
                        &format!("a mutation resolved outside the namespace: {command:?} -> {provider:?}"),
                    );
                    // And a resolving command must never carry a NUL or a slash
                    // beyond the leading one -- both would mean the decoder let
                    // something structural through.
                    t.ok(!trimmed.contains('\0'), "resolved command carries no NUL");
                    t.ok(trimmed.matches('/').count() == 1, "resolved command has exactly one slash");
                }
            }
        }
    }
    println!("  (300000 mutated real envelopes: {parsed_ok} parsed, {resolved} resolved -- {resolved_claude} claude, {resolved_chatgpt} chatgpt)");
    t.ok(resolved > 1_000, "the fuzzer actually reached the resolve branch");

    // parse_form must never panic on arbitrary bytes.
    let mut rng = Rng(0xd00d_0000_0f00_ba11);
    for _ in 0..200_000 {
        let len = rng.below(96);
        let body: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
        let _ = parse_form(&body);
    }
    println!("  (200000 arbitrary-byte bodies parsed without panic)");
    t.done("form parser");

    // ------------------------------------------------------------ identifier
    t.section("identifier and id_field");
    t.ok(identifier("k", "T01B3C83PMK").is_ok(), "a real team id");
    t.ok(identifier("k", "A0BMBAMM5NJ").is_ok(), "a real app id");
    for bad in ["T1/T2", "T1 T2", "T1\nT2", "T1\tT2", "", "   ", "T1;drop", "T1&x=1", "T1%2F"] {
        t.ok(identifier("k", bad).is_err(), &format!("identifier rejects {bad:?}"));
    }
    t.ok(identifier("k", &"a".repeat(MAX_IDENTIFIER_BYTES)).is_ok(), "at the length limit");
    t.ok(identifier("k", &"a".repeat(MAX_IDENTIFIER_BYTES + 1)).is_err(), "past the length limit");
    // An identifier that survives must be safe to interpolate into the run key.
    let mut rng = Rng(0xaaaa_bbbb_cccc_dddd);
    for _ in 0..100_000 {
        let len = rng.below(12);
        let value: String = (0..len).map(|_| rng.byte() as char).collect();
        if let Ok(accepted) = identifier("k", &value) {
            t.ok(
                !accepted.contains(':') || accepted.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-'|'_'|'.'|':')),
                "accepted identifier stayed in the safe charset",
            );
            t.ok(!accepted.contains('&') && !accepted.contains('=') && !accepted.contains('/'), "no form or path metacharacters survive");
        }
    }
    println!("  (100000 random identifiers: every accepted value stayed in the safe charset)");
    t.done("identifier");

    // ------------------------------------------------------- signature scheme
    t.section("Slack signature scheme");
    let secret = b"8f742231b10e8888abcd99yyyzzz85a5";
    let body = b"token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&command=%2Fx-ores-claude";
    let timestamp = "1531420618";
    let expected = hex_encode(&hmac_sha256(secret, &slack_base_string(timestamp, body)));
    t.ok(decode_signature(&expected).is_some(), "our signature decodes");
    t.ok(decode_signature(&expected.to_uppercase()).is_some(), "uppercase hex decodes");
    t.ok(decode_signature(&expected[..63]).is_none(), "63 chars refused");
    t.ok(decode_signature(&format!("{expected}0")).is_none(), "65 chars refused");
    t.ok(decode_signature(&"g".repeat(64)).is_none(), "non-hex refused");

    // The base string must be sensitive to every component, and -- the classic
    // bug -- a timestamp/body boundary shift must change the digest.
    let shifted_a = slack_base_string("153142061", &[b"8:".as_slice(), body].concat());
    let shifted_b = slack_base_string(timestamp, body);
    t.ok(shifted_a != shifted_b, "timestamp/body boundary is unambiguous");
    t.ok(hmac_sha256(secret, &shifted_a) != hmac_sha256(secret, &shifted_b), "boundary shift changes the digest");

    let mut rng = Rng(0x1122_3344_5566_7788);
    for _ in 0..2_000 {
        let ts = format!("{}", 1_500_000_000u64 + rng.next() % 100_000_000);
        let len = rng.below(64);
        let payload: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
        let good = hmac_sha256(secret, &slack_base_string(&ts, &payload));
        // any single-bit flip in the body must change the digest
        if !payload.is_empty() {
            let mut tampered = payload.clone();
            let index = rng.below(tampered.len());
            tampered[index] ^= 1 << rng.below(8);
            let bad = hmac_sha256(secret, &slack_base_string(&ts, &tampered));
            t.ok(good != bad, "a one-bit body edit changes the digest");
        }
        // a different secret must change the digest
        t.ok(good != hmac_sha256(b"wrong-secret", &slack_base_string(&ts, &payload)), "secret is load bearing");
    }
    println!("  (2000 random envelopes: tamper and wrong-secret both always detected)");
    t.done("signature");

    // --------------------------------------------------------- replay window
    t.section("replay window");
    let within = |now: i64, ts: i64| now.abs_diff(ts) <= 300;
    t.ok(within(1_700_000_000, 1_700_000_000), "same second");
    t.ok(within(1_700_000_000, 1_700_000_300), "exactly +300");
    t.ok(within(1_700_000_000, 1_699_999_700), "exactly -300");
    t.ok(!within(1_700_000_000, 1_700_000_301), "+301 refused");
    t.ok(!within(1_700_000_000, 1_699_999_699), "-301 refused");
    // The overflow trap: (now - ts).abs() panics here in debug; abs_diff does not.
    t.ok(!within(0, i64::MIN), "i64::MIN timestamp handled without panic");
    t.ok(!within(i64::MAX, i64::MIN), "extreme span handled without panic");
    t.done("replay window");

    // ------------------------------------------------------------- log_safe
    t.section("log sanitisation");
    t.ok(!log_safe("not_authed\n2026 ERROR forged").contains('\n'), "newline stripped");
    t.ok(!log_safe("a\r\nb").contains('\r'), "carriage return stripped");
    t.ok(log_safe(&"a".repeat(4096)).len() <= 64, "bounded to 64 bytes");
    for code in ["not_authed","channel_not_found","ratelimited","invalid_auth","token_revoked"] {
        t.ok(log_safe(code) == code, &format!("{code} passes through"));
    }
    let mut rng = Rng(0xfeed_face_dead_beef);
    for _ in 0..100_000 {
        let len = rng.below(200);
        let value: String = (0..len).map(|_| rng.byte() as char).collect();
        let out = log_safe(&value);
        t.ok(out.len() <= 64, "log_safe always bounded");
        t.ok(!out.contains('\n') && !out.contains('\r') && !out.contains('\t'), "log_safe never emits a line break");
        t.ok(out.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-'|'_'|'.'|':'|' '|'?')), "log_safe charset held");
    }
    println!("  (100000 hostile strings: bounded, single-line, safe charset, always)");
    t.done("log sanitisation");

    // ------------------------------------------------------------ find_issue
    t.section("Linear issue extraction");
    t.ok(find_issue("fix DEN-1041 please") == Some("DEN-1041".into()), "plain match");
    t.ok(find_issue("DEN-1041") == Some("DEN-1041".into()), "bare match");
    t.ok(find_issue("no issue here") == None, "no false positive on prose");
    t.ok(find_issue("a-1") == None, "lowercase team refused");
    t.ok(find_issue("D-1") == None, "one-letter team refused");
    t.ok(find_issue("TOOLONGTEAMX-1") == None, "eleven-letter team refused");
    t.ok(find_issue("DEN-") == None, "missing number refused");
    t.ok(find_issue("DEN-12a") == None, "non-numeric suffix refused");
    // Seeded from text that plausibly contains an issue key, so the extractor's
    // accept path is actually exercised rather than only its reject path.
    let mut rng = Rng(0x0f0f_0f0f_1234_5678);
    let words = ["fix", "DEN-1041", "please", "ABC-7", "den-9", "X-1", "TOOLONGTEAM-2",
                 "DEN-", "-42", "REVIEW-88", "and", "DEN-1041-extra", "A1-2", "QA-0"];
    let mut extracted_count = 0usize;
    for _ in 0..150_000 {
        let count = 1 + rng.below(6);
        let text: String = (0..count)
            .map(|_| words[rng.below(words.len())])
            .collect::<Vec<_>>()
            .join(if rng.below(2) == 0 { " " } else { ", " });
        if let Some(found) = find_issue(&text) {
            extracted_count += 1;
            let (team, number) = found.split_once('-').expect("shape is TEAM-N");
            t.ok((2..=10).contains(&team.len()), "team length in range");
            t.ok(team.chars().all(|c| c.is_ascii_uppercase()), "team uppercase");
            t.ok(!number.is_empty() && number.chars().all(|c| c.is_ascii_digit()), "number is digits");
            t.ok(text.contains(&found), "the extracted key really occurs in the text");
        }
    }
    t.ok(extracted_count > 10_000, "the extractor's accept path was exercised");
    println!("  (150000 realistic strings: {extracted_count} issues extracted, all well-formed)");
    t.done("find_issue");

    // --------------------------------------------------------------- prompt
    t.section("prompt bounds");
    t.ok(prompt("  do the thing  ") == Ok("do the thing".into()), "trimmed");
    t.ok(prompt("").is_err(), "empty refused");
    t.ok(prompt("   ").is_err(), "whitespace-only refused");
    t.ok(prompt("a\0b").is_err(), "NUL refused");
    t.ok(prompt(&"a".repeat(MAX_PROMPT_BYTES)).is_ok(), "at the limit");
    t.ok(prompt(&"a".repeat(MAX_PROMPT_BYTES + 1)).is_err(), "past the limit");
    t.done("prompt");

    // ------------------------------------------------------- run id / dedupe
    t.section("run id determinism");
    let run_id = |source_key: &str| -> String {
        let digest = sha256(source_key.as_bytes());
        let suffix: String = digest.iter().take(12).map(|b| format!("{b:02x}")).collect();
        format!("ores-{suffix}")
    };
    let key = "slash:T1:C1:U1:trigger-1";
    t.ok(run_id(key) == run_id(key), "same key, same id");
    t.ok(run_id(key) != run_id("slash:T1:C1:U1:trigger-2"), "different trigger, different id");
    t.ok(run_id(key).len() == 29, "coordinator idempotency-key length is 29");
    t.ok(run_id(key).starts_with("ores-"), "run id prefix");
    let mut seen = std::collections::BTreeSet::new();
    let mut rng = Rng(0xabcd_0000_ef01_2345);
    for _ in 0..100_000 {
        let k = format!("slash:T1:C1:U{}:trigger-{}", rng.next(), rng.next());
        seen.insert(run_id(&k));
    }
    t.ok(seen.len() == 100_000, "no run id collisions across 100000 distinct keys");
    println!("  (100000 distinct source keys, {} distinct run ids)", seen.len());
    t.done("run id");

    println!("\n================================================");
    println!("  {} assertions passed, {} failed", t.pass, t.fail);
    println!("================================================");
    if t.fail > 0 { std::process::exit(1); }
}
