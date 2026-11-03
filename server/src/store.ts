/**
 * Persistence for spawned agents. The file holds PRIVATE KEYS (the agent's function-call key and the
 * full-access key of its account). It is git-ignored (server/.gitignore), written with mode 0600 and
 * must never be committed or shared.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Policy } from "@coop/agents/types";
import { z } from "zod";

export interface AgentRecord {
  agent_id: string;
  archetype: string;
  brief: string;
  policy: Policy;
  /** Milliseconds since epoch. */
  created_at: number;
  /** Function-call key (join_pool / leave_pool only). Secret. */
  fc_secret: string;
  /** Full-access key of the agent account (receives the delivered tokens). Secret. */
  full_secret: string;
}

const PolicySchema = z.object({
  archetype: z.enum(["eager", "bargain", "switcher"]),
  units: z.number().int().min(1),
  max_unit_price: z.string().regex(/^\d+$/),
  target_price: z.string().regex(/^\d+$/).optional(),
  allowed_sellers: z.array(z.string()).optional(),
  brief: z.string().optional(),
});

const RecordSchema = z.object({
  agent_id: z.string().min(2),
  archetype: z.string(),
  brief: z.string(),
  policy: PolicySchema,
  created_at: z.number(),
  fc_secret: z.string().min(1),
  full_secret: z.string().min(1),
});

const FileSchema = z.object({
  version: z.literal(1),
  network: z.string(),
  contract_id: z.string(),
  agents: z.array(RecordSchema),
});

export interface AgentStore {
  load(): AgentRecord[];
  save(records: AgentRecord[]): void;
  /** Keeps records the chain no longer knows in a sibling file instead of deleting their keys. */
  retire(records: AgentRecord[]): void;
}

function writeSecret(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export class FileAgentStore implements AgentStore {
  constructor(
    private readonly file: string,
    private readonly identity: { network: string; contractId: string },
  ) {}

  load(): AgentRecord[] {
    if (!existsSync(this.file)) return [];
    const parsed = FileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    if (parsed.network !== this.identity.network || parsed.contract_id !== this.identity.contractId) {
      // Another deployment: keep the keys aside rather than overwrite them.
      renameSync(this.file, `${this.file}.${Date.now()}.other`);
      return [];
    }
    return parsed.agents as AgentRecord[];
  }

  save(records: AgentRecord[]): void {
    writeSecret(
      this.file,
      JSON.stringify({ version: 1, network: this.identity.network, contract_id: this.identity.contractId, agents: records }, null, 2),
    );
  }

  retire(records: AgentRecord[]): void {
    if (records.length === 0) return;
    const file = `${this.file}.retired`;
    let previous: AgentRecord[] = [];
    if (existsSync(file)) {
      try {
        previous = JSON.parse(readFileSync(file, "utf8")) as AgentRecord[];
      } catch {
        previous = [];
      }
    }
    writeSecret(file, JSON.stringify([...previous, ...records], null, 2));
  }
}

/** In-memory store for tests. */
export class MemoryAgentStore implements AgentStore {
  saved: AgentRecord[] = [];
  retired: AgentRecord[] = [];
  constructor(private readonly initial: AgentRecord[] = []) {}
  load(): AgentRecord[] {
    return this.initial;
  }
  save(records: AgentRecord[]): void {
    this.saved = [...records];
  }
  retire(records: AgentRecord[]): void {
    this.retired.push(...records);
  }
}
