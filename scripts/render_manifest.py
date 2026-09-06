#!/usr/bin/env python3
"""Render both transport manifests from app/app.json.

A Slack app runs one transport at a time. With Socket Mode enabled, a slash
command that still carries a request URL fails at invocation with `invalid_url`,
so the Request URL config and the Socket Mode config are genuinely different
documents. Keeping two hand-maintained manifests is how the command set silently
drifts between them; rendering both from one source is how it cannot.

    python3 scripts/render_manifest.py           # write both manifests
    python3 scripts/render_manifest.py --check   # fail if either is stale (CI)

Deliberately stdlib-only and hand-rendered: this runs in CI before anything is
installed, and a byte-stable output is what makes --check meaningful.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app" / "app.json"

TRANSPORTS = {
    "request-url": ROOT / "app" / "manifest.request-url.yaml",
    "socket-mode": ROOT / "app" / "manifest.socket-mode.yaml",
}

BANNER = {
    "request-url": [
        "# GENERATED from app/app.json by scripts/render_manifest.py -- do not edit.",
        "#",
        "# Transport: signed Request URLs. Slack POSTs each command to its own",
        "# HTTPS endpoint with an X-Slack-Signature the handler verifies. This is",
        "# the reviewed production posture: per-request authentication, a bounded",
        "# replay window, and app/team pinning on every delivery.",
        "#",
        "# Requires the public endpoint to be live BEFORE this manifest is applied.",
        "# Slack starts delivering the moment the URL is named; if nothing answers,",
        "# users get dispatch failures in the composer.",
    ],
    "socket-mode": [
        "# GENERATED from app/app.json by scripts/render_manifest.py -- do not edit.",
        "#",
        "# Transport: Socket Mode. The handler opens an OUTBOUND WebSocket and Slack",
        "# pushes commands down it. No public endpoint, DNS record, TLS certificate",
        "# or inbound firewall rule is needed.",
        "#",
        "# The trade, stated plainly: frames carry no X-Slack-Signature and no",
        "# timestamp, so there is no per-request HMAC and no replay window. The",
        "# connection's xapp- token is the whole of the authentication. Everything",
        "# downstream -- provider agreement, app/team pinning, channel policy, the",
        "# run journal -- is shared with the Request URL path.",
        "#",
        "# Slash commands carry NO url here. Slack fails a command with 'invalid_url'",
        "# if one is set while Socket Mode is on.",
    ],
}


def render(source: dict, transport: str) -> str:
    lines: list[str] = list(BANNER[transport])
    lines += [
        "",
        "display_information:",
        f"  name: {source['name']}",
        f"  description: {source['description']}",
        f"  background_color: \"{source['background_color']}\"",
        "",
        "features:",
        "  bot_user:",
        f"    display_name: {source['name']}",
        "    always_online: false",
        "  slash_commands:",
    ]

    base = source["request_url_base"]
    for command in source["commands"]:
        name = command["name"]
        lines.append(f"    - command: /{name}")
        if transport == "request-url":
            lines.append(f"      url: {base}/slack/commands/{name}")
        lines += [
            f"      description: {command['description']}",
            f"      usage_hint: \"{command['usage_hint']}\"",
            "      should_escape: true",
        ]

    lines += [
        "",
        "oauth_config:",
        "  scopes:",
        "    bot:",
    ]
    lines += [f"      - {scope}" for scope in source["bot_scopes"]]

    lines += ["", "settings:", "  interactivity:", "    is_enabled: true"]
    if transport == "request-url":
        lines.append(f"    request_url: {base}/slack/interactions")
    else:
        lines.append("    # No request_url: Socket Mode delivers interactions over the socket.")
    lines += [
        "  org_deploy_enabled: false",
        f"  socket_mode_enabled: {'true' if transport == 'socket-mode' else 'false'}",
        "  token_rotation_enabled: true",
        "  is_mcp_enabled: false",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if a render is stale")
    args = parser.parse_args()

    source = json.loads(SOURCE.read_text())
    stale: list[str] = []

    for transport, path in TRANSPORTS.items():
        rendered = render(source, transport)
        if args.check:
            current = path.read_text() if path.is_file() else ""
            if current != rendered:
                stale.append(str(path.relative_to(ROOT)))
                print(f"  STALE  {path.relative_to(ROOT)}")
            else:
                print(f"  ok     {path.relative_to(ROOT)}")
        else:
            path.write_text(rendered)
            print(f"  wrote  {path.relative_to(ROOT)}")

    if stale:
        print(f"\n{len(stale)} manifest(s) out of date with app/app.json.")
        print("Run: make render")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
