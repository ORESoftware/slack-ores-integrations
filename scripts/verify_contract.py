#!/usr/bin/env python3
"""Enforce the Slack slash-command contract across both transports and the handler.

Three things have to agree and nothing at runtime tells you when they don't:

  * app/app.json          -- the command set you intend
  * the two manifests     -- what Slack is configured to do, per transport
  * the Rust handler      -- what the service will actually accept

A disagreement does not raise an error. A command reaches the wrong model, or
404s, or keeps working under a name you thought you retired. This script reads
all three and fails when they diverge.

    python3 scripts/verify_contract.py --bridge ../ai-agent-bridge

Exit status is 0 when every check passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


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
        return bool(ok)

    def section(self, title: str) -> None:
        print(f"\n{title}")


def parse_manifest(text: str) -> dict:
    """Small hand parser for the manifest subset we render.

    Deliberately not PyYAML: this has to run in CI before anything is installed,
    and the shapes involved are fixed by our own renderer.
    """
    commands: list[dict] = []
    scopes: list[str] = []
    settings: dict[str, str] = {}
    interactivity_url: str | None = None
    current: dict | None = None
    in_scopes = False

    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip() if not raw.strip().startswith("#") else ""
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- command:"):
            current = {"command": stripped.split(":", 1)[1].strip()}
            commands.append(current)
            in_scopes = False
        elif stripped.startswith("url:") and current is not None:
            current["url"] = stripped.split(":", 1)[1].strip()
        elif stripped == "bot:":
            in_scopes = True
        elif in_scopes and stripped.startswith("- "):
            scopes.append(stripped[2:].strip())
        elif stripped.startswith("request_url:"):
            interactivity_url = stripped.split(":", 1)[1].strip()
            in_scopes = False
        elif ":" in stripped and not stripped.startswith("-"):
            key, _, value = stripped.partition(":")
            value = value.strip()
            if value:
                settings[key.strip()] = value
            in_scopes = False
    return {
        "commands": commands,
        "scopes": scopes,
        "settings": settings,
        "interactivity_url": interactivity_url,
        "raw": text,
        # Comments carry prose about tokens ("no url while xapp- auth is in
        # play"); secret scanning must look at the document, not the commentary.
        "body": "\n".join(
            line for line in text.splitlines() if not line.lstrip().startswith("#")
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bridge", type=Path, default=Path("../ai-agent-bridge"))
    args = parser.parse_args()

    report = Report()
    source = json.loads((ROOT / "app" / "app.json").read_text())

    expected_commands = {"/" + c["name"]: c["provider"] for c in source["commands"]}
    retired = ["/" + name for name in source["retired_commands"]]
    base = source["request_url_base"]

    manifests = {
        "request-url": ROOT / "app" / "manifest.request-url.yaml",
        "socket-mode": ROOT / "app" / "manifest.socket-mode.yaml",
    }
    parsed: dict[str, dict] = {}
    for transport, path in manifests.items():
        if not path.is_file():
            print(f"missing manifest: {path} -- run: make render", file=sys.stderr)
            return 1
        parsed[transport] = parse_manifest(path.read_text())

    # ---------------------------------------------------------------- manifests
    for transport, manifest in parsed.items():
        report.section(f"manifest: {transport}")
        names = [c["command"] for c in manifest["commands"]]
        report.check(
            set(names) == set(expected_commands),
            "declares exactly the commands in app/app.json",
            f"expected {sorted(expected_commands)}, found {sorted(names)}",
        )
        report.check(len(names) == len(set(names)), "declares no command twice", str(names))
        report.check(
            manifest["scopes"] == source["bot_scopes"],
            "bot scopes match app/app.json",
            f"found {manifest['scopes']}",
        )
        for name in retired:
            report.check(
                f"command: {name}\n" not in manifest["raw"] + "\n",
                f"retired name {name} is absent",
            )
        report.check(
            manifest["settings"].get("token_rotation_enabled") == "true",
            "token rotation stays on",
        )
        for marker, label in [
            ("xoxb-", "no bot token is committed"),
            ("xapp-", "no app token is committed"),
            ("xoxe-", "no configuration token is committed"),
            ("signing_secret", "no signing secret is committed"),
        ]:
            report.check(marker not in manifest["body"], label)

        if transport == "request-url":
            report.check(
                manifest["settings"].get("socket_mode_enabled") == "false",
                "socket_mode_enabled is false",
            )
            for command in manifest["commands"]:
                name = command["command"].lstrip("/")
                report.check(
                    command.get("url") == f"{base}/slack/commands/{name}",
                    f"{command['command']} posts to a path matching its name",
                    f"url is {command.get('url')!r}",
                )
            urls = [c.get("url") for c in manifest["commands"]]
            report.check(
                len(set(urls)) == len(urls),
                "no two commands share a request URL",
                "the service reads the provider from the path, so a shared URL "
                "would make the path ambiguous",
            )
            report.check(
                manifest["interactivity_url"] == f"{base}/slack/interactions",
                "interactivity request URL is set",
            )
        else:
            # Slack fails a command with 'invalid_url' if a URL is set while
            # Socket Mode is on. This is the check that keeps the two renders
            # from being accidentally interchangeable.
            report.check(
                manifest["settings"].get("socket_mode_enabled") == "true",
                "socket_mode_enabled is true",
            )
            report.check(
                all("url" not in c for c in manifest["commands"]),
                "no slash command carries a request URL",
                "Slack rejects a command with a URL while Socket Mode is on",
            )
            report.check(
                manifest["interactivity_url"] is None,
                "no interactivity request URL",
            )

    # ------------------------------------------------------- transport agreement
    report.section("the two transports describe the same app")
    a, b = parsed["request-url"], parsed["socket-mode"]
    report.check(
        [c["command"] for c in a["commands"]] == [c["command"] for c in b["commands"]],
        "identical command sets, in identical order",
    )
    report.check(a["scopes"] == b["scopes"], "identical bot scopes")
    report.check(
        a["settings"].get("name", "") == b["settings"].get("name", ""),
        "identical app name",
    )

    # ------------------------------------------------------------------- handler
    handler = args.bridge / "src" / "slack_commands_parts"
    if not handler.is_dir():
        print(f"\nhandler sources not found under {handler}", file=sys.stderr)
        print("pass --bridge with the path to your ai-agent-bridge checkout", file=sys.stderr)
        return 1

    part1 = (handler / "part1.rs").read_text()
    part6 = (handler / "part6.rs").read_text()
    part15 = (handler / "part15.rs").read_text()
    everything = "\n".join(p.read_text() for p in sorted(handler.glob("part*.rs")))

    report.section("handler: command to provider")
    mapping = dict(re.findall(r'"(/[a-z0-9-]+)" => Some\(Self::(\w+)\)', part1))
    report.check(
        mapping == expected_commands,
        "Provider::from_command maps exactly the reviewed commands",
        f"found {mapping}",
    )

    report.section("handler: HTTP routes (Request URL transport)")
    routes = set(re.findall(r'\.route\("(/slack/commands/[a-z0-9-]+)"', part6))
    dispatch = dict(re.findall(r'"(/slack/commands/[a-z0-9-]+)" => Provider::(\w+)', part6))
    wanted = {c["url"].removeprefix(base) for c in a["commands"]}
    report.check(routes == wanted, "routes match the request-url manifest", f"{sorted(routes)} vs {sorted(wanted)}")
    report.check(set(dispatch) == routes, "every route resolves to a provider")
    for command, provider in sorted(expected_commands.items()):
        path = f"/slack/commands/{command.lstrip('/')}"
        report.check(
            mapping.get(command) == provider == dispatch.get(path),
            f"{command} and {path} both mean {provider}",
            f"command->{mapping.get(command)}, path->{dispatch.get(path)}",
        )

    report.section("handler: Socket Mode transport")
    report.check(
        "fn socket_expected_provider" in part15,
        "a socket frame derives its provider from the command field",
    )
    report.check(
        "validate_slash_envelope" in part15,
        "socket frames go through the same envelope validation as HTTP",
    )
    report.check(
        "SlashCommand::parse" in part15,
        "socket frames go through the same command parse as HTTP",
    )
    report.check(
        "SLACK_ACK_DEADLINE" in part15,
        "the socket path enforces the same acknowledgement deadline",
    )
    report.check(
        'if app.config.socket_mode {' in part6 and "axum::serve" in part6,
        "both transports can run in one process",
        "the HTTP listener must stay mounted when Socket Mode is on",
    )
    report.check(
        "xapp-" in part15,
        "the app-level token shape is validated at startup, not at connect",
    )

    report.section("retired names are gone from the handler")
    for name in retired:
        report.check(f'"{name}" =>' not in part1, f"{name} has no provider arm")
        report.check(
            f'.route("/slack/commands/{name.lstrip("/")}"' not in part6,
            f"/slack/commands/{name.lstrip('/')} is not routed",
        )

    report.section("struct literal field placement")
    # There is no compiler in some environments this runs in, and a field pasted
    # into the wrong struct literal is invisible to every other check here. This
    # one caught `allow_unpinned_identity` -- a Config field -- landing inside
    # BudgetPolicy literals, which shares the `max_concurrent_runs` field name.
    BUDGET_POLICY_FIELDS = {
        "max_concurrent_runs",
        "max_runtime_secs",
        "max_tokens",
        "max_spend_cents",
        "max_retries",
    }
    sources = sorted(handler.glob("part*.rs")) + sorted(
        (args.bridge / "tests").glob("slack*.rs")
    )
    misplaced = []
    for path in sources:
        lines = path.read_text().split("\n")
        depth = None
        for number, line in enumerate(lines, 1):
            stripped = line.strip()
            if "BudgetPolicy {" in stripped and stripped.endswith("{"):
                depth = len(line) - len(line.lstrip())
                continue
            if depth is None:
                continue
            if not stripped:
                continue
            indent = len(line) - len(line.lstrip())
            if indent <= depth:
                depth = None
                continue
            name = stripped.split(":", 1)[0].strip()
            if name and name.isidentifier() and name not in BUDGET_POLICY_FIELDS:
                misplaced.append(f"{path.name}:{number} `{name}` is not a BudgetPolicy field")
    report.check(
        not misplaced,
        "no foreign field appears inside a BudgetPolicy literal",
        "; ".join(misplaced),
    )

    report.section("ingress regression guards")
    for needle, label in [
        ("allow_unpinned_identity", "identity pinning is opt-out, not bind-address inferred"),
        ("spawn_blocking", "the run-journal fsync stays off the async runtime"),
        ("MAX_FORM_FIELDS", "the form parser has a field ceiling"),
        ("fn log_safe", "remote-controlled log fields are bounded and sanitised"),
        ("verify_slice", "the signature comparison is constant time"),
        ("abs_diff", "the replay window is bounded in both directions"),
    ]:
        report.check(needle in everything, label)

    report.section("the bridge's manifest copy has not drifted")
    bridge_manifest = args.bridge / "slack-app" / "manifest.yaml"
    if bridge_manifest.is_file():
        # The handler include_str!s this file for its own contract test, so a
        # divergent copy means the two repositories test different things.
        report.check(
            bridge_manifest.read_text()
            == (ROOT / "app" / "manifest.request-url.yaml").read_text(),
            "ai-agent-bridge/slack-app/manifest.yaml matches the request-url render",
            "copy app/manifest.request-url.yaml over it",
        )
    else:
        report.check(False, "ai-agent-bridge/slack-app/manifest.yaml exists")

    report.section("installed app identity")
    report.check(source["app_id"] in everything, f"app id {source['app_id']} is pinned in tests")
    report.check(source["team_id"] in everything, f"team id {source['team_id']} is pinned in tests")

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
