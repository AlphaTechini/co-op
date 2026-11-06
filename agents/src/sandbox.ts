/**
 * Local near-sandbox harness. Always starts nearcore 2.14.0 (SANDBOX_VERSION): the 0.3.4 package
 * default (2.13.4) cannot link near-sdk 5.30 wasm.
 */
import type { ChildProcess } from "node:child_process";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { SANDBOX_VERSION } from "./config.js";

export interface SandboxHandle {
  rpcUrl: string;
  homeDir: string;
  /** Genesis account with 10,000 NEAR and full access. */
  rootAccountId: string;
  rootSecretKey: string;
  version: string;
  /** Skips blocks with the sandbox_fast_forward RPC (about 0.29 s of chain time per block). */
  fastForward(deltaHeight: number): Promise<void>;
  /** Kills the node and removes its home directory. */
  stop(): Promise<void>;
}

const running = new Set<Sandbox>();
let handlersInstalled = false;

/** How long neard gets to exit after SIGTERM before it is killed, and how long to wait after that. */
const STOP_GRACE_MS = 3_000;
const KILL_WAIT_MS = 5_000;

/**
 * near-sandbox's tearDown sends SIGTERM and then waits for neard's exit with no time limit, and neard
 * sometimes hangs in its own shutdown, so a finished run never returns. Kill it if it outlives the
 * grace period, and stop waiting altogether if even that produces no exit (a child that already died).
 */
async function tearDownBounded(sandbox: Sandbox): Promise<void> {
  // `childProcess` is private in the types but a plain field at runtime (near-sandbox is pinned to 0.3.4).
  const child = (sandbox as unknown as { childProcess?: ChildProcess }).childProcess;
  const done = sandbox.tearDown();
  const timers: NodeJS.Timeout[] = [];
  const gaveUp = new Promise<"gave-up">((resolve) => {
    timers.push(setTimeout(() => child?.kill("SIGKILL"), STOP_GRACE_MS));
    timers.push(setTimeout(() => resolve("gave-up"), STOP_GRACE_MS + KILL_WAIT_MS));
  });
  try {
    if ((await Promise.race([done, gaveUp])) === "gave-up") {
      console.warn(`near-sandbox did not stop within ${(STOP_GRACE_MS + KILL_WAIT_MS) / 1000} s; left ${sandbox.homeDir} in place`);
    }
  } finally {
    for (const t of timers) clearTimeout(t);
  }
}

function installSignalHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const shutdown = (signal: NodeJS.Signals) => {
    // A killed parent would orphan the neard child (and its port), so tear down first.
    void Promise.allSettled([...running].map((s) => tearDownBounded(s))).finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const FD_HINT =
  "neard could not raise its open-file limit. Run `ulimit -n 65535` before starting " +
  "(Docker: `--ulimit nofile=65535:65535`).";

export async function startSandbox(options: { version?: string; rpcPort?: number } = {}): Promise<SandboxHandle> {
  const version = options.version ?? SANDBOX_VERSION;
  installSignalHandlers();
  // near-sandbox gives neard 10 s to answer /status by default; a first run on a fresh machine needs longer.
  process.env.NEAR_RPC_TIMEOUT_SECS ??= "60";
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.start({
      version,
      ...(options.rpcPort !== undefined ? { config: { rpcPort: options.rpcPort } } : {}),
    });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/file descriptor|nofile|ulimit/i.test(text)) throw new Error(`${text}\n${FD_HINT}`, { cause: e });
    throw e;
  }
  running.add(sandbox);
  const rpcUrl = sandbox.rpcUrl;
  return {
    rpcUrl,
    homeDir: sandbox.homeDir,
    rootAccountId: DEFAULT_ACCOUNT_ID,
    rootSecretKey: DEFAULT_PRIVATE_KEY,
    version,
    async fastForward(deltaHeight: number) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sandbox_fast_forward", params: { delta_height: deltaHeight } }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await response.json()) as { error?: unknown };
      if (body.error) throw new Error(`sandbox_fast_forward failed: ${JSON.stringify(body.error)}`);
    },
    async stop() {
      running.delete(sandbox);
      await tearDownBounded(sandbox);
    },
  };
}
