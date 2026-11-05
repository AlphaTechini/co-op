# Testnet deploy

- When: 2026-11-04T14:33:31.258Z
- Network: testnet (protocol 88, neard 2.14.0-rc.5)
- Operator: [`coop-alpha.testnet`](https://testnet.nearblocks.io/address/coop-alpha.testnet)
- Co-op contract: [`coop.coop-alpha.testnet`](https://testnet.nearblocks.io/address/coop.coop-alpha.testnet)
- Demo item token: [`credits.coop-alpha.testnet`](https://testnet.nearblocks.io/address/credits.coop-alpha.testnet) (a demo voucher; the seller is the operator, not a real merchant)

## Deployed code

| file | SHA-256 (matches contracts/res/SHA256SUMS) | on-chain code_hash (base58 of the same hash) |
|---|---|---|
| coop.wasm | `1023254439a84cf4240820728c552fb6f9783881af4e15d0cb866bd237bab4b1` | `25zc9skAWedyEjyB2CDDCYaCCkZ6d8bqBqQZxTtZjUwz` |
| credits_token.wasm | `345332183cdc391ff269bf71b2c282f10a2201e1cb4e66c5419f6b65614b9848` | `4XFnBSmdLCTWX4JYv3F8ioUmbdnpZSJBz5n1JFw5bWkf` |

Both on-chain `code_hash` values were read back with `view_account` after the deploy and equal the local hashes.

## Transactions

| method | signer | receiver | tx |
|---|---|---|---|
| `create_account` | `coop-alpha.testnet` | `coop.coop-alpha.testnet` | [`4dgfZMdCkCVZxKy6TRFPaBjhniW8BVx2R5Dv8TQMrpgC`](https://testnet.nearblocks.io/txns/4dgfZMdCkCVZxKy6TRFPaBjhniW8BVx2R5Dv8TQMrpgC) |
| `deploy+new` | `coop.coop-alpha.testnet` | `coop.coop-alpha.testnet` | [`FpL5FTc2EfyiXnKiZxLW8f1QZCqW3DHeL2ML97rGc2yu`](https://testnet.nearblocks.io/txns/FpL5FTc2EfyiXnKiZxLW8f1QZCqW3DHeL2ML97rGc2yu) |
| `create_account` | `coop-alpha.testnet` | `credits.coop-alpha.testnet` | [`Ac6TpEbWqtJQtpXkNLydJjWcxwsR42PQGHu69YYXwHW3`](https://testnet.nearblocks.io/txns/Ac6TpEbWqtJQtpXkNLydJjWcxwsR42PQGHu69YYXwHW3) |
| `deploy+new` | `credits.coop-alpha.testnet` | `credits.coop-alpha.testnet` | [`7gi9hcmkXM3AcbpVN24UNEQj1eEvkAC8bRGhzGEKg1ZF`](https://testnet.nearblocks.io/txns/7gi9hcmkXM3AcbpVN24UNEQj1eEvkAC8bRGhzGEKg1ZF) |
| `storage_deposit` | `coop-alpha.testnet` | `credits.coop-alpha.testnet` | [`HaANEH45tDZB3BVpzA97gorf9ecGD34xU2R9e4wdRnTF`](https://testnet.nearblocks.io/txns/HaANEH45tDZB3BVpzA97gorf9ecGD34xU2R9e4wdRnTF) |

## Environment

```
COOP_CONTRACT_ID=coop.coop-alpha.testnet
CREDITS_TOKEN_ID=credits.coop-alpha.testnet
PUBLIC_COOP_CONTRACT_ID=coop.coop-alpha.testnet
```

Next: `pnpm --filter @coop/agents scenario --network testnet`, and, once everything is verified, `pnpm --filter @coop/agents lock-contract --yes` to delete the contract account's full-access key.
