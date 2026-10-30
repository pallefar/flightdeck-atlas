import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ChainDb } from "../lib/audit/chain";
import {
  createOnboardingRoutes,
  type BrainAccess,
  type BrainDeps,
} from "../lib/onboarding/routes";
import { parseRecord } from "../lib/domain/contracts";

// The brain's API, over a database built from the real migrations and the
// exact handlers the routes call. Every refusal here is a promise the UI
// relies on: a gate cannot be passed by the wrong role, a stage cannot move
// with a prerequisite missing, a save cannot claim a fact a hand-off owns, and
// a restricted classification never becomes a row.
const P = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const AT = "2026-10-28T12:00:00.000Z";
const ALL = [
  "projects.read",
  "onboarding.view",
  "onboarding.create",
  "onboarding.triage",
  "onboarding.capture.review",
  "onboarding.gate.process_owner",
  "onboarding.gate.teoa",
  "onboarding.gate.vision",
  "onboarding.value.edit",
  "onboarding.handoff",
];
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
  // Migration 0017 inserts the 'general' workspace; the harness only joins it.
  sqlite
    .prepare(
      "INSERT INTO atlas_workspace_members (workspace_id,email,role,added_by,created_at) VALUES (?,?,?,?,?)",
    )
    .run("general", "u1@example.test", "admin", "u1", AT);
  return { db, sqlite };
}
function harness(
  options: {
    permissions?: string[];
    canEdit?: boolean;
    visible?: boolean;
    db?: ChainDb;
    sqlite?: DatabaseSync;
  } = {},
) {
  const { db, sqlite } =
    options.db && options.sqlite
      ? { db: options.db, sqlite: options.sqlite }
      : store();
  const access: BrainAccess = {
    userId: "u1",
    email: "u1@example.test",
    superAdmin: false,
    permissions: options.permissions ?? ALL,
  };
  const deps: BrainDeps = {
    authorize: async () => ({ access }),
    loadProject: async () => ({ id: P, name: "Contract intake", revision: 1 }),
    canEdit: async () => options.canEdit ?? true,
    visibleIds: async () => new Set(options.visible === false ? [] : [P]),
    db,
    now: () => AT,
    newId: () => crypto.randomUUID(),
  };
  return { db, sqlite, routes: createOnboardingRoutes(deps) };
}
const call = (
  body?: unknown,
  method = "POST",
): Request =>
  new Request(`http://localhost:5173/api/onboarding/${P}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:5173",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const jsonOf = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Record<string, unknown>,
});
/** Intake facts good enough to pass stage 0. */
const intakeFields = {
  classificationDeclared: true,
  classification: "internal",
  requester: "Anna Schmidt",
  problem: "Intake is typed by hand into two systems.",
  functionArea: "HR Services",
  site: "Bensheim",
};
async function onboarded(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  const created = await h.routes.create(call({ ...intakeFields, workspaceId: "general" }), P);
  expect(created.status).toBe(200);
  return h;
}
async function gateOf(
  h: ReturnType<typeof harness>,
  stage: string,
  decision = "pass",
  reason = "reviewed",
) {
  const current = await jsonOf(await h.routes.get(P));
  const revision = Number(current.body.record && (current.body.record as { revision: number }).revision);
  return jsonOf(
    await h.routes.gate(
      call({ stage, decision, reason, revision }),
      P,
    ),
  );
}
async function save(h: ReturnType<typeof harness>, fields: Record<string, unknown>) {
  const current = await jsonOf(await h.routes.get(P));
  const revision = (current.body.record as { revision: number }).revision;
  return jsonOf(await h.routes.patch(call({ revision, fields }, "PATCH"), P));
}
async function assign(
  h: ReturnType<typeof harness>,
  role: string,
  email: string,
) {
  const response = await h.routes.rolesAssign(call({ role, email }), P);
  expect(response.status).toBe(200);
}
async function recordReuse(
  h: ReturnType<typeof harness>,
  decision = "new",
) {
  return jsonOf(
    await h.routes.reuse(
      call({ decision, reason: "no match in the catalogue", matches: [] }),
      P,
    ),
  );
}
test.describe("opening an intake", () => {
  test("creates the row, the record projection and the first audit event", async () => {
    const h = await onboarded();
    const { status, body } = await jsonOf(await h.routes.get(P));
    expect(status).toBe(200);
    const record = parseRecord(body.record);
    expect(record.ok).toBe(true);
    if (record.ok) {
      expect(record.value.stage).toBe("intake");
      expect(record.value.revision).toBe(1);
      expect(record.value.gates).toHaveLength(1);
    }
    expect(body.chain).toEqual({ ok: true, length: 1 });
  });
  test("records whether a project or a process is being onboarded", async () => {
    const h = harness();
    const created = await h.routes.create(
      call({ ...intakeFields, entryType: "process", workspaceId: "general" }),
      P,
    );
    expect(created.status).toBe(200);
    const body = (await created.json()) as { record: { entryType: string } };
    expect(body.record.entryType).toBe("process");
    const projected = parseRecord(body.record);
    expect(projected.ok).toBe(true);
  });
  test("the quick lane starts at capture and records what it deferred", async () => {
    const h = harness();
    const created = await h.routes.create(
      call({ ...intakeFields, workspaceId: "general", lane: "quick" }),
      P,
    );
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      record: { stage: string };
      lane: string;
      deferredGates: { stage: string; owner: string; dueAt: string }[];
      chain: { length: number };
    };
    expect(body.lane).toBe("quick");
    expect(body.record.stage).toBe("capture");
    expect(body.deferredGates.map((item) => item.stage)).toEqual(["as-is", "aligned", "value"]);
    expect(body.deferredGates[0].owner).toBe("u1@example.test");
    // Three passes are recorded at once, and each carries the debt.
    expect(body.chain.length).toBe(3);
    const rows = h.sqlite
      .prepare("SELECT lane, deferred FROM atlas_gate_events ORDER BY seq")
      .all() as { lane: string; deferred: string }[];
    expect(rows.every((row) => row.lane === "quick")).toBe(true);
    expect(JSON.parse(rows[0].deferred)).toEqual(["as-is", "aligned", "value"]);
  });
  test("passing a deferred gate pays that sign-off off", async () => {
    const h = harness();
    await h.routes.create(call({ ...intakeFields, workspaceId: "general", lane: "quick" }), P);
    // A quick lane still has to pass the stages it actually reached: capture
    // needs one accepted, clean evidence item.
    await h.routes.evidenceAdd(
      call({
        kind: "document",
        source: "sop.docx",
        sha256: "a".repeat(64),
        bytes: 10,
        classification: "internal",
        scanText: "The operator checks the purchase order in SAP.",
        status: "accepted",
      }),
      P,
    );
    const captured = await gateOf(h, "capture");
    expect(captured.status).toBe(200);
    await save(h, { asIsMapRef: "map-as-is-1", asIsSignedOff: true });
    const passed = await gateOf(h, "as-is");
    expect(passed.status).toBe(200);
    const body = passed.body as { deferredGates: { stage: string }[]; chain: { length: number } };
    expect(body.deferredGates.map((item) => item.stage)).toEqual(["aligned", "value"]);
    // three opening passes, the capture gate, and this one
    expect(body.chain.length).toBe(5);
  });
  test("refuses a second intake on the same project", async () => {
    const h = await onboarded();
    const again = await jsonOf(await h.routes.create(call({ workspaceId: "general" }), P));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_onboarded");
  });
  test("refuses a viewer who cannot edit the project", async () => {
    const h = harness({ canEdit: false });
    const result = await jsonOf(await h.routes.create(call({ workspaceId: "general" }), P));
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("not_editable");
  });
  test("refuses a cross-origin write", async () => {
    const h = harness();
    const request = new Request(`http://localhost:5173/api/onboarding/${P}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    });
    const result = await jsonOf(await h.routes.create(request, P));
    expect(result.status).toBe(403);
  });
  test("the list carries the same readiness score the detail computes", async () => {
    const h = await onboarded();
    // One of seven facts: the owner set at creation. Nothing else yet.
    const before = await jsonOf(await h.routes.list());
    const row = (before.body.projects as { readiness: number; met: number; total: number }[])[0];
    expect(row.total).toBe(7);
    expect(row.met).toBe(1);
    expect(row.readiness).toBe(14);
    // Record the reuse decision and a baseline: five of seven.
    await recordReuse(h);
    await h.routes.valueAdd(
      call({
        basis: "measured",
        period: "baseline",
        figures: { hours: 10 },
        method: "ai-jam-value-case",
        methodVersion: "provisional-1",
        confidence: "medium",
        sourceRef: "export.csv",
      }),
      P,
    );
    const after = await jsonOf(await h.routes.list());
    const scored = (after.body.projects as { readiness: number; met: number }[])[0];
    expect(scored.met).toBe(3);
    expect(scored.readiness).toBe(43);
    // The detail's card agrees, which is the point of scoring the same facts.
    const detail = await jsonOf(await h.routes.get(P));
    expect(detail.body.record).toBeTruthy();
  });
  test("the list only shows projects the caller may read", async () => {
    const h = await onboarded();
    const visible = await jsonOf(await h.routes.list());
    expect((visible.body.projects as unknown[]).length).toBe(1);
    const hidden = harness({ visible: false });
    expect((await jsonOf(await hidden.routes.list())).body.projects).toEqual([]);
  });
});
test.describe("editing", () => {
  test("a stale revision is refused with the current one", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.patch(call({ revision: 99, fields: { site: "Prague" } }, "PATCH"), P),
    );
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("revision_changed");
    expect(result.body.current).toBe(1);
  });
  test("a save cannot set a fact a hand-off owns", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.patch(
        call({ revision: 1, fields: { complianceRecordId: "ccr-1" } }, "PATCH"),
        P,
      ),
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("read_only_field");
  });
  test("a declared classification with no class is refused", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.patch(
        call({ revision: 1, fields: { classification: null } }, "PATCH"),
        P,
      ),
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("classification_required");
  });
  test("a good save bumps the revision and keeps the chain intact", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.patch(call({ revision: 1, fields: { site: "Prague" } }, "PATCH"), P),
    );
    expect(result.status).toBe(200);
    expect((result.body.record as { revision: number }).revision).toBe(2);
    expect(result.body.chain).toEqual({ ok: true, length: 1 });
  });
});
test.describe("gates", () => {
  test("the wrong role is refused before any prerequisite is even checked", async () => {
    const h = await onboarded();
    const viewer = harness({ permissions: ["onboarding.view"], db: h.db, sqlite: h.sqlite });
    const result = await gateOf(viewer, "intake");
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("gate_role_required");
  });
  test("a stage with unmet facts is refused and names them", async () => {
    const h = await onboarded();
    await h.routes.patch(call({ revision: 1, fields: { site: "" } }, "PATCH"), P);
    const result = await gateOf(h, "intake");
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("prerequisite_missing");
    expect(result.body.missing).toEqual(["site"]);
  });
  test("a passing gate moves the stage and appends one audited event", async () => {
    const h = await onboarded();
    const result = await gateOf(h, "intake");
    expect(result.status).toBe(200);
    expect((result.body.record as { stage: string }).stage).toBe("reuse");
    expect(result.body.chain).toEqual({ ok: true, length: 2 });
  });
  test("a gate for another stage is refused as the wrong stage", async () => {
    const h = await onboarded();
    const result = await gateOf(h, "capture");
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("wrong_stage");
    expect(result.body.current).toBe("intake");
  });
  test("alignment needs the OS project, the TEOA scope, the Vision objective and the delivery", async () => {
    const h = await onboarded();
    await gateOf(h, "intake");
    await recordReuse(h);
    await gateOf(h, "reuse", "pass", "no existing solution");
    await h.routes.evidenceAdd(
      call(
        {
          kind: "recording",
          source: "capture.mp4",
          sha256: "a".repeat(64),
          bytes: 1024,
          classification: "internal",
          scanText:
            "The operator opens the case in ServiceNow and checks the document.",
          status: "accepted",
        },
        "POST",
      ),
      P,
    );
    await gateOf(h, "capture");
    await save(h, { asIsMapRef: "map-as-is-1", asIsSignedOff: true });
    const asIs = await gateOf(h, "as-is");
    expect(asIs.status).toBe(200);
    // Not assigned as an approver yet: the assignment comes before the facts.
    const unassigned = await gateOf(h, "aligned");
    expect(unassigned.status).toBe(403);
    expect(unassigned.body.code).toBe("assignment_required");
    await assign(h, "teoa_approver", "u1@example.test");
    await assign(h, "vision_approver", "u1@example.test");
    const aligned = await gateOf(h, "aligned");
    expect(aligned.status).toBe(409);
    expect(aligned.body.missing).toEqual([
      "os-project",
      "teoa-scope",
      "vision-objective",
      "vision-delivery",
    ]);
  });
  test("a rejection needs a reason and does not move the project", async () => {
    const h = await onboarded();
    const noReason = await gateOf(h, "intake", "reject", "");
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("reason_required");
    const rejected = await gateOf(h, "intake", "reject", "problem statement too thin");
    expect(rejected.status).toBe(200);
    expect((rejected.body.record as { stage: string }).stage).toBe("intake");
  });
  test("retirement is recorded, audited and makes the project read-only", async () => {
    const h = await onboarded();
    // The requirement is a recorded reason on the project, not the gate's
    // own note, so a pass with no recorded reason is refused and names it.
    const missingReason = await jsonOf(
      await h.routes.gate(
        call({ stage: "retired", decision: "pass", revision: 1, reason: "merged" }),
        P,
      ),
    );
    expect(missingReason.status).toBe(409);
    expect(missingReason.body.missing).toEqual(["retire-reason"]);
    await save(h, { retireReason: "merged into the payroll project" });
    const current = await jsonOf(await h.routes.get(P));
    const revision = (current.body.record as { revision: number }).revision;
    const retired = await jsonOf(
      await h.routes.gate(
        call({ stage: "retired", decision: "pass", revision, reason: "merged" }),
        P,
      ),
    );
    expect(retired.status).toBe(200);
    expect((retired.body.record as { stage: string }).stage).toBe("retired");
    expect(retired.body.status).toBe("retired");
    const after = await save(h, { site: "Prague" });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("retired");
  });
});
test.describe("material change", () => {
  test("changing the objective after alignment reopens stage 4 with an audit event", async () => {
    const h = await onboarded();
    await gateOf(h, "intake");
    await recordReuse(h);
    await gateOf(h, "reuse", "pass", "new");
    await h.routes.evidenceAdd(
      call({
        kind: "recording",
        source: "capture.mp4",
        sha256: "a".repeat(64),
        bytes: 1024,
        classification: "internal",
        scanText:
          "The operator opens the case in ServiceNow and checks the document.",
        status: "accepted",
      }),
      P,
    );
    await gateOf(h, "capture");
    await save(h, { asIsMapRef: "map-as-is-1", asIsSignedOff: true });
    const asIsGate = await gateOf(h, "as-is");
    expect(asIsGate.status).toBe(200);
    const aligned = await save(h, {
      objective: "Cut intake handling time by 40%",
      successMeasure: "Median handle time",
      teoaScopeId: "scope-1",
      visionObjectiveId: "obj-1",
    });
    expect(aligned.status).toBe(200);
    // Alignment needs named approvers before it even looks at the facts.
    await assign(h, "teoa_approver", "u1@example.test");
    await assign(h, "vision_approver", "u1@example.test");
    // Alignment still needs the OS project link and the Vision delivery, so
    // the gate is refused until those tables say so; this proves a save cannot
    // satisfy an alignment.
    const refused = await gateOf(h, "aligned");
    expect(refused.status).toBe(409);
    const link = await h.routes.get(P);
    expect(link.status).toBe(200);
    await h.sqlite
      .prepare(
        "INSERT INTO atlas_project_links (installation_id,os_instance_id,workspace_id,os_project_id,atlas_project_id,linked_at,linked_by,last_checked_at,access_state) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "atlas-local",
        "os-1",
        "ws-1",
        "proj-1",
        P,
        AT,
        "u1",
        AT,
        "readable",
      );
    await h.sqlite
      .prepare(
        "INSERT INTO atlas_vision_delivery_outbox (project_id,atlas_revision,data,updated_at) VALUES (?,?,?,?)",
      )
      .run(P, 1, "{}", AT);
    const passed = await gateOf(h, "aligned");
    expect(passed.status).toBe(200);
    expect((passed.body.record as { stage: string }).stage).toBe("value");
    const changed = await h.routes.patch(
      (() => {
        const revision = (passed.body.record as { revision: number }).revision;
        return call(
          { revision, fields: { objective: "Cut intake handling time by 60%" } },
          "PATCH",
        );
      })(),
      P,
    );
    expect(changed.headers.get("X-Atlas-Reopened")).toBe("1");
    const reopened = await jsonOf(changed);
    expect((reopened.body.record as { stage: string }).stage).toBe("aligned");
    expect(
      (reopened.body.gates as { decision: string }[]).map((g) => g.decision),
    ).toContain("reopen");
    expect(reopened.body.chain).toMatchObject({ ok: true });
  });
});
test.describe("evidence and the governance gate", () => {
  test("a restricted classification is refused and stores nothing", async () => {
    const h = await onboarded();
    for (const classification of ["export-restricted", "itar", "cui", "customer-pii"]) {
      const result = await jsonOf(
        await h.routes.evidenceAdd(
          call({
            kind: "document",
            source: "spec.docx",
            sha256: "b".repeat(64),
            bytes: 10,
            classification,
          }),
          P,
        ),
      );
      expect(result.status, classification).toBe(403);
      expect(result.body.code).toBe("classification_blocked");
    }
    const rows = h.sqlite.prepare("SELECT COUNT(*) AS n FROM atlas_evidence").get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });
  test("a blocking scan is refused and names only its codes", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.evidenceAdd(
        call({
          kind: "voice",
          source: "narration.m4a",
          sha256: "c".repeat(64),
          bytes: 10,
          classification: "internal",
          scanText: "paste this key AKIAIOSFODNN7EXAMPLE into the tool",
        }),
        P,
      ),
    );
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("scan_blocked");
    expect(result.body.findings).toEqual(["secret.aws_key"]);
    // The matched value never reaches the response.
    expect(JSON.stringify(result.body)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
  test("a body cannot claim its own scan verdict", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.evidenceAdd(
        call({
          kind: "document",
          source: "spec.docx",
          sha256: "d".repeat(64),
          bytes: 10,
          classification: "internal",
          scanState: "clear",
          findings: [],
        }),
        P,
      ),
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("invalid_evidence");
  });
  test("evidence with no text to inspect is stored as a review, not a pass", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.evidenceAdd(
        call({
          kind: "recording",
          source: "capture.mp4",
          sha256: "e".repeat(64),
          bytes: 10,
          classification: "internal",
          status: "accepted",
        }),
        P,
      ),
    );
    expect(result.status).toBe(200);
    const stored = (result.body.evidence as { scanState: string; status: string }[])[0];
    expect(stored.scanState).toBe("review");
    expect(stored.status).toBe("pending");
  });
});
test.describe("value", () => {
  test("a measured record without a source is refused with its problems", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.valueAdd(
        call({
          basis: "measured",
          period: "baseline",
          figures: { hours: 640 },
          method: "ai-jam-value-case",
          methodVersion: "provisional-1",
          confidence: "medium",
        }),
        P,
      ),
    );
    expect(result.status).toBe(400);
    expect(result.body.problems).toContain("measured_without_source");
  });
  test("a sourced measured record is stored and becomes the project's basis", async () => {
    const h = await onboarded();
    const result = await jsonOf(
      await h.routes.valueAdd(
        call({
          basis: "measured",
          period: "baseline",
          figures: { hours: 640, cost: 28800 },
          method: "ai-jam-value-case",
          methodVersion: "provisional-1",
          confidence: "medium",
          sourceRef: "time-export.csv",
        }),
        P,
      ),
    );
    expect(result.status).toBe(200);
    expect((result.body.values as unknown[]).length).toBe(1);
    expect((result.body.record as { valueBasis: string }).valueBasis).toBe("measured");
  });
});
test("the whole walk leaves a verifiable chain", async () => {
  const h = await onboarded();
  await gateOf(h, "intake");
  await recordReuse(h);
  await gateOf(h, "reuse", "pass", "no match in the catalogue");
  const view = await jsonOf(await h.routes.get(P));
  expect(view.body.chain).toEqual({ ok: true, length: 3 });
  const record = parseRecord(view.body.record);
  expect(record.ok).toBe(true);
  if (record.ok) expect(record.value.stage).toBe("capture");
});
