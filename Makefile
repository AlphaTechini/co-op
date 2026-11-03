# Co-op. Run `make verify` to see the whole mechanism work locally: no keys, no wallet, no testnet.
SHELL := /bin/bash
.DEFAULT_GOAL := help

# neard wants a high open-file limit; raise the soft limit where the hard limit allows it (macOS defaults to 256).
RAISE_NOFILE := ulimit -n 65535 2>/dev/null || ulimit -n $$(ulimit -Hn) 2>/dev/null || true
SHA256 := $(shell command -v sha256sum >/dev/null 2>&1 && echo "sha256sum" || echo "shasum -a 256")

.PHONY: help install verify verify-wasm check test-integration checks checks-testnet demo demo-chain demo-server demo-web wasm clean-sandbox

help:
	@echo "make verify            install, start a local sandbox, deploy the committed wasm, run a 10-agent scenario, print the receipt"
	@echo "make check             contract tests (cargo), unit tests and typecheck of every package"
	@echo "make test-integration  integration tests against a real sandbox"
	@echo "make checks            capability checks that run locally (02, 03, 04, 06)"
	@echo "make demo              sandbox + endless scenario + server + web dev servers"
	@echo "make wasm              rebuild contracts/res/*.wasm (needs cargo-near 0.22.0)"

install:
	pnpm install --frozen-lockfile || pnpm install

# Hash of the committed wasm, compared with contracts/res/SHA256SUMS.
verify-wasm:
	@echo "== SHA-256 of the committed wasm (the files deployed below)"
	@cd contracts/res && $(SHA256) coop.wasm credits_token.wasm
	@cd contracts/res && $(SHA256) -c SHA256SUMS

verify: install verify-wasm
	@echo
	@echo "== 10-agent scenario on a local near-sandbox (nearcore 2.14.0), about 1 minute"
	@$(RAISE_NOFILE); pnpm --filter @coop/agents scenario --agents 10 --network sandbox

check:
	@if command -v cargo >/dev/null 2>&1; then cargo test; else echo "SKIP cargo test: cargo is not installed (the committed wasm in contracts/res is still verified by 'make verify')"; fi
	pnpm -r --if-present run check

test-integration: install
	@$(RAISE_NOFILE); pnpm --filter @coop/agents test:integration

checks: install
	@$(RAISE_NOFILE); set -e; \
	pnpm --filter @coop/checks exec tsx 02-fckey.ts --network sandbox; \
	pnpm --filter @coop/checks exec tsx 03-sandbox.ts; \
	pnpm --filter @coop/checks exec tsx 04-settle-gas.ts; \
	pnpm --filter @coop/checks exec tsx 06-llm.ts; \
	echo; echo "01 (faucet) and 05 (testnet RPC) need testnet access: make checks-testnet"

checks-testnet: install
	pnpm --filter @coop/checks exec tsx 01-faucet.ts
	pnpm --filter @coop/checks exec tsx 05-rpc.ts

# Sandbox on a fixed port (writes .sandbox/env), a new offer about every two minutes, plus the server and web dev servers.
demo: install
	@rm -f .sandbox/env
	@$(MAKE) -j3 demo-chain demo-server demo-web

demo-chain:
	@$(RAISE_NOFILE); pnpm --filter @coop/agents demo

demo-server:
	@echo "waiting for .sandbox/env ..."; until [ -f .sandbox/env ]; do sleep 1; done
	@set -a; . .sandbox/env; set +a; pnpm --filter @coop/server dev

demo-web:
	@until [ -f .sandbox/env ]; do sleep 1; done
	@set -a; . .sandbox/env; set +a; pnpm --filter @coop/web dev

clean-sandbox:
	rm -rf .sandbox

wasm:
	./contracts/build.sh
