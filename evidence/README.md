# evidence

Captured output that the README and [../docs/CLAIMS.md](../docs/CLAIMS.md) cite as proof. Everything here so far comes from a local sandbox (nearcore 2.14.0); testnet files are added by the testnet scripts.

| File | Produced by | Shows |
|---|---|---|
| [sandbox-run.txt](sandbox-run.txt) | captured console output of `make verify` | The 10-agent run, the settlement receipt and the invariant check |
| [sandbox-run.json](sandbox-run.json) | captured copy of that run's `.sandbox/last-scenario.json` | Machine-readable log of the run with every transaction |
| [check-02-fckey-sandbox.txt](check-02-fckey-sandbox.txt) | `checks/02-fckey.ts` | The agent key joins with zero deposit and every other action is rejected |
| [check-03-sandbox.txt](check-03-sandbox.txt) | `checks/03-sandbox.ts` | Sandbox boot, protocol 88, code hash, fast-forward |
| [gas.md](gas.md) | `checks/04-settle-gas.ts` | Settlement gas per member and calls per pool size |

Pending (written by the testnet commands in the root README): `testnet-deploy.md`, `testnet-run-<time>.md` and `.json`, `contract-lock.md`.

- To find the code that writes run logs (sandbox runs to `.sandbox/`, testnet runs to this folder) visit [../agents/src/scenario.ts](../agents/src/scenario.ts).
- To find the gas measurement visit [../checks/04-settle-gas.ts](../checks/04-settle-gas.ts).
