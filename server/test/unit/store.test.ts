import { mkdtempSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAgentStore, type AgentRecord } from "../../src/store.js";

const record: AgentRecord = {
  agent_id: "a-bot.op.near",
  archetype: "eager",
  brief: "buy 1 below 1",
  policy: { archetype: "eager", units: 1, max_unit_price: "1000" },
  created_at: 1,
  fc_secret: "ed25519:fc",
  full_secret: "ed25519:full",
};

describe("FileAgentStore", () => {
  it("round-trips with mode 0600 and a private directory", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "coop-store-")), ".data");
    const store = new FileAgentStore(join(dir, "agents.json"), { network: "sandbox", contractId: "coop.near" });
    expect(store.load()).toEqual([]);
    store.save([record]);
    expect(statSync(join(dir, "agents.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(store.load()).toEqual([record]);
  });

  it("sets a file for another deployment aside instead of overwriting its keys", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "coop-store-")), ".data");
    new FileAgentStore(join(dir, "agents.json"), { network: "sandbox", contractId: "old.near" }).save([record]);
    const next = new FileAgentStore(join(dir, "agents.json"), { network: "sandbox", contractId: "new.near" });
    expect(next.load()).toEqual([]);
    const kept = readdirSync(dir).filter((f) => f.endsWith(".other"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, kept[0]!), "utf8")).toContain("ed25519:full");
  });

  it("retire keeps keys in a 0600 sibling file", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "coop-store-")), ".data");
    const store = new FileAgentStore(join(dir, "agents.json"), { network: "sandbox", contractId: "coop.near" });
    store.retire([record]);
    store.retire([{ ...record, agent_id: "b-bot.op.near" }]);
    const file = join(dir, "agents.json.retired");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(2);
  });
});
