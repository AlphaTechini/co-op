import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { harness, goodBody, OPERATOR, type FakeChain } from "./helpers.js";

type H = Awaited<ReturnType<typeof harness>>;
let current: H | null = null;
const make = async (over?: Parameters<typeof harness>[0]) => (current = await harness(over));
afterEach(async () => {
  await current?.app.close();
  current = null;
});

const post = (h: H, payload: unknown, ip = "10.0.0.1") =>
  h.app.inject({ method: "POST", url: "/api/agents", payload: payload as object, remoteAddress: ip });

describe("read routes", () => {
  it("health", async () => {
    const h = await make();
    const res = await h.app.inject({ url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, network: "sandbox", contractId: "coop.test.near", llm: "off" });
  });

  it("config has the SPEC 3.1 shape", async () => {
    const h = await make();
    const body = (await h.app.inject({ url: "/api/config" })).json();
    expect(body).toEqual({
      network: "sandbox",
      rpcUrl: "http://127.0.0.1:3030",
      contractId: "coop.test.near",
      tokenId: "token.test.near",
      explorerTxBase: "",
      explorerAccountBase: "",
      spawn: { enabled: true, maxBudgetNear: 2, remaining: 5 },
    });
  });

  it("sends CORS and security headers", async () => {
    const h = await make();
    const res = await h.app.inject({ url: "/api/health", headers: { origin: "https://web.example" } });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const pre = await h.app.inject({
      method: "OPTIONS",
      url: "/api/agents",
      headers: { origin: "https://web.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-headers"]).toBe("content-type");
  });

  it("honours a specific CORS origin", async () => {
    const h = await make({ settings: { corsOrigin: "https://web.example" } });
    const res = await h.app.inject({ url: "/api/health", headers: { origin: "https://web.example" } });
    expect(res.headers["access-control-allow-origin"]).toBe("https://web.example");
  });

  it("filters activity by pool and limit, newest first", async () => {
    const h = await make();
    for (let i = 1; i <= 6; i++) h.hub.emit({ kind: "decision", message: `m${i}`, pool_id: i % 2 === 0 ? 2 : 1, ts: 1000 + i });
    const all = (await h.app.inject({ url: "/api/activity" })).json<Array<{ message: string }>>();
    expect(all.map((e) => e.message)).toEqual(["m6", "m5", "m4", "m3", "m2", "m1"]);
    const pool2 = (await h.app.inject({ url: "/api/activity?pool_id=2&limit=2" })).json<Array<{ message: string; pool_id: number }>>();
    expect(pool2.map((e) => e.message)).toEqual(["m6", "m4"]);
    expect(pool2.every((e) => e.pool_id === 2)).toBe(true);
    expect((await h.app.inject({ url: "/api/activity?limit=abc" })).statusCode).toBe(400);
    expect((await h.app.inject({ url: "/api/activity?pool_id=-1" })).statusCode).toBe(400);
  });

  it("bounds the ring buffer", async () => {
    const h = await make();
    for (let i = 0; i < 80; i++) h.hub.emit({ kind: "decision", message: `m${i}` });
    expect(h.hub.list({ limit: 500 })).toHaveLength(50);
  });

  it("answers 404 in JSON", async () => {
    const h = await make();
    const res = await h.app.inject({ url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Not found." });
  });
});

describe("POST /api/agents validation (400)", () => {
  const cases: Array<[string, unknown, string]> = [
    ["short name", { ...goodBody, name: "a" }, "name"],
    ["long name", { ...goodBody, name: "a".repeat(25) }, "name"],
    ["uppercase name", { ...goodBody, name: "Alice" }, "name"],
    ["name ending in hyphen", { ...goodBody, name: "alice-" }, "name"],
    ["name with dot", { ...goodBody, name: "al.ice" }, "name"],
    ["name with double hyphen", { ...goodBody, name: "al--ice" }, "name"],
    ["missing name", { brief: goodBody.brief, budget_near: 1 }, "name"],
    ["short brief", { ...goodBody, brief: "hi" }, "brief"],
    ["long brief", { ...goodBody, brief: "x".repeat(201) }, "brief"],
    ["zero budget", { ...goodBody, budget_near: 0 }, "budget_near"],
    ["negative budget", { ...goodBody, budget_near: -1 }, "budget_near"],
    ["budget above the cap", { ...goodBody, budget_near: 2.5 }, "budget_near"],
    ["budget as string", { ...goodBody, budget_near: "1" }, "budget_near"],
    ["brief without a price", { ...goodBody, brief: "buy some credits please" }, "brief"],
    ["budget below what the brief needs", { ...goodBody, budget_near: 0.5 }, "budget_near"],
    ["too many decimals", { ...goodBody, brief: "buy 1 credit below 0.5", budget_near: 1.0000001 }, "budget_near"],
  ];
  for (const [label, body, field] of cases) {
    it(`rejects ${label}`, async () => {
      const h = await make();
      const res = await post(h, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ field });
      expect(typeof res.json().error).toBe("string");
      expect(h.chain.provisioned).toHaveLength(0);
    });
  }

  it("rejects malformed JSON and oversize bodies with the error shape", async () => {
    const h = await make();
    const bad = await h.app.inject({ method: "POST", url: "/api/agents", headers: { "content-type": "application/json" }, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
    expect(typeof bad.json().error).toBe("string");
    const big = await h.app.inject({ method: "POST", url: "/api/agents", payload: { ...goodBody, brief: "x".repeat(10_000) } });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: "Request body is too large." });
  });
});

describe("POST /api/agents spawn", () => {
  it("provisions, joins the runtime, persists, and returns every TxRef", async () => {
    const h = await make();
    const res = await post(h, goodBody);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.agent_id).toBe(`alice-bot.${OPERATOR}`);
    expect(body.parser).toBe("rules");
    expect(body.policy).toMatchObject({ archetype: "bargain", units: 3, max_unit_price: "600000000000000000000000" });
    expect(body.txs.map((t: { method: string }) => t.method)).toEqual(["create_account", "add_key", "register_agent"]);
    expect(body.txs[0]).toMatchObject({ hash: expect.any(String), signer: OPERATOR, receiver: body.agent_id });
    expect(body.txs[0].events).toBeUndefined();

    expect(h.runtime.agents.get(body.agent_id)?.policy.units).toBe(3);
    expect(h.chain.provisioned[0]).toEqual({ label: "alice-bot", budget: 2_000_000_000_000_000_000_000_000n });
    expect(h.store.saved.map((r) => r.agent_id)).toEqual([body.agent_id]);

    const list = (await h.app.inject({ url: "/api/agents" })).json();
    expect(list).toEqual([
      { agent_id: body.agent_id, archetype: "bargain", brief: goodBody.brief, policy: body.policy, created_at: expect.any(Number), status: "running" },
    ]);
    const feed = (await h.app.inject({ url: "/api/activity" })).json();
    expect(feed[0]).toMatchObject({ kind: "spawned", agent_id: body.agent_id, tx: { method: "register_agent" } });
    expect((await h.app.inject({ url: "/api/config" })).json().spawn.remaining).toBe(4);
  });

  it("never exposes key material", async () => {
    const h = await make();
    const parts = [
      (await post(h, goodBody)).body,
      (await h.app.inject({ url: "/api/agents" })).body,
      (await h.app.inject({ url: "/api/activity" })).body,
      (await h.app.inject({ url: "/api/config" })).body,
    ].join("\n");
    expect(parts).not.toMatch(/SECRET|ed25519:/);
  });

  it("409 when the name is already an account on chain", async () => {
    const h = await make();
    (h.chain as FakeChain).existing.add(`alice-bot.${OPERATOR}`);
    const res = await post(h, goodBody);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ field: "name" });
  });

  it("409 when the same name is spawned twice, including concurrently", async () => {
    const h = await make();
    const [a, b] = await Promise.all([post(h, goodBody, "10.0.0.1"), post(h, goodBody, "10.0.0.2")]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(h.chain.provisioned).toHaveLength(1);
  });

  it("429 with Retry-After after the per-IP hourly limit; other IPs unaffected", async () => {
    let now = 1_000_000;
    const h = await make({ settings: { spawnPerIpPerHour: 2 }, spawner: { perIpPerHour: 2 }, now: () => now });
    expect((await post(h, { ...goodBody, name: "one-a" })).statusCode).toBe(200);
    now += 60_000;
    expect((await post(h, { ...goodBody, name: "two-b" })).statusCode).toBe(200);
    const blocked = await post(h, { ...goodBody, name: "tre-c" });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(3000);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(3600);
    expect((await post(h, { ...goodBody, name: "tre-c" }, "10.0.0.9")).statusCode).toBe(200);
    now += 3_600_000;
    expect((await post(h, { ...goodBody, name: "fou-d" })).statusCode).toBe(200);
  });

  it("429 from the general rate limit", async () => {
    const h = await make({ settings: { rateLimitPerMin: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await h.app.inject({ url: "/api/health" })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const limited = await h.app.inject({ url: "/api/health" });
    expect(limited.json()).toMatchObject({ error: expect.stringContaining("Too many requests") });
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("503 when spawning is disabled (no operator key)", async () => {
    const h = await make({ spawner: { enabled: false, disabledReason: "Spawning is disabled: this server has no operator key." } });
    const res = await post(h, goodBody);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("no operator key");
    const cfg = (await h.app.inject({ url: "/api/config" })).json();
    expect(cfg.spawn.enabled).toBe(false);
  });

  it("503 when SPAWN_MAX_AGENTS is reached", async () => {
    const h = await make({ spawner: { maxAgents: 1 }, settings: { spawnMaxAgents: 1 } });
    expect((await post(h, goodBody)).statusCode).toBe(200);
    const res = await post(h, { ...goodBody, name: "bob-bot" }, "10.0.0.2");
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("limit of 1");
    expect((await h.app.inject({ url: "/api/config" })).json().spawn).toMatchObject({ enabled: false, remaining: 0 });
  });

  it("503 when the operator balance is below the safe floor, before provisioning", async () => {
    const h = await make();
    (h.chain as FakeChain).balance = 2_900_000_000_000_000_000_000_000n; // budget 2 + gas 0.12 + floor 1 = 3.12
    const res = await post(h, goodBody);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("low on funds");
    expect(h.chain.provisioned).toHaveLength(0);
  });

  it("502 with a generic message when the chain fails, and frees the name", async () => {
    const h = await make();
    (h.chain as FakeChain).fail = true;
    const res = await post(h, goodBody);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("internal details");
    (h.chain as FakeChain).fail = false;
    expect((await post(h, goodBody)).statusCode).toBe(200);
  });
});

describe("resume", () => {
  it("re-adds persisted agents and retires those the chain forgot", async () => {
    const h = await make();
    await post(h, goodBody);
    await post(h, { ...goodBody, name: "bob-bot" });
    const records = h.store.saved;
    expect(records).toHaveLength(2);

    const second = await harness();
    (second.store as unknown as { initial: unknown }).initial = records;
    (second.chain as FakeChain).registered.set(`bob-bot.${OPERATOR}`, false);
    const result = await second.spawner.resume();
    expect(result).toEqual({ resumed: 1, retired: 1 });
    expect([...second.runtime.agents.keys()]).toEqual([`alice-bot.${OPERATOR}`]);
    expect(second.store.retired.map((r) => r.agent_id)).toEqual([`bob-bot.${OPERATOR}`]);
    expect(second.store.saved).toHaveLength(1);
    await second.app.close();
  });
});

describe("GET /api/stream", () => {
  it("is an event stream with heartbeat comment and live entries", async () => {
    const h = await make();
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (h.app.server.address() as AddressInfo).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/stream`, { signal: ctrl.signal, headers: { origin: "https://web.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil(": connected");
    expect(h.hub.clientCount).toBe(1);
    h.hub.emit({ kind: "decision", message: "hello live", pool_id: 3 });
    await readUntil("hello live");
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    expect(JSON.parse(dataLine!.slice(6))).toMatchObject({ kind: "decision", message: "hello live", pool_id: 3 });
    // Replays nothing: the first entry the client sees is the live one.
    ctrl.abort();
  });

  it("closes streams on shutdown instead of hanging", async () => {
    const h = await make();
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (h.app.server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/stream`);
    const reader = res.body!.getReader();
    await reader.read();
    const closing = h.app.close();
    await expect(Promise.race([closing, new Promise((_, rej) => setTimeout(() => rej(new Error("close hung")), 5000))])).resolves.toBeUndefined();
    current = null;
  });

  it("503 beyond the connection cap", async () => {
    const h = await make({ settings: { maxSseClients: 0 } });
    const res = await h.app.inject({ url: "/api/stream" });
    expect(res.statusCode).toBe(503);
  });
});
