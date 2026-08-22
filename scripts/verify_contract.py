#!/usr/bin/env python3
"""Enforce the Slack slash-command contract across the manifest and the handler.

Slack decides which URL a command posts to; the service decides which provider a
URL means. Those two decisions live in different repositories, and nothing at
runtime tells you when they disagree — a command simply reaches the wrong model,
or 404s, or silently keeps working under a name you thought you retired.

This script is the missing link. It reads the manifest in this repository and the
Rust handler in ai-agent-bridge and fails if they do not agree.

    python3 scripts/verify_contract.py --bridge ../ai-agent-bridge

Exit status is 0 when every check passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# The reviewed namespace. One command, one request URL, one provider.
NAMESPACE = "/x-ores-"
EXPECTED = {
    "/x-ores-claude": "Claude",
    "/x-ores-chatgpt": "Chatgpt",
}

# Every name the workspace used before the namespace. These must not appear as a
# live command, a route, or a provider mapping anywhere.
RETIRED = [
    "/ores-claude",
    "/ores-chatgpt",
    "/x-claude",
    "/x-chatgpt",
    "/my-claude",
    "/my-chatgpt",
]

INSTALLED_APP_ID = "A0BMBAMM5NJ"
INSTALLED_TEAM_ID = "T01B3C83PMK"


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.checks = 0

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        self.checks += 1
        if ok:
            print(f"  ok    {label}")
        else:
            print(f"  FAIL  {label}" + (f"\n          {detail}" if detail else ""))
            self.failures.append(label)
        return ok


def parse_manifest(text: str) -> tuple[dict[str, str], list[str]]:
    """Return {command: request_url} and the ordered list of command names.

    Deliberately a small hand parser rather than a YAML dependency: this script
    has to run in CI before anything else is installed.
    """
    commands: dict[str, str] = {}
    order: list[str] = []
    current: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- command:"):
            current = stripped.split(":", 1)[1].strip()
            order.append(current)
        elif stripped.startswith("url:") and current is not None:
            commands[current] = stripped.split(":", 1)[1].strip()
            current = None
    return commands, order


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bridge",
        type=Path,
        default=Path("../ai-agent-bridge"),
        help="path to the ai-agent-bridge checkout holding the handler",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "app" / "manifest.yaml",
    )
    args = parser.parse_args()

    report = Report()

    if not args.manifest.is_file():
        print(f"manifest not found: {args.manifest}", file=sys.stderr)
        return 1

    manifest_text = args.manifest.read_text()
    commands, order = parse_manifest(manifest_text)

    print("manifest")
    report.check(
        set(commands) == set(EXPECTED),
        "declares exactly the reviewed commands",
        f"expected {sorted(EXPECTED)}, found {sorted(commands)}",
    )
    report.check(
        len(order) == len(set(order)),
        "declares no command twice",
        f"duplicates in {order}",
    )
    for command, url in sorted(commands.items()):
        report.check(
            url.endswith("/slack/commands/" + command.lstrip("/")),
            f"{command} posts to a path that matches its name",
            f"url is {url}",
        )
    report.check(
        len(set(commands.values())) == len(commands),
        "no two commands share a request URL",
        "Slack routes by path and the service reads the provider from the path, "
        "so a shared URL would cross providers",
    )
    for retired in RETIRED:
        report.check(
            f"command: {retired}" not in manifest_text,
            f"retired name {retired} is absent",
        )
    report.check("token_rotation_enabled: true" in manifest_text, "token rotation stays on")
    report.check("xoxb-" not in manifest_text, "no bot token is committed")
    report.check("signing_secret" not in manifest_text, "no signing secret is committed")

    handler = args.bridge / "src" / "slack_commands_parts"
    if not handler.is_dir():
        print(f"\nhandler sources not found under {handler}", file=sys.stderr)
        print("pass --bridge with the path to your ai-agent-bridge checkout", file=sys.stderr)
        return 1

    part1 = (handler / "part1.rs").read_text()
    part6 = (handler / "part6.rs").read_text()
    source = "\n".join(p.read_text() for p in sorted(handler.glob("part*.rs")))

    print("\nhandler: command to provider")
    mapping = dict(
        re.findall(r'"(/[a-z0-9-]+)" => Some\(Self::(\w+)\)', part1)
    )
    report.check(
        mapping == EXPECTED,
        "Provider::from_command maps exactly the reviewed commands",
        f"found {mapping}",
    )

    print("\nhandler: routes")
    routes = set(re.findall(r'\.route\("(/slack/commands/[a-z0-9-]+)"', part6))
    dispatch = dict(
        re.findall(r'"(/slack/commands/[a-z0-9-]+)" => Provider::(\w+)', part6)
    )
    expected_routes = {u.split("fiducia.cloud", 1)[-1] for u in commands.values()}
    report.check(
        routes == expected_routes,
        "registered routes match the manifest request URLs",
        f"router has {sorted(routes)}, manifest wants {sorted(expected_routes)}",
    )
    report.check(
        set(dispatch) == routes,
        "every registered route resolves to a provider",
        f"routes {sorted(routes)} vs dispatch {sorted(dispatch)}",
    )

    print("\ncross-check: a command and its URL must mean the same provider")
    for command, url in sorted(commands.items()):
        path = url.split("fiducia.cloud", 1)[-1]
        by_command = mapping.get(command)
        by_path = dispatch.get(path)
        report.check(
            by_command is not None and by_command == by_path,
            f"{command} -> {by_command} and {path} -> {by_path} agree",
        )

    print("\nretired names are gone from the handler")
    for retired in RETIRED:
        live_arm = f'"{retired}" =>' in part1
        live_route = f'.route("/slack/commands/{retired.lstrip("/")}"' in part6
        report.check(not live_arm, f"{retired} has no provider arm")
        report.check(not live_route, f"/slack/commands/{retired.lstrip('/')} is not routed")

    print("\nregression guards still present in the handler")
    guards = [
        ("allow_unpinned_identity", "identity pinning is opt-out, not bind-address inferred"),
        ("spawn_blocking", "the run-journal fsync stays off the async runtime"),
        ("MAX_FORM_FIELDS", "the form parser has a field ceiling"),
        ("fn log_safe", "remote-controlled log fields are bounded and sanitised"),
        ("verify_slice", "the signature comparison is constant time"),
        ("abs_diff", "the replay window is bounded in both directions"),
    ]
    for needle, label in guards:
        report.check(needle in source, label)

    print("\ninstalled app identity")
    report.check(INSTALLED_APP_ID in source, f"app id {INSTALLED_APP_ID} is pinned in tests")
    report.check(INSTALLED_TEAM_ID in source, f"team id {INSTALLED_TEAM_ID} is pinned in tests")

    print()
    if report.failures:
        print(f"{len(report.failures)} of {report.checks} checks failed:")
        for failure in report.failures:
            print(f"  - {failure}")
        return 1
    print(f"all {report.checks} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
