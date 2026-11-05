# Testnet deploy: extra item tokens

- When: 2026-11-05T18:39:48.315Z
- Co-op contract: `coop.coop-alpha.testnet`
- Code: `contracts/res/credits_token.wasm`, the same file as the credits token; only the name and symbol passed to `new` differ.

| token | on-chain code_hash (matches SHA256SUMS) |
|---|---|
| [`gpu-hours.coop-alpha.testnet`](https://testnet.nearblocks.io/address/gpu-hours.coop-alpha.testnet) | `4XFnBSmdLCTWX4JYv3F8ioUmbdnpZSJBz5n1JFw5bWkf` |
| [`dataset-seats.coop-alpha.testnet`](https://testnet.nearblocks.io/address/dataset-seats.coop-alpha.testnet) | `4XFnBSmdLCTWX4JYv3F8ioUmbdnpZSJBz5n1JFw5bWkf` |

## Transactions

| method | signer | receiver | tx |
|---|---|---|---|
| `create_account` | `coop-alpha.testnet` | `gpu-hours.coop-alpha.testnet` | [`4iPfK3ZsBfSyun4va5jNFhqhxWJr9PcNwttodWDYp7Kd`](https://testnet.nearblocks.io/txns/4iPfK3ZsBfSyun4va5jNFhqhxWJr9PcNwttodWDYp7Kd) |
| `deploy+new` | `gpu-hours.coop-alpha.testnet` | `gpu-hours.coop-alpha.testnet` | [`9LYkx864NYy4gZQrnajBSNDC4dLnfjT4RkAPCUiWxTQk`](https://testnet.nearblocks.io/txns/9LYkx864NYy4gZQrnajBSNDC4dLnfjT4RkAPCUiWxTQk) |
| `storage_deposit` | `coop-alpha.testnet` | `gpu-hours.coop-alpha.testnet` | [`9LUYnYMrpQk3xXoyjs5BkuvJSyFY3fyKi9Na7DVKvmHD`](https://testnet.nearblocks.io/txns/9LUYnYMrpQk3xXoyjs5BkuvJSyFY3fyKi9Na7DVKvmHD) |
| `create_account` | `coop-alpha.testnet` | `dataset-seats.coop-alpha.testnet` | [`BSCNz7bJL6yrnyFUwBuWxdDMAFnhfaDpKZPY6xYPDkxr`](https://testnet.nearblocks.io/txns/BSCNz7bJL6yrnyFUwBuWxdDMAFnhfaDpKZPY6xYPDkxr) |
| `deploy+new` | `dataset-seats.coop-alpha.testnet` | `dataset-seats.coop-alpha.testnet` | [`Cdv5Ahc97Vpask963HAJmrnxRF3fDmfqGBrcUmprNcqn`](https://testnet.nearblocks.io/txns/Cdv5Ahc97Vpask963HAJmrnxRF3fDmfqGBrcUmprNcqn) |
| `storage_deposit` | `coop-alpha.testnet` | `dataset-seats.coop-alpha.testnet` | [`FT1zG59nrzQLp65oZoW3pPbcRtaqUrLy381D5NuQyW89`](https://testnet.nearblocks.io/txns/FT1zG59nrzQLp65oZoW3pPbcRtaqUrLy381D5NuQyW89) |

## Environment

```
GPU_HOURS_TOKEN_ID=gpu-hours.coop-alpha.testnet
DATASET_SEATS_TOKEN_ID=dataset-seats.coop-alpha.testnet
```
