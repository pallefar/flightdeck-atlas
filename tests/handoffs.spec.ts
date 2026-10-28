import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ChainDb } from "../lib/audit/chain";
import {
  diagramforgeHandoff,
  handoffsFor,
  mapsStepsRequest,
  observeHandoff,
  parseComplianceRecord,
  reserveHandoff,
  studioSpec,
  type EvidenceRef,
} from "../lib/onboarding/handoffs";
import { createOnboardingRoutes, type BrainAccess, type BrainDeps } from "../lib/onboarding/routes";
import { canonicalJson } from "../lib/domain/digest";

// Hand-offs: the payloads Atlas would send, and the outbox that makes sending
// them once possible. No transport exists here and none is faked — these tests
// pin the bodies and the reservation discipline that a transport must honour.
const P = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const AT = "2026-10-28T12:00:00.000Z";
const evidence = (over: Partial<EvidenceRef> = {}): EvidenceRef => ({
  id: "ev-1",
  sha256: "a".repeat(64),
  kind: "recording",
  classification: "internal",
  ...over,
});
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
              return { meta: { changes: Number(statement.run(...args).changes) } };
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
    .run(P, "u1", JSON.stringify({ name: "Contract intake" }), "atlas", AT, 1);
  return { db, sqlite };
}
test.describe("payload builders", () => {
  test("the KG request carries references, a map type, and no evidence body", () => {
    const request = mapsStepsRequest({
      projectId: P,
      projectName: "Contract intake",
      evidence: [evidence()],
      mapType: "as-is",
      stepFormatRevision: "rev-7",
    });
    expect(request.schema).toBe("atlas-maps-steps-request/1");
    expect(request.meta.mapType).toBe("as-is");
    expect(request.sourceRefs[0]).toEqual({ id: "ev-1", sha256: "a".repeat(64), kind: "recording" });
    expect(JSON.stringify(request)).not.toContain("The operator opens");
    expect(request.stepFormatRevision).toBe("rev-7");
  });
  test("a restricted classification is never referenced", () => {
    const request = mapsStepsRequest({
      projectId: P,
      projectName: "Contract intake",
      evidence: [evidence({ classification: "cui" }), evidence({ id: "ev-2" })],
      mapType: "as-is",
      stepFormatRevision: null,
    });
    expect(request.sourceRefs.map((r) => r.id)).toEqual(["ev-2"]);
  });
  test("the DiagramForge bundle is a cowork-handoff/1 with the map type and the questions", () => {
    const bundle = diagramforgeHandoff({
      projectId: P,
      projectName: "Contract intake",
      mapType: "future",
      evidence: [evidence()],
      questions: ["Who receives the request?", "  ", "Which system holds the case?"],
    });
    expect(bundle.schema).toBe("cowork-handoff/1");
    expect(bundle.meta.mapType).toBe("future");
    expect(bundle.meta.mapTypeMeaning).toBe("to-be process");
    expect(bundle.requiredAnswers).toEqual([
      "Who receives the request?",
      "Which system holds the case?",
    ]);
    expect(bundle.inputs[0].sha256).toBe("a".repeat(64));
  });
  test("the Studio spec states the constraints the PRD sets", () => {
    const spec = studioSpec({
      projectId: P,
      projectName: "Contract intake",
      decision: "studio",
      toBeMapRef: "map-1",
      processManifestHash: "b".repeat(64),
      objective: "Cut handling time",
      successMeasure: "Median handle time",
      classification: "internal",
    });
    expect(spec.schema).toBe("atlas-studio-spec/1");
    expect(spec.constraints).toMatchObject({
      classification: "internal",
      drawsMaps: false,
      runsProcessSteps: false,
    });
  });
});
test.describe("the compliance record coming back", () => {
  const record = {
    schema: "studio-compliance-record/1",
    recordId: "ccr-1",
    subAppId: "contract-intake",
    version: "1.2.0",
    passed: true,
  };
  test("a passing record is accepted", () => {
    expect(parseComplianceRecord(record)).toEqual({
      ok: true,
      value: { recordId: "ccr-1", subAppId: "contract-intake", version: "1.2.0", passed: true },
    });
  });
  test("another schema is refused as the wrong schema", () => {
    expect(parseComplianceRecord({ ...record, schema: "atlas-value/1" })).toEqual({
      ok: false,
      code: "wrong_schema",
    });
  });
  test("an unknown key is refused: a record is not a place to stash extras", () => {
    expect(parseComplianceRecord({ ...record, note: "trust me" })).toEqual({
      ok: false,
      code: "invalid",
    });
  });
  test("a record with no verdict is refused", () => {
    expect(parseComplianceRecord({ ...record, passed: "yes" })).toEqual({
      ok: false,
      code: "invalid",
    });
  });
});
test.describe("the outbox", () => {
  test("a reservation stores the canonical body and an idempotency key", async () => {
    const { db, sqlite } = store();
    const body = { b: 2, a: 1 };
    const reserved = await reserveHandoff(db, {
      id: "h-1",
      projectId: P,
      kind: "kg",
      body,
      at: AT,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.row.status).toBe("reserved");
    expect(reserved.row.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const row = sqlite.prepare("SELECT request_body FROM atlas_handoffs").get() as {
      request_body: string;
    };
    expect(row.request_body).toBe(canonicalJson(body));
  });
  test("a second open hand-off of the same kind is refused", async () => {
    const { db } = store();
    await reserveHandoff(db, { id: "h-1", projectId: P, kind: "kg", body: {}, at: AT });
    const again = await reserveHandoff(db, {
      id: "h-2",
      projectId: P,
      kind: "kg",
      body: {},
      at: AT,
    });
    expect(again).toEqual({ ok: false, code: "open_handoff" });
    // A different kind is its own hand-off.
    const other = await reserveHandoff(db, {
      id: "h-3",
      projectId: P,
      kind: "studio",
      body: {},
      at: AT,
    });
    expect(other.ok).toBe(true);
  });
  test("filing clears the reserved body; a sent-but-unfiled one keeps it", async () => {
    const { db, sqlite } = store();
    await reserveHandoff(db, { id: "h-1", projectId: P, kind: "kg", body: { a: 1 }, at: AT });
    expect(await observeHandoff(db, "h-1", "sent", { at: AT }, AT)).toBe(true);
    let row = sqlite.prepare("SELECT request_body FROM atlas_handoffs").get() as {
      request_body: string;
    };
    expect(row.request_body).not.toBe("");
    expect(await observeHandoff(db, "h-1", "filed", { id: "sub-1" }, AT)).toBe(true);
    row = sqlite.prepare("SELECT request_body FROM atlas_handoffs").get() as {
      request_body: string;
    };
    expect(row.request_body).toBe("");
    const list = await handoffsFor(db, P);
    expect(list[0].status).toBe("filed");
    expect(list[0].attempts).toBe(2);
  });
  test("an unknown hand-off is not observed", async () => {
    const { db } = store();
    expect(await observeHandoff(db, "nope", "filed", null, AT)).toBe(false);
  });
});
test.describe("the hand-off route", () => {
  function harness(permissions: string[]) {
    const { db } = store();
    const access: BrainAccess = { userId: "u1", superAdmin: false, permissions };
    const deps: BrainDeps = {
      authorize: async (permission) =>
        permission && !permissions.includes(permission)
          ? { error: Response.json({ error: "denied" }, { status: 403 }) }
          : { access },
      loadProject: async () => ({ id: P, name: "Contract intake", revision: 1 }),
      canEdit: async () => true,
      visibleIds: async () => new Set([P]),
      db,
      now: () => AT,
      newId: () => crypto.randomUUID(),
    };
    return createOnboardingRoutes(deps);
  }
  const call = (body: unknown) =>
    new Request(`http://localhost:5173/api/onboarding/${P}/handoff`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify(body),
    });
  test("needs the hand-off permission", async () => {
    const routes = harness(["onboarding.view", "onboarding.create"]);
    await routes.create(call({}), P);
    const result = await routes.handoffCreate(call({ kind: "kg" }), P);
    expect(result.status).toBe(403);
  });
  test("reserves a KG hand-off and shows it on the project", async () => {
    const routes = harness([
      "onboarding.view",
      "onboarding.create",
      "onboarding.handoff",
    ]);
    await routes.create(call({}), P);
    const created = await routes.handoffCreate(call({ kind: "kg" }), P);
    expect(created.status).toBe(200);
    const body = (await created.json()) as { handoffs: { kind: string; status: string }[] };
    expect(body.handoffs).toHaveLength(1);
    expect(body.handoffs[0]).toMatchObject({ kind: "kg", status: "reserved" });
  });
  test("Studio refuses without a build decision", async () => {
    const routes = harness([
      "onboarding.view",
      "onboarding.create",
      "onboarding.handoff",
    ]);
    await routes.create(call({}), P);
    const result = await routes.handoffCreate(call({ kind: "studio" }), P);
    expect(result.status).toBe(409);
    const body = (await result.json()) as { code: string };
    expect(body.code).toBe("build_decision_missing");
  });
});
