# contracts/res

The committed build of both contracts, so `make verify` and the deploy scripts need no Rust toolchain.

| File | Purpose |
|---|---|
| `coop.wasm` | Co-op contract |
| `credits_token.wasm` | Demo item token |
| [SHA256SUMS](SHA256SUMS) | SHA-256 of both files |

## Decisions and tradeoffs

- **Hashes are checked twice**: before deploying (the deploy refuses a wasm that differs from `SHA256SUMS`) and after (the on-chain `code_hash` must match). To find that check visit [../../agents/src/deploy.ts](../../agents/src/deploy.ts).
- **Rebuilds are not byte-identical across machines.** The output depends on the rustc version and host toolchain (the committed files: rustc 1.96.0 on `x86_64-pc-windows-msvc`, cargo-near 0.22.0), so `./contracts/build.sh` elsewhere can produce a different hash. The committed hash describes the committed file.
- **No home directory in the binary.** Source paths in panic messages are remapped to `/cargo` and `/rustup` by `build.sh`.
- To find the build script visit [../build.sh](../build.sh).
