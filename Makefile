BRIDGE ?= ../ai-agent-bridge

.PHONY: help render check verify harness test

help:
	@echo "make render                    rewrite both transport manifests from app/app.json"
	@echo "make check                     fail if either rendered manifest is stale"
	@echo "make verify  BRIDGE=<path>     manifests <-> handler contract (both transports)"
	@echo "make harness BRIDGE=<path>     behavioural fuzz of the extracted logic (rustc only)"
	@echo "make test    BRIDGE=<path>     the bridge's Slack suite (needs cargo)"

render:
	@python3 scripts/render_manifest.py

check:
	@python3 scripts/render_manifest.py --check

verify: check
	@python3 scripts/verify_contract.py --bridge $(BRIDGE)

harness:
	@cd tests/harness && python3 check_verbatim.py $(abspath $(BRIDGE))/src/slack_commands_parts
	@cd tests/harness && rustc --edition 2021 -O main.rs -o /tmp/soi-harness && /tmp/soi-harness

test:
	cd $(BRIDGE) && cargo test --locked slack
