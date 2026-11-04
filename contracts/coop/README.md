# contracts/coop

The Co-op contract crate (near-sdk 5.30). Methods, the settlement algorithm, storage and gas are described in [../README.md](../README.md); interface shapes are pinned in [../../docs/SPEC.md](../../docs/SPEC.md).

- [Cargo.toml](Cargo.toml): crate manifest; `cdylib` for the wasm and `rlib` for the native unit tests.
- The sources can be found in [src/](src/README.md).

## Decisions and tradeoffs

- **No admin, no owner, no upgrade method.** `new()` stores nothing about its deployer; after `lock-contract` deletes the account's full-access keys, the code cannot change.
- **Native unit tests, not a sandbox, for contract logic.** Every money path is exercised in [src/tests.rs](src/tests.rs) with controlled block time, deposits and gas; the sandbox integration tests in `agents/test/integration` cover what only a real node shows (key permissions, receipts, gas).
