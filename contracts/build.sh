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

mkdir -p "$RES"
rm -f "$RES"/*.wasm "$RES"/SHA256SUMS

for crate in coop credits-token; do
  echo "==> building $crate"
  (cd "$ROOT/$crate" && cargo near build non-reproducible-wasm --no-abi --out-dir "$RES")
done

chmod 644 "$RES"/*.wasm
(cd "$RES" && sha256sum *.wasm > SHA256SUMS && cat SHA256SUMS)
