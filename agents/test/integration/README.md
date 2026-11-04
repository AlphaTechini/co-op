# agents/test/integration

Tests against a real local near-sandbox (nearcore 2.14.0). Run with `make test-integration`; each file starts and stops its own sandbox.

| File | What it proves |
|---|---|
| [chunked.test.ts](chunked.test.ts) | A 21-member pool settles over several `settle` calls and every invariant holds |
| [claim.test.ts](claim.test.ts) | A failed delivery becomes a claimable balance and a later `claim` pays it out |
| [fckey.test.ts](fckey.test.ts) | The agent key can join with zero deposit and nothing else; leave works before lock only; `settle` is refused early and idempotent after |
| [lock.test.ts](lock.test.ts) | `lock-contract` dry run changes nothing; the real run leaves no full-access keys and the contract keeps working |
| [negotiation.test.ts](negotiation.test.ts) | `improve_offer` accepts a better ladder, rejects a worse one, and the seller agent proposes valid improvements |
| [runtime.test.ts](runtime.test.ts) | A switcher moves to the cheaper pool before lock; a failing agent turns into error entries without stopping the others |
| [scenario.test.ts](scenario.test.ts) | 12 agents reach tier 2 but not tier 3 with every invariant holding; with no tier reached, everyone is refunded |
| [fixture.ts](fixture.ts) | Shared helpers: the tier ladder, agent and offer factories |

- To find how a test world is built visit [../../src/world.ts](../../src/world.ts) (`createSandboxWorld`).
- The sandbox start and shutdown can be found in [../../src/sandbox.ts](../../src/sandbox.ts).
