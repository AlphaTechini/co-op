import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVIDENCE_DIR } from "@coop/agents/config";

/** Shared output helpers: every check prints PASS / FAIL / SKIP lines with evidence, and sets the exit code. */

export type Status = "PASS" | "FAIL" | "SKIP";

export interface Line {
  status: Status;
  name: string;
  evidence: string;
}

export class Report {
  readonly lines: Line[] = [];

  constructor(readonly title: string) {
    console.log(`\n== ${title}`);
  }

  private add(status: Status, name: string, evidence: string): void {
    this.lines.push({ status, name, evidence });
    console.log(`${status}  ${name}${evidence ? `  | ${evidence}` : ""}`);
  }

  pass(name: string, evidence = ""): void {
    this.add("PASS", name, evidence);
  }

  fail(name: string, evidence = ""): void {
    this.add("FAIL", name, evidence);
  }

  skip(name: string, evidence = ""): void {
    this.add("SKIP", name, evidence);
  }

  /** PASS if `ok`, else FAIL. */
  expect(ok: boolean, name: string, evidence = ""): boolean {
    if (ok) this.pass(name, evidence);
    else this.fail(name, evidence);
    return ok;
  }

  get failed(): boolean {
    return this.lines.some((l) => l.status === "FAIL");
  }

  /**
   * Overall verdict line; exit code 1 on any FAIL (SKIP is not a failure). With `saveAs`, a passing run
   * also writes its transcript to evidence/<saveAs>, so a failed or unreachable run never overwrites good evidence.
   */
  finish(saveAs?: string): number {
    const verdict = this.failed ? "FAIL" : this.lines.every((l) => l.status === "SKIP") ? "SKIP" : "PASS";
    console.log(`${verdict}  ${this.title}`);
    if (saveAs && verdict === "PASS") {
      const file = join(EVIDENCE_DIR, saveAs);
      mkdirSync(dirname(file), { recursive: true });
      const body = this.lines.map((l) => `${l.status}  ${l.name}${l.evidence ? `  | ${l.evidence}` : ""}`);
      writeFileSync(file, [`${this.title}`, `run at ${new Date().toISOString()}`, "", ...body, `PASS  ${this.title}`, ""].join("\n"));
      console.log(`evidence: evidence/${saveAs}`);
    }
    return this.failed ? 1 : 0;
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e);
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface RpcProbe {
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
  result?: unknown;
}

/** One JSON-RPC call with a timeout; never throws. */
export async function rpcCall(url: string, method: string, params: unknown, timeoutMs = 10_000): Promise<RpcProbe> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = performance.now() - started;
    if (!response.ok) return { ok: false, ms, status: response.status, error: `HTTP ${response.status}` };
    const body = (await response.json()) as { result?: unknown; error?: { message?: string; data?: unknown } };
    if (body.error) return { ok: false, ms, status: response.status, error: String(body.error.data ?? body.error.message ?? "rpc error") };
    return { ok: true, ms, status: response.status, result: body.result };
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    return { ok: false, ms: performance.now() - started, error: `${errorText(e)}${cause?.code ? ` (${cause.code})` : ""}` };
  }
}
