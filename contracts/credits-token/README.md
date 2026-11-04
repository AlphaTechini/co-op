# contracts/credits-token

Demo NEP-141 + NEP-145 token ("API credit voucher", decimals 0) that the demo seller deposits as inventory. It stands in for a real merchant's goods and says so in its metadata.

- [Cargo.toml](Cargo.toml): crate manifest.
- The source can be found in [src/](src/README.md).

## Decisions and tradeoffs

- **Built on `near-contract-standards`** rather than a hand-written token, so transfers and storage follow the standards exactly.
- **Decimals 0**: one token is one Co-op unit (`unit_amount = "1"`), which keeps receipts readable.
- **Owner-only `mint` with 1 yocto**, so a function-call key can never mint.
