# server/test/integration

| File | What it proves |
|---|---|
| [spawn.test.ts](spawn.test.ts) | Against a real sandbox: the seller loop opens an offer, `POST /api/agents` spawns an agent that joins it, and the feed and config show it |

- To find the code under test visit [../../src/spawner.ts](../../src/spawner.ts) and [../../src/seller-loop.ts](../../src/seller-loop.ts).
- The sandbox world it runs on can be found in [../../../agents/src/world.ts](../../../agents/src/world.ts).
