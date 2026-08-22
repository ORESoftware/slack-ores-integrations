#!/usr/bin/env python3
"""Prove the harness is testing the real code, not a paraphrase of it.

A harness that has silently drifted from the source it claims to exercise is
worse than no harness: it reports green about code that no longer exists. This
diffs every function body in extracted.rs against the handler sources and fails
on any difference beyond the documented error-type substitution.
"""
import re, sys
from pathlib import Path

PARTS = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/aab/src/slack_commands_parts")
EXTRACTED = Path(__file__).parent / "extracted.rs"

# name -> (source file, the exact signature line in the source)
FUNCTIONS = {
    "percent_decode": ("part3.rs", "fn percent_decode(value: &str) -> Result<String> {"),
    "hex":            ("part3.rs", "fn hex(value: u8) -> Option<u8> {"),
    "parse_form":     ("part3.rs", "fn parse_form(body: &[u8]) -> Result<BTreeMap<String, String>> {"),
    "field":          ("part3.rs", "fn field(form: &BTreeMap<String, String>, key: &str) -> Result<String> {"),
    "id_field":       ("part3.rs", "fn id_field(form: &BTreeMap<String, String>, key: &str) -> Result<String> {"),
    "prompt":         ("part2.rs", "fn prompt(value: &str) -> Result<String> {"),
    "find_issue":     ("part2.rs", "fn find_issue(text: &str) -> Option<String> {"),
    "log_safe":       ("part6.rs", "fn log_safe(value: &str) -> String {"),
    "truncate":       ("part6.rs", "fn truncate(value: &str, maximum_bytes: usize) -> String {"),
    "decode_signature": ("part5.rs", "fn decode_signature(value: &str) -> Option<[u8; 32]> {"),
}


def body(text: str, signature: str) -> str | None:
    start = text.find(signature)
    if start < 0:
        return None
    i = text.index("{", start)
    depth, j = 0, i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    inner = text[i + 1 : j]
    # Normalise only what the harness is documented to change.
    inner = re.sub(r"\.ok_or\(Error::Request\)", ".ok_or(Error)", inner)
    inner = re.sub(r"map_err\(\|_\| Error::Request\)", "map_err(|_| Error)", inner)
    inner = re.sub(r"Err\(Error::Request\)", "Err(Error)", inner)
    inner = re.sub(r"Err\(Error::Config\([^)]*\)\)", "Err(Error)", inner)
    inner = re.sub(r"\s+", " ", inner).strip()
    return inner


def main() -> int:
    extracted = EXTRACTED.read_text()
    failures = []
    for name, (part, signature) in FUNCTIONS.items():
        source = (PARTS / part).read_text()
        want = body(source, signature)
        if want is None:
            failures.append(f"{name}: signature not found in {part} -- the source changed shape")
            continue
        pub_sig = "pub " + signature
        got = body(extracted, pub_sig) or body(extracted, signature)
        if got is None:
            failures.append(f"{name}: not present in extracted.rs")
        elif got != want:
            failures.append(f"{name}: DRIFTED from {part}\n    source:    {want[:160]}\n    extracted: {got[:160]}")
        else:
            print(f"  verbatim  {name:<18} <- {part}")
    if failures:
        print("\nharness is not testing the real code:")
        for f in failures:
            print("  " + f)
        return 1
    print(f"\nall {len(FUNCTIONS)} extracted functions are byte-identical to the handler")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
