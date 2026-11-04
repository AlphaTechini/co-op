#!/usr/bin/env bash
# Builds both contracts and refreshes contracts/res (wasm + SHA256SUMS).
#
# Requires cargo-near 0.22.0:  cargo install cargo-near --version 0.22.0 --locked
# (cargo-near builds with the flags near-sdk 5.x needs and runs wasm-opt for size).
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
RES="$ROOT/res"

if ! cargo near --version >/dev/null 2>&1; then
  echo "cargo-near not found. Install it with:" >&2
  echo "  cargo install cargo-near --version 0.22.0 --locked" >&2
  exit 1
fi

# Build paths end up in panic messages inside the wasm. Map the registry and toolchain folders to
# neutral names so the deployed binary does not carry the builder's home directory.
# `-C link-arg=-s` is cargo-near's own default, kept because --env replaces RUSTFLAGS.
CARGO_DIR="${CARGO_HOME:-$HOME/.cargo}"
RUSTUP_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
if command -v cygpath >/dev/null 2>&1; then
  # Git Bash on Windows: rustc sees C:\Users\..., not /c/Users/...
  CARGO_DIR="$(cygpath -w "$CARGO_DIR")"
  RUSTUP_DIR="$(cygpath -w "$RUSTUP_DIR")"
fi
WASM_RUSTFLAGS="-C link-arg=-s --remap-path-prefix=$CARGO_DIR=/cargo --remap-path-prefix=$RUSTUP_DIR=/rustup"

mkdir -p "$RES"
rm -f "$RES"/*.wasm "$RES"/SHA256SUMS

for crate in coop credits-token; do
  echo "==> building $crate"
  (cd "$ROOT/$crate" && cargo near build non-reproducible-wasm --no-abi --out-dir "$RES" --env "RUSTFLAGS=$WASM_RUSTFLAGS")
done

chmod 644 "$RES"/*.wasm
# sha256sum on Windows marks binary mode with '*'; keep the plain two-space format everywhere.
(cd "$RES" && sha256sum *.wasm | sed 's/ \*/  /' > SHA256SUMS && cat SHA256SUMS)
