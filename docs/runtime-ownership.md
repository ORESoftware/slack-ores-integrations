# Runtime ownership

This repository owns the Slack app manifest, local Slack CLI and Socket Mode workflow, command aliases, configuration validation, and compatibility tests for `alex-main-agent`.

Production signed HTTP ingress, authorization, durable runs, Linear/GitHub dispatch, and Kubernetes operation remain owned by [`ORESoftware/ai-agent-bridge.rs@03f38e876daec61eba587f6cb87393d3cc2a7dac`](https://github.com/ORESoftware/ai-agent-bridge.rs/commit/03f38e876daec61eba587f6cb87393d3cc2a7dac). The two canonical signed command endpoints are:

- Anthropic/Claude: `/slack/commands/ores-claude`
- OpenAI/ChatGPT: `/slack/commands/ores-chatgpt`

All six `/ores-*`, `/x-*`, and `/my-*` aliases map by provider to those two endpoints. Local `slack run` development does not imply or replace the Kubernetes production deployment in `ORESoftware/k8s-cluster`.
