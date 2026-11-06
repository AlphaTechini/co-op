// The wallet transactions that create the visitor's agents (see server/src/wallet-spawn.ts).
// Per agent: a sub-account of the visitor with gas money and the server's join/leave key, then
// register_agent with the agent's budget. No full-access key is added: wallets such as Meteor refuse any
// app that asks for one, and the owner never needs it, because withdraw is signed by the owner's wallet.
import type { PrepareResponse } from './models';
import type { WalletTx } from './wallet.svelte';

export interface AgentBatch {
  transactions: WalletTx[];
  totalYocto: bigint;
}

export function buildAgentBatch(prep: PrepareResponse): AgentBatch {
  const transactions: WalletTx[] = [];
  for (const agent of prep.agents) {
    transactions.push({
      receiverId: agent.agent_id,
      actions: [
        { type: 'CreateAccount' },
        { type: 'Transfer', params: { deposit: prep.gas_yocto } },
        {
          type: 'AddKey',
          params: {
            publicKey: agent.fc_public_key,
            accessKey: { nonce: 0, permission: { receiverId: prep.contract_id, methodNames: prep.methods } }
          }
        }
      ]
    });
    transactions.push({
      receiverId: prep.contract_id,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'register_agent',
            args: { agent_id: agent.agent_id, limits: prep.limits },
            gas: prep.register_gas,
            deposit: prep.budget_yocto
          }
        }
      ]
    });
  }
  const per = BigInt(prep.budget_yocto) + BigInt(prep.gas_yocto);
  return { transactions, totalYocto: per * BigInt(prep.agents.length) };
}
