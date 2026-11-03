// Build-time public configuration (SvelteKit 3 explicit env). Values are inlined into the bundle;
// the optional runtime override comes from GET ${PUBLIC_API_URL}/api/config (see lib/config.svelte.ts).
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => (value === undefined || value === '' ? undefined : value);

export const variables = defineEnvVars({
  PUBLIC_NETWORK: { public: true, static: true, schema: optional, description: 'testnet, sandbox or mainnet label shown in the header' },
  PUBLIC_RPC_URL: { public: true, static: true, schema: optional, description: 'NEAR JSON-RPC endpoint used for view calls' },
  PUBLIC_COOP_CONTRACT_ID: { public: true, static: true, schema: optional, description: 'Account id of the coop contract' },
  PUBLIC_API_URL: { public: true, static: true, schema: optional, description: 'Base URL of the optional Co-op server' }
});
