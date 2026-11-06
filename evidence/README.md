# evidence

Captured output that the README and [../docs/CLAIMS.md](../docs/CLAIMS.md) cite as proof. The sandbox files come from a local nearcore 2.14.0; the testnet files come from the testnet scripts run against `coop-alpha.testnet`.

| File | Produced by | Shows |
|---|---|---|
| [sandbox-run.txt](sandbox-run.txt) | captured console output of `make verify` | The 10-agent run, the settlement receipt and the invariant check |
| [sandbox-run.json](sandbox-run.json) | captured copy of that run's `.sandbox/last-scenario.json` | Machine-readable log of the run with every transaction |
| [check-02-fckey-sandbox.txt](check-02-fckey-sandbox.txt) | `checks/02-fckey.ts` | The agent key joins with zero deposit and every other action is rejected |
| [check-03-sandbox.txt](check-03-sandbox.txt) | `checks/03-sandbox.ts` | Sandbox boot, protocol 88, code hash, fast-forward |
| [gas.md](gas.md) | `checks/04-settle-gas.ts` | Settlement gas per member and calls per pool size |
| [check-01-faucet.txt](check-01-faucet.txt) | `checks/01-faucet.ts` | The testnet operator account is funded and the protocol version is 88 |
| [testnet-deploy.md](testnet-deploy.md) | `pnpm --filter @coop/agents deploy:testnet` | Both contracts deployed on testnet with code hashes matching `contracts/res/SHA256SUMS` |
| [check-07-wallet-spawn.txt](check-07-wallet-spawn.txt) | `checks/07-wallet-spawn.ts` against the hosted server | An invite room, two agents created and funded by a test wallet (owner on chain), joining only that room, a refused withdraw on another owner's agent, settlement, and the owner's withdraw, each with a nearblocks link |
| [testnet-items.md](testnet-items.md) | `pnpm --filter @coop/agents deploy:items` | The GPU-hours and dataset-seats item tokens, same wasm and code hash as the credits token |
| [testnet-run-2026-11-05T11-55-16-789Z.md](testnet-run-2026-11-05T11-55-16-789Z.md) | `pnpm --filter @coop/agents scenario --agents 12 --network testnet --prefix run2` | The 12-agent testnet run: receipt, invariants, every transaction with a nearblocks link |
| [testnet-run-2026-11-05T11-55-16-789Z.json](testnet-run-2026-11-05T11-55-16-789Z.json) | same run | Machine-readable log of that run |

Pending (written by the testnet commands in the root README): `contract-lock.md`.

- To find the code that writes run logs (sandbox runs to `.sandbox/`, testnet runs to this folder) visit [../agents/src/scenario.ts](../agents/src/scenario.ts).
- To find the gas measurement visit [../checks/04-settle-gas.ts](../checks/04-settle-gas.ts).
