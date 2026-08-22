BRIDGE ?= ../ai-agent-bridge

.PHONY: help render check verify test

help:
	@echo "make render                    rewrite both transport manifests from app/app.json"
	@echo "make check                     fail if either rendered manifest is stale"
	@echo "make verify  BRIDGE=<path>     manifests <-> handler contract (both transports)"
	@echo "make test    BRIDGE=<path>     the bridge's Slack suite (needs cargo)"

render:
	@python3 scripts/render_manifest.py

check:
	@python3 scripts/render_manifest.py --check

verify: check
	@python3 scripts/verify_contract.py --bridge $(BRIDGE)

test:
	cd $(BRIDGE) && cargo test --locked slack
