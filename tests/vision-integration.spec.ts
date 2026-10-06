import { test, expect } from "@playwright/test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createVisionClient, type ContextReader, type VisionClient } from "../lib/flightdeck/context-client";
import { createOsWiring } from "../lib/flightdeck/os-wiring";
import { createVisionReader, createVisionRoute, type VisionLink } from "../lib/flightdeck/vision-route";
import { prepareVisionChange, visionChangeHash } from "../lib/flightdeck/vision-save";
import { deliveryPayload, visionOutboxStatement, drainVisionSync, hasVisionSync } from "../lib/flightdeck/vision-sync";
import { projectSchema, type Project } from "../lib/projects";
import type { VisionProjection } from "../lib/flightdeck/vision";
import type { OnboardDb } from "../lib/flightdeck/onboard-route";
import { withD1Batch } from "./fixtures/d1-batch";

const link: VisionLink = { installationId: "atlas-local", osInstanceId: "os-fixture", workspaceId: "te-ops", osProjectId: "hr-pilot", accessState: "active" };
const owner = { userId: "trusted-owner", email: "karsten.haldan@te.com" };
const other = { userId: "other", email: "admin@example.test", superAdmin: true };
const projection = (): VisionProjection => ({
  schema: "vision-projection/1", workspaceId: "te-ops", projectId: "hr-pilot", enrolled: true, status: "approved",
  canActivate: true, canOperate: true, canDeliver: true, assessmentRevision: 2, visionRevision: 1,
  approvedGoals: ["Improve service quality"], requiredActions: [], checkedAt: new Date().toISOString(),
  approvedStage: "Pilot", pendingStage: null, deliveryStatus: "In progress", atlasRevision: 1,
});
const context = (): ContextReader => ({
  workspaces: async () => ({ state: "ok", data: { integrationId: "atlas", instanceId: "os-fixture", workspaces: [{ id: "te-ops", label: "HR", enabled: true, isDefault: true }], generatedAt: new Date().toISOString() } }),
  projects: async () => ({ state: "ok", data: { workspaceId: "te-ops", projects: [], generatedAt: new Date().toISOString() } }),
});
const client = (): VisionClient => ({ projection: async () => ({ state: "ok", data: projection() }), delivery: async (_ws, _id, payload) => ({ state: "ok", data: { ...projection(), atlasRevision: payload.atlasRevision, deliveryStatus: payload.status } }) });
const project = (): Project => ({ ...projectSchema.parse({ name: "HR pilot", status: "In progress", category: "HR", location: "", latitude: null, longitude: null, dueDate: "", color: "blue", tasks: [] }), id: "atlas-project", source: "atlas", revision: 1, updatedAt: new Date().toISOString(), onboardingStage: "Pilot" });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const read = (over: Partial<Parameters<typeof createVisionReader>[0]> = {}) => createVisionReader({ projectFor: async () => true, links: async () => [link], installationId: () => "atlas-local", reader: context, vision: client, openUrl: () => "https://os.example.test/console/vision?standalone=1", ...over });

test("Vision transport uses only the scoped inbound path and credential header", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const os = createVisionClient({ baseUrl: "https://os.example.test", token: "test-machine-token" }, { fetch: async (url, init) => { calls.push({ url, init }); return json(projection()); } });
  expect((await os.projection("te-ops", "hr-pilot")).state).toBe("ok");
  expect(calls[0].url).toBe("https://os.example.test/api/inbound/v1/context/workspaces/te-ops/projects/hr-pilot/vision");
  const headers = new Headers(calls[0].init.headers);
  expect(headers.get("authorization")).toBe("Bearer test-machine-token");
  for (const forbidden of ["cookie", "x-workspace-id", "oai-authenticated-user-email"]) expect(headers.has(forbidden)).toBe(false);
  expect(calls[0].init.redirect).toBe("manual");
  const before = calls.length;
  expect((await os.projection("../private", "hr-pilot")).state).toBe("not_found");
  expect(calls).toHaveLength(before);
});

test("a swapped scope or private response field fails before reaching an Atlas viewer", async () => {
  for (const bad of [{ ...projection(), workspaceId: "other" }, { ...projection(), projectId: "other" }, { ...projection(), answers: ["private"] }, { ...projection(), evidence: [{ source: "private.pdf" }] }]) {
    const os = createVisionClient({ baseUrl: "https://os.example.test", token: "test-machine-token" }, { fetch: async () => json(bad) });
    expect((await os.projection("te-ops", "hr-pilot")).state).toBe("invalid_response");
  }
});

test("a revoked credential clears every held OS answer, while a scope refusal returns no projection", async () => {
  const cache = new Map(); cache.set("other-reader", { until: Date.now() + 10_000, value: { state: "ok", data: "held" } });
  const wiring = createOsWiring({ cache, fetch: async () => json({}, 401) });
  expect((await wiring.vision({ baseUrl: "https://os.example.test", token: "test-machine-token" }).projection("te-ops", "hr-pilot")).state).toBe("unauthorized");
  expect(cache.has("other-reader")).toBe(false);
  expect((await createVisionClient({ baseUrl: "https://os.example.test", token: "test-machine-token" }, { fetch: async () => json({}, 403) }).projection("te-ops", "hr-pilot")).state).toBe("refused");
});

test("project visibility is checked before any link or OS lookup", async () => {
  let calls = 0;
  const run = read({ projectFor: async () => null, links: async () => { calls++; return [link]; } });
  expect(await run(other, "atlas-project")).toEqual({ state: "unavailable", reason: "not_found" });
  expect(calls).toBe(0);
});

test("only a confirmed active installation/instance link reaches the project projection", async () => {
  for (const row of [{ ...link, installationId: "foreign" }, { ...link, osInstanceId: "foreign" }, { ...link, accessState: "revoked" }, { ...link, workspaceId: "unshared" }]) {
    let called = false;
    const run = read({ links: async () => [row], vision: () => ({ ...client(), projection: async () => { called = true; return { state: "ok", data: projection() }; } }) });
    expect((await run(owner, "atlas-project")).state).toBe("unavailable");
    expect(called).toBe(false);
  }
});

test("approved status is shared with project members, while owner launcher is never given to another admin", async () => {
  const viewer = await read()(other, "atlas-project");
  expect(viewer.state).toBe("ok");
  if (viewer.state === "ok") expect(viewer.openUrl).toBeNull();
  const own = await read()(owner, "atlas-project");
  expect(own.state).toBe("ok");
  if (own.state === "ok") {
    const url = new URL(own.openUrl!);
    expect(url.searchParams.get("fdWorkspace")).toBe("te-ops");
    expect(url.searchParams.get("fdProject")).toBe("hr-pilot");
  }
});

test("stale approval is unavailable and the browser response omits stored linkage and credentials", async () => {
  const stale = read({ vision: () => ({ ...client(), projection: async () => ({ state: "ok", data: { ...projection(), checkedAt: new Date(Date.now() - 10 * 60_000).toISOString() } }) }) });
  expect(await stale(owner, "atlas-project")).toEqual({ state: "unavailable", reason: "stale_response" });
  const route = createVisionRoute({ authorize: async () => ({ access: other }), read: read() });
  const res = await route.GET(new Request("https://atlas.example.test/api/flightdeck/vision?project=atlas-project"));
  const body = await res.json() as { projection: VisionProjection; openUrl: string | null };
  expect(body.projection.status).toBe("approved");
  expect(body.openUrl).toBeNull();
  for (const key of ["link", "installationId", "osInstanceId", "token", "answers", "ownerEmail"]) expect(body).not.toHaveProperty(key);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect((await route.GET(new Request("https://atlas.example.test/api/flightdeck/vision?project=atlas-project", { headers: { origin: "https://another.example.test" } }))).status).toBe(403);
});

test("next-stage proposal is refused before Atlas writes; unchanged current work remains available", async () => {
  let checked = 0, prepared = 0;
  const previous = project();
  const deps = { read: async () => { checked++; return { state: "ok" as const, link, projection: { ...projection(), status: "review_due" as const, canDeliver: false }, openUrl: null }; }, client: () => ({ ...client(), delivery: async () => { prepared++; return { state: "review_required" as const }; } }) };
  expect((await prepareVisionChange(previous, { ...previous, nextAction: "Continue current work" }, deps)).ok).toBe(true);
  expect(checked).toBe(0);
  const blocked = await prepareVisionChange(previous, { ...previous, onboardingStage: "Ready for FlightDeck" }, deps);
  expect(blocked).toMatchObject({ ok: false, code: "vision_review_required" });
  expect(prepared).toBe(1);
});

test("unlinked/unrelated work is unaffected, and unreachable linked assessment blocks advancing status", async () => {
  const previous = project(), next = { ...previous, status: "Completed" as const };
  expect((await prepareVisionChange(previous, next, { read: async () => ({ state: "not_linked" }), client })).ok).toBe(true);
  expect((await prepareVisionChange(previous, next, { read: async () => ({ state: "ok", link, projection: { ...projection(), enrolled: false, status: "not_required" }, openUrl: null }), client })).ok).toBe(true);
  expect(await prepareVisionChange(previous, next, { read: async () => ({ state: "unavailable", reason: "os_unreachable" }), client })).toMatchObject({ ok: false, code: "vision_unavailable" });
});

test("material-change requests bind the actual proposed facts without sending their private text", async () => {
  const previous = project();
  const next = { ...previous, description: "Private proposed scope", onboarding: { countryCode: "DE", worksCouncilRelevant: "yes" as const, dataSources: ["Private HR source"] } };
  const otherScope = { ...next, description: "Different proposed scope" };
  expect(await visionChangeHash(next)).not.toBe(await visionChangeHash(otherScope));
  expect(await visionChangeHash({ ...next, nextAction: "Task changed" })).toBe(await visionChangeHash(next));
  let body = "";
  const prepared = await prepareVisionChange(previous, next, {
    read: async () => ({ state: "ok", link, projection: projection(), openUrl: null }),
    client: () => ({ ...client(), delivery: async (_ws, _id, payload) => { body = JSON.stringify(payload); return { state: "review_required" }; } }),
  });
  expect(prepared).toMatchObject({ ok: false, code: "vision_review_required" });
  expect(JSON.parse(body)).toMatchObject({ intent: "prepare", keyChange: true, changeHash: await visionChangeHash(next), atlasRevision: 2 });
  expect(body).not.toContain("Private proposed scope");
  expect(body).not.toContain("Private HR source");
});

function store() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_\w+\.sql$/.test(name)).sort()) sqlite.exec(readFileSync(new URL(file, dir), "utf8").replaceAll("--> statement-breakpoint", ""));
  const db: OnboardDb = withD1Batch(sqlite, { prepare(sql) { return { bind(...values) { const statement = sqlite.prepare(sql), args = values as SQLInputValue[]; return { async first<T>() { return (statement.get(...args) as T | undefined) ?? null; }, async all<T>() { return { results: statement.all(...args) as T[] }; }, async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; } }; } }; } });
  sqlite.prepare("INSERT INTO atlas_projects(id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?)").run("atlas-project", "fixture", "{}", "atlas", new Date().toISOString(), 1);
  return { sqlite, db };
}

test("delivery outbox is atomic with the winning project revision and a stale save writes no marker", async () => {
  const { sqlite, db } = store();
  try {
    const payload = deliveryPayload(link, projection(), { ...project(), revision: 2 }, "commit");
    const update = () => db.prepare("UPDATE atlas_projects SET revision=2 WHERE id=? AND revision=?").bind("atlas-project", 1);
    await db.batch!([update(), visionOutboxStatement(db, link, payload, new Date().toISOString())]);
    expect(await hasVisionSync(db, "atlas-project")).toBe(true);
    await db.prepare("DELETE FROM atlas_vision_delivery_outbox WHERE project_id=?").bind("atlas-project").run();
    await db.batch!([update(), visionOutboxStatement(db, link, payload, new Date().toISOString())]);
    expect(await hasVisionSync(db, "atlas-project")).toBe(false);
  } finally { sqlite.close(); }
});

test("failed/mismatched sync keeps the durable marker; the acknowledged exact revision removes it", async () => {
  const { sqlite, db } = store();
  try {
    const payload = deliveryPayload(link, projection(), { ...project(), revision: 2 }, "commit");
    await db.batch!([db.prepare("UPDATE atlas_projects SET revision=2 WHERE id=?").bind("atlas-project"), visionOutboxStatement(db, link, payload, new Date().toISOString())]);
    expect(await drainVisionSync(db, "atlas-project", link, { ...client(), delivery: async () => ({ state: "os_unreachable" }) })).toBe(false);
    expect(await hasVisionSync(db, "atlas-project")).toBe(true);
    expect(await drainVisionSync(db, "atlas-project", { ...link, osInstanceId: "another" }, client())).toBe(false);
    expect(await drainVisionSync(db, "atlas-project", link, { ...client(), delivery: async () => ({ state: "ok", data: projection() }) })).toBe(false);
    expect(await drainVisionSync(db, "atlas-project", link, client())).toBe(true);
    expect(await hasVisionSync(db, "atlas-project")).toBe(false);
  } finally { sqlite.close(); }
});

test("an acknowledgment arriving after a newer commit cannot delete that newer pending projection", async () => {
  const { sqlite, db } = store();
  try {
    const old = deliveryPayload(link, projection(), { ...project(), revision: 2 }, "commit");
    await db.batch!([db.prepare("UPDATE atlas_projects SET revision=2 WHERE id=?").bind("atlas-project"), visionOutboxStatement(db, link, old, new Date().toISOString())]);
    const newer = deliveryPayload(link, projection(), { ...project(), revision: 3, status: "On hold" }, "commit");
    const racing: VisionClient = { ...client(), delivery: async () => {
      await db.batch!([db.prepare("UPDATE atlas_projects SET revision=3 WHERE id=?").bind("atlas-project"), visionOutboxStatement(db, link, newer, new Date().toISOString())]);
      return { state: "ok", data: { ...projection(), atlasRevision: 2, deliveryStatus: old.status } };
    } };
    await drainVisionSync(db, "atlas-project", link, racing);
    expect(await hasVisionSync(db, "atlas-project")).toBe(true);
    expect(sqlite.prepare("SELECT atlas_revision FROM atlas_vision_delivery_outbox").get()?.atlas_revision).toBe(3);
  } finally { sqlite.close(); }
});


test("retry rebases only the OS approval revisions while preserving the committed material event", async () => {
  const { sqlite, db } = store();
  try {
    const material = { keyChange: true, changeHash: "a".repeat(64) };
    const payload = deliveryPayload(link, projection(), { ...project(), revision: 2 }, "commit", material);
    await db.batch!([db.prepare("UPDATE atlas_projects SET revision=2 WHERE id=?").bind("atlas-project"), visionOutboxStatement(db, link, payload, new Date().toISOString())]);
    const fresh = { ...projection(), assessmentRevision: 6, visionRevision: 3 };
    let sent: unknown;
    const accepting: VisionClient = { ...client(), delivery: async (_ws, _id, event) => { sent = event; return { state: "ok", data: { ...fresh, atlasRevision: 2, deliveryStatus: event.status } }; } };
    expect(await drainVisionSync(db, "atlas-project", link, accepting, fresh)).toBe(true);
    expect(sent).toEqual({ ...payload, expectedAssessmentRevision: 6, expectedVisionRevision: 3 });
    expect(await hasVisionSync(db, "atlas-project")).toBe(false);
  } finally { sqlite.close(); }
});


test("changing success criteria or measure definitions requires review while observations remain ordinary work", async () => {
  const previous = { ...project(), benefit: "Reduce processing time", objectives: [{ id: "service", title: "Improve HR service", description: "Pilot scope", owner: "HR operator", dueDate: "2027-03-01", status: "Planned" as const }], kpis: [{ id: "lead-time", name: "Lead time", unit: "hours", baseline: 24, target: 12, current: 22, objectiveId: "service" }] };
  let requests = 0;
  const deps = { read: async () => ({ state: "ok" as const, link, projection: projection(), openUrl: null }), client: () => ({ ...client(), delivery: async () => { requests++; return { state: "review_required" as const }; } }) };
  for (const next of [
    { ...previous, benefit: "A different success criterion" },
    { ...previous, objectives: [{ ...previous.objectives[0], description: "A different scope" }] },
    { ...previous, kpis: [{ ...previous.kpis[0], baseline: 30 }] },
    { ...previous, kpis: [{ ...previous.kpis[0], target: 10 }] },
  ]) {
    expect((await prepareVisionChange(previous, next, deps)).ok).toBe(false);
    expect(await visionChangeHash(next)).not.toBe(await visionChangeHash(previous));
  }
  expect(requests).toBe(4);
  const observed = { ...previous, objectives: [{ ...previous.objectives[0], status: "In progress" as const }], kpis: [{ ...previous.kpis[0], current: 18 }] };
  expect(await visionChangeHash(observed)).toBe(await visionChangeHash(previous));
  expect((await prepareVisionChange(previous, observed, deps)).ok).toBe(true);
  expect(requests).toBe(4);
});
