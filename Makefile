BRIDGE ?= ../ai-agent-bridge

.PHONY: verify test fmt help

help:
	@echo "make verify   BRIDGE=<path>  manifest <-> handler drift check"
	@echo "make test     BRIDGE=<path>  the bridge's Slack test suite (needs cargo)"

verify:
	@python3 scripts/verify_contract.py --bridge $(BRIDGE)

test:
	cd $(BRIDGE) && cargo test --locked slack
