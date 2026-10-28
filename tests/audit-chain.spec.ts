import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  GENESIS,
  appendGateEvent,
  eventHash,
  gateEventsFor,
  hashPayload,
  verifyChain,
  type ChainDb,
  type StoredGateEvent,
} from "../lib/audit/chain";
import { CONTRACT_IDS, parseGateEvent } from "../lib/domain/contracts";

// The audit chain, over a database built from the real migrations — the same
// way tests/flightdeck-onboard-route.spec.ts builds its stand-in. The chain is
// what makes "audited" mean something, so these tests are adversarial: edit a
// row, delete one, rewrite a link, and race two writers.
const PROJECT = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const OTHER = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
const AT = "2026-10-28T09:00:00.000Z";
function store() {
  const dir = new URL("../drizzle/", import.meta.url);
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
      sqlite.exec(statement);
  const db: ChainDb = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          const args = values as SQLInputValue[];
          return {
            async first<T>() {
              return (statement.get(...args) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: statement.all(...args) as T[] };
            },
            async run() {
              return {
                meta: { changes: Number(statement.run(...args).changes) },
              };
            },
          };
        },
      };
    },
  };
  sqlite
    .prepare(
      "INSERT INTO atlas_projects (id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?)",
    )
    .run(PROJECT, "user-1", "{}", "atlas", AT, 1);
  sqlite
    .prepare(
      "INSERT INTO atlas_projects (id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?)",
    )
    .run(OTHER, "user-1", "{}", "atlas", AT, 1);
  return { db, sqlite };
}
const event = (over: Partial<Parameters<typeof appendGateEvent>[1]> = {}) => ({
  projectId: PROJECT,
  stage: "capture" as const,
  fromStage: "capture" as const,
  toStage: "as-is" as const,
  actor: "sha256:3d0f6c1e",
  role: "onboarding.capture.review",
  decision: "pass" as const,
  at: AT,
  ...over,
});
test.describe("append", () => {
  test("the first event chains to GENESIS and the second to the first", async () => {
    const { db } = store();
    const first = await appendGateEvent(db, event({ reason: "first" }));
    const second = await appendGateEvent(db, event({ reason: "second" }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.event.seq).toBe(1);
    expect(first.event.prevHash).toBe(GENESIS);
    expect(second.event.seq).toBe(2);
    expect(second.event.prevHash).toBe(first.event.hash);
  });
  test("the stored row IS the atlas-gate-event/1 wire body", async () => {
    const { db, sqlite } = store();
    await appendGateEvent(db, event());
    const row = sqlite
      .prepare("SELECT * FROM atlas_gate_events WHERE project_id = ?")
      .get(PROJECT) as Record<string, unknown>;
    const events = await gateEventsFor(db, PROJECT);
    const parsed = parseGateEvent({
      contract: CONTRACT_IDS.gateEvent,
      ...events[0],
    });
    expect(parsed.ok).toBe(true);
    expect(row.hash).toBe(events[0].hash);
  });
  test("two writers racing get consecutive seqs, not two rows with one seq", async () => {
    const { db } = store();
    const [a, b] = await Promise.all([
      appendGateEvent(db, event({ reason: "a" })),
      appendGateEvent(db, event({ reason: "b" })),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect([a.event.seq, b.event.seq].sort()).toEqual([1, 2]);
    expect((await verifyChain(db, PROJECT)).ok).toBe(true);
  });
  test("another project's chain starts at 1 and does not interleave", async () => {
    const { db } = store();
    await appendGateEvent(db, event({ reason: "one" }));
    const other = await appendGateEvent(
      db,
      event({ projectId: OTHER, reason: "other" }),
    );
    expect(other.ok && other.event.seq).toBe(1);
    expect(await verifyChain(db, PROJECT)).toEqual({ ok: true, length: 1 });
  });
  test("the hash is recomputable from the row alone", async () => {
    const { db } = store();
    const appended = await appendGateEvent(db, event());
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const { event: row } = appended;
    const recomputed = await eventHash(
      hashPayload({
        projectId: row.projectId,
        seq: row.seq,
        stage: row.stage,
        fromStage: row.fromStage,
        toStage: row.toStage,
        actor: row.actor,
        role: row.role,
        decision: row.decision,
        reason: row.reason,
        evidenceRef: row.evidenceRef,
        materialDigest: row.materialDigest,
        createdAt: row.createdAt,
        prevHash: row.prevHash,
      }),
    );
    expect(recomputed).toBe(row.hash);
  });
});
test.describe("verify", () => {
  test("an intact chain verifies and reports its length", async () => {
    const { db } = store();
    for (const reason of ["one", "two", "three"])
      await appendGateEvent(db, event({ reason }));
    expect(await verifyChain(db, PROJECT)).toEqual({ ok: true, length: 3 });
  });
  test("an edited reason breaks the hash at that seq", async () => {
    const { db, sqlite } = store();
    for (const reason of ["one", "two", "three"])
      await appendGateEvent(db, event({ reason }));
    sqlite
      .prepare(
        "UPDATE atlas_gate_events SET reason = 'rewritten' WHERE project_id = ? AND seq = 2",
      )
      .run(PROJECT);
    const result = await verifyChain(db, PROJECT);
    expect(result).toEqual({ ok: false, brokenAt: 2, reason: "hash_mismatch" });
  });
  test("a deleted row is caught as a gap before any hash is checked", async () => {
    const { db, sqlite } = store();
    for (const reason of ["one", "two", "three"])
      await appendGateEvent(db, event({ reason }));
    sqlite
      .prepare("DELETE FROM atlas_gate_events WHERE project_id = ? AND seq = 2")
      .run(PROJECT);
    expect(await verifyChain(db, PROJECT)).toEqual({
      ok: false,
      brokenAt: 3,
      reason: "seq_gap",
    });
  });
  test("a rewritten link is caught as a prev mismatch", async () => {
    const { db, sqlite } = store();
    for (const reason of ["one", "two"])
      await appendGateEvent(db, event({ reason }));
    sqlite
      .prepare(
        "UPDATE atlas_gate_events SET prev_hash = ? WHERE project_id = ? AND seq = 2",
      )
      .run(GENESIS, PROJECT);
    expect(await verifyChain(db, PROJECT)).toEqual({
      ok: false,
      brokenAt: 2,
      reason: "prev_mismatch",
    });
  });
  test("an empty chain is valid and empty", async () => {
    const { db } = store();
    expect(await verifyChain(db, PROJECT)).toEqual({ ok: true, length: 0 });
  });
  test("a decision the schema refuses is refused by the database too", async () => {
    const { db } = store();
    // The route validates first; this proves the D1 CHECK is a second lock,
    // so a bug in a caller cannot write an unaudited kind of decision.
    const bad = {
      ...event(),
      decision: "maybe" as unknown as "pass",
    };
    await expect(appendGateEvent(db, bad)).rejects.toThrow();
  });
});
test("the timeline reads oldest first", async () => {
  const { db } = store();
  for (const reason of ["one", "two", "three"])
    await appendGateEvent(db, event({ reason }));
  const events: StoredGateEvent[] = await gateEventsFor(db, PROJECT);
  expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  expect(events.map((e) => e.reason)).toEqual(["one", "two", "three"]);
});
