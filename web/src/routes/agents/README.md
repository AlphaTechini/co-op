# web/src/routes/agents

- [+page.svelte](+page.svelte): `/agents`, "My agents". Lists the agents registered to the connected wallet with their free and locked budget, and withdraws every free budget in one wallet approval.

## Decisions and tradeoffs

- **Withdrawal is manual.** Settlement credits each agent's unspent lock back to its free budget inside the contract; nothing is pushed to the owner automatically. `withdraw` needs 1 yoctoNEAR attached, which a function-call key cannot send, so only the owner's wallet can call it.
- **No owner index on chain.** The page pages through `list_agents` and filters by owner in the browser. Fine at demo scale; an owner index view would be the fix past a few thousand agents.
- **Gas money on agent accounts is not covered.** The NEAR each agent account holds for gas stays on that account; moving it needs the agent's full-access key, which the spawn flow left in the owner's browser.

To find the withdraw call visit [../../lib/components/MyAgents.svelte](../../lib/components/MyAgents.svelte) (`withdrawAll`); the owner lookup can be found in [../../lib/chain.ts](../../lib/chain.ts) (`listAgentsOwnedBy`). The contract side is `withdraw` in [../../../../contracts/coop/src/agent.rs](../../../../contracts/coop/src/agent.rs).
