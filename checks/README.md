# checks

Capability checks from PRD section 11. Each script prints `PASS` / `FAIL` / `SKIP` lines with evidence and sets the exit code ([lib.ts](lib.ts)).

| Check | File | Needs | Run with |
|---|---|---|---|
| 01 operator account exists and is funded | [01-faucet.ts](01-faucet.ts) | testnet, `.env` operator | `make checks-testnet` |
| 02 sub-account + function-call key joins with zero deposit, and can do nothing else | [02-fckey.ts](02-fckey.ts) | sandbox (or testnet with `--network testnet`) | `make checks` |
| 03 sandbox boots, deploys the committed wasm, time-travels | [03-sandbox.ts](03-sandbox.ts) | sandbox | `make checks` |
| 04 settlement gas for 10, 25 and 50 members | [04-settle-gas.ts](04-settle-gas.ts) | sandbox | `make checks` |
| 05 testnet RPC holds up at the dashboard's polling rate | [05-rpc.ts](05-rpc.ts) | testnet | `make checks-testnet` |
| 06 optional LLM brief parsing | [06-llm.ts](06-llm.ts) | `LLM_*` in `.env`, else SKIP | `make checks` |

## Decisions and tradeoffs

- **Checks write evidence.** 02, 03 and 04 rewrite `evidence/check-02-fckey-sandbox.txt`, `evidence/check-03-sandbox.txt` and `evidence/gas.md`, so a run on another machine shows up as a diff of measured numbers rather than silently passing.
- **Sandbox checks need Linux or Apple Silicon macOS** (near-sandbox). On Windows, run them in WSL.

## Logic map

- To find the shared PASS / FAIL / SKIP output visit [lib.ts](lib.ts).
- To find the gas measurement and the chunk-size reasoning visit [04-settle-gas.ts](04-settle-gas.ts).
- The sandbox and chain helpers the checks use can be found in [../agents/src/world.ts](../agents/src/world.ts).
