# agents/src

TypeScript sources of `@coop/agents`. Amounts are BigInt yoctoNEAR everywhere; strings appear only at the JSON boundary ([money.ts](money.ts)).

## Decisions and tradeoffs

- **A `World` bundles one run** (network, provider, client, operator, deployed contracts), so the same scenario code runs on the sandbox and on testnet ([world.ts](world.ts)).
- **Deploys verify their input.** The committed wasm is checked against `contracts/res/SHA256SUMS` before deploying and against the on-chain `code_hash` after ([deploy.ts](deploy.ts)).
- **Keys can be supplied by the caller.** `provisionAgent` accepts pre-generated keys so the server can store them before the first transaction ([world.ts](world.ts)).

## Files

| File | Purpose |
|---|---|
| [brief.ts](brief.ts) | Free-text brief to structured `Policy`: rules parser by default, optional OpenAI-compatible LLM |
| [chain.ts](chain.ts) | Typed near-api-js v7 client for the Co-op contract and the item token; sub-accounts and function-call keys |
| [config.ts](config.ts) | Network settings, `.env` loading, sandbox version and paths |
| [demo.ts](demo.ts) | `make demo-chain`: a long-lived sandbox with a new 12-agent offer roughly every round |
| [deploy.ts](deploy.ts) | SHA-256-checked deploy of the committed wasm |
| [deploy-testnet.ts](deploy-testnet.ts) | Testnet deploy under the operator account; writes `evidence/testnet-deploy.md` |
| [deploy-items.ts](deploy-items.ts) | `deploy:items`: the GPU-hours and dataset-seats demo tokens rooms can buy (same token wasm); writes `evidence/testnet-items.md` |
| [lock.ts](lock.ts) | Deleting an account's full-access keys (makes the contract un-upgradable) |
| [lock-contract.ts](lock-contract.ts) | CLI around `lock.ts`; dry run unless `--yes` |
| [money.ts](money.ts) | yoctoNEAR parsing, formatting and gas constants |
| [policy.ts](policy.ts) | Deterministic buying policy: eager, bargain and switcher archetypes |
| [receipt.ts](receipt.ts) | Text settlement receipt printed after a scenario |
| [roster.ts](roster.ts) | The demo cast of buyers and their limits |
| [runtime.ts](runtime.ts) | `AgentRuntime`: polls pools, plans and sends joins and leaves, runs the settler; an agent with `poolId` only considers that room's pool |
| [sandbox.ts](sandbox.ts) | near-sandbox harness: start, fast-forward, bounded shutdown |
| [scenario.ts](scenario.ts) | N buyers against one tiered offer, run to settlement; `make verify` |
| [seller.ts](seller.ts) | Posting offers with inventory and proposing better tiers for a stalled pool |
| [types.ts](types.ts) | Shapes pinned by `docs/SPEC.md` |
| [verify.ts](verify.ts) | Recomputes the invariants from chain views after a pool resolves |
| [world.ts](world.ts) | Builds a `World` and provisions agents (sub-account, function-call key, `register_agent`) |

## Logic map

- To find agent provisioning (account, key, registration) visit [world.ts](world.ts) (`provisionAgent`).
- To find the join and leave decision rules visit [policy.ts](policy.ts) (`decide`).
- To find the settler and the per-tick plan visit [runtime.ts](runtime.ts) (`tick`).
- To find the seller's offer improvement visit [seller.ts](seller.ts) (`proposeImprovement`).
- The NEAR RPC connection and the contract calls can be found in [chain.ts](chain.ts).
- The local sandbox can be found in [sandbox.ts](sandbox.ts).
