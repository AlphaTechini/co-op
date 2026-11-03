import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";

/** nearcore version started by near-sandbox. 0.3.4 defaults to 2.13.4, which cannot run near-sdk 5.30 wasm. */
export const SANDBOX_VERSION = "2.14.0";

export type NetworkName = "sandbox" | "testnet";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WASM_DIR = join(REPO_ROOT, "contracts", "res");
export const COOP_WASM = join(WASM_DIR, "coop.wasm");
export const TOKEN_WASM = join(WASM_DIR, "credits_token.wasm");
export const SHA256SUMS = join(WASM_DIR, "SHA256SUMS");
export const EVIDENCE_DIR = join(REPO_ROOT, "evidence");
export const SANDBOX_DIR = join(REPO_ROOT, ".sandbox");
export const SANDBOX_ENV_FILE = join(SANDBOX_DIR, "env");

export const TESTNET_RPC_URLS = [
  "https://test.rpc.fastnear.com",
  "https://near-testnet.drpc.org",
  "https://testnet-rpc.intea.rs",
] as const;

export interface NetworkConfig {
  network: NetworkName;
  /** Primary first; the rest are failover endpoints. */
  rpcUrls: string[];
  explorerTxBase: string | null;
  explorerAccountBase: string | null;
}

/**
 * Loads `<repo>/.env` (if present) into process.env without overriding variables already set.
 * With NEAR_NETWORK=sandbox it also reads `.sandbox/env`, which `make demo` writes.
 */
export function loadEnv(): void {
  const apply = (file: string, override: boolean) => {
    if (!existsSync(file)) return;
    for (const [key, value] of Object.entries(parseDotenv(readFileSync(file)))) {
      if (override || process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
    }
  };
  apply(join(REPO_ROOT, ".env"), false);
  if (process.env.NEAR_NETWORK === "sandbox") apply(SANDBOX_ENV_FILE, true);
}

export function parseNetwork(value: string | undefined, fallback: NetworkName = "sandbox"): NetworkName {
  if (value === undefined || value === "") return fallback;
  if (value === "sandbox" || value === "testnet") return value;
  throw new Error(`Unknown network "${value}": expected "sandbox" or "testnet"`);
}

export function networkConfig(network: NetworkName, env: NodeJS.ProcessEnv = process.env): NetworkConfig {
  if (network === "sandbox") {
    const url = env.NEAR_RPC_URL;
    return { network, rpcUrls: url ? [url] : [], explorerTxBase: null, explorerAccountBase: null };
  }
  const primary = env.NEAR_RPC_URL && env.NEAR_RPC_URL !== "" ? env.NEAR_RPC_URL : TESTNET_RPC_URLS[0];
  const rpcUrls = [primary, ...TESTNET_RPC_URLS.filter((u) => u !== primary)];
  return {
    network,
    rpcUrls,
    explorerTxBase: "https://testnet.nearblocks.io/txns/",
    explorerAccountBase: "https://testnet.nearblocks.io/address/",
  };
}

export function explorerTxUrl(config: NetworkConfig, hash: string): string | undefined {
  return config.explorerTxBase ? `${config.explorerTxBase}${hash}` : undefined;
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}
