// The onboarding brain's HTTP handlers, with their dependencies passed in so
// the tests run exactly this code over a database built from the migrations.
// The route files wire in the real authorisation and the D1 binding; nothing
// here imports a Worker binding.
//
// The order on every write is the contract:
//   same origin -> signed-in -> permission -> project read right ->
//   revision match -> validate -> audit -> store.
// A gate additionally checks, in this order: the gate is for the project's
// current stage, the actor holds every permission that stage requires, and no
// prerequisite is missing. Only then do the audit row and the stage move
// exist. Nothing is inferred: a pass without its facts is a 409, not a quiet
// success, and a fact that proves an alignment (an OS project link, a Vision
// delivery, a Studio compliance record) is read from the table that recorded
// it, never from an editable field.
import { z } from "zod";
import { appendGateEvent, gateEventsFor, verifyChain, type ChainDb } from "../audit/chain";
import type { Permission } from "../access-policy";
import {
  CLASSIFICATIONS,
  EVIDENCE_KINDS,
  SCAN_VERDICTS,
  allowsUpload,
} from "../domain/classification";
import {
  GATE_DECISIONS,
  canPassGate,
  gatePermissions,
  missingGatePermissions,
  reasonRequired,
} from "../domain/gates";
import { materialDigest } from "../domain/digest";
import {
  NEXT,
  REUSE_DECISIONS,
  RETIRED,
  isStageOrRetired,
  requirementsFor,
  type ReuseDecision,
  type Stage,
  type StageOrRetired,
} from "../domain/stages";
import {
  CONFIDENCE,
  VALUE_BASES,
  VALUE_PERIODS,
  valueProblems,
  type ValueBasis,
} from "../domain/value";
import { json, sameOrigin } from "../http";
import {
  EDITABLE_FIELDS,
  brainDataSchema,
  defaultBrainData,
  evidenceJson,
  factsFrom,
  pickEditable,
  toRecord,
  valueJson,
  type BrainData,
  type ValueRow,
} from "./model";
export type BrainAccess = {
  userId: string;
  superAdmin: boolean;
  permissions: readonly string[];
};
export type BrainProject = { id: string; name: string; revision: number };
export type BrainDeps = {
  authorize(
    permission?: Permission,
  ): Promise<
    { access: BrainAccess; error?: never } | { access?: never; error: Response }
  >;
  /** Project read right, resolved by the same policy the rest of Atlas uses. */
  loadProject(access: BrainAccess, id: string): Promise<BrainProject | null>;
  canEdit(access: BrainAccess, id: string): Promise<boolean>;
  /** Ids of the projects this actor may read; the list route filters on it. */
  visibleIds(access: BrainAccess): Promise<Set<string>>;
  db: ChainDb;
  now(): string;
  newId(): string;
};
type OnboardingRow = {
  project_id: string;
  stage: string;
  status: string;
  data: string;
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type ReuseRow = {
  project_id: string;
  decision: string;
  reason: string;
  matches: string;
  decided_by: string;
  updated_at: string;
};
type LinkRow = {
  os_project_id: string;
  workspace_id: string;
  os_instance_id: string;
};
const editable = new Set<string>(EDITABLE_FIELDS);
const parseRowData = (row: OnboardingRow): BrainData => {
  try {
    return brainDataSchema.parse(JSON.parse(row.data));
  } catch {
    // A row written by an older shape must not 500 the whole lane; the
    // schema's defaults are the migration path for every field added later.
    return defaultBrainData();
  }
};
async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return null;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
const badBody = () => json({ error: "Send a JSON body.", code: "bad_body" }, 400);
const notFound = (code = "project_not_found") =>
  json({ error: "That project is not available to you.", code }, 404);
export function createOnboardingRoutes(deps: BrainDeps) {
  const now = () => deps.now();
  /** Every read a handler needs, in one place, so no handler invents a fact. */
  async function context(projectId: string) {
    const { db } = deps;
    const onboarding = await db
      .prepare("SELECT * FROM atlas_onboarding WHERE project_id = ?")
      .bind(projectId)
      .first<OnboardingRow>();
    const evidence = await db
      .prepare("SELECT * FROM atlas_evidence WHERE project_id = ? ORDER BY created_at ASC")
      .bind(projectId)
      .all<Record<string, unknown>>();
    const values = await db
      .prepare("SELECT * FROM atlas_value WHERE project_id = ? ORDER BY created_at ASC")
      .bind(projectId)
      .all<Record<string, unknown>>();
    const reuse = await db
      .prepare("SELECT * FROM atlas_reuse_checks WHERE project_id = ?")
      .bind(projectId)
      .first<ReuseRow>();
    const link = await db
      .prepare("SELECT * FROM atlas_project_links WHERE atlas_project_id = ?")
      .bind(projectId)
      .first<LinkRow>();
    const delivery = await db
      .prepare("SELECT COUNT(*) AS n FROM atlas_vision_delivery_outbox WHERE project_id = ?")
      .bind(projectId)
      .first<{ n: number }>();
    return {
      onboarding,
      evidence: evidence.results,
      values: values.results,
      reuse,
      link,
      visionDeliveryCommitted: Number(delivery?.n ?? 0) > 0,
    };
  }
  /** The composed read the browser, macOS and Windows all use. */
  async function view(project: BrainProject, held: readonly string[]) {
    const ctx = await context(project.id);
    const row = ctx.onboarding;
    if (!row) return null;
    const data = parseRowData(row);
    const accepted = ctx.evidence.filter((e) => e.status === "accepted");
    const pending = ctx.evidence.filter((e) => e.status === "pending");
    const scan = accepted.length
      ? accepted.every((e) => e.scan_state === "clear")
        ? ("clear" as const)
        : ("review" as const)
      : null;
    const reuse = ctx.reuse
      ? {
          decision: ctx.reuse.decision as ReuseDecision,
          reason: ctx.reuse.reason,
          matches: JSON.parse(ctx.reuse.matches) as unknown[],
        }
      : null;
    const values = ctx.values as unknown as ValueRow[];
    const baseline = values.some(
      (v) => v.period === "baseline" && v.basis !== "not-tracked",
    );
    const realized = values.some(
      (v) => v.period === "d90" && v.basis === "measured",
    );
    const facts = factsFrom({
      data,
      evidenceAccepted: accepted.length,
      evidenceScan: scan,
      osProjectId: ctx.link?.os_project_id ?? null,
      visionDeliveryCommitted: ctx.visionDeliveryCommitted,
      baselineValue: baseline,
      realizedValue: realized,
      reuse: reuse ? { decision: reuse.decision, reason: reuse.reason } : null,
    });
    const stage = (isStageOrRetired(row.stage) ? row.stage : "intake") as StageOrRetired;
    const gates = (await gateEventsFor(deps.db, project.id)).map((e) => ({
      stage: e.stage,
      decision: e.decision,
      at: e.createdAt,
    }));
    const latest = [...values].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    )[0];
    const record = toRecord({
      projectId: project.id,
      name: project.name,
      stage,
      revision: row.revision,
      gates,
      evidenceAccepted: accepted.length,
      evidencePending: pending.length,
      osProjectId: ctx.link?.os_project_id ?? null,
      data,
      reuseDecision: reuse?.decision ?? null,
      valueBasis: (latest?.basis as ValueBasis | undefined) ?? null,
      updatedAt: row.updated_at,
    });
    const next = stage === RETIRED ? null : (NEXT[stage] ?? null);
    return {
      record,
      status: row.status,
      facts,
      /** The editable fields as stored, so a client form starts from the
       * truth rather than from empty inputs. */
      data,
      stage: {
        current: stage,
        next,
        missing: requirementsFor(stage, facts),
        missingForNext: next ? requirementsFor(next, facts) : [],
      },
      chain: await verifyChain(deps.db, project.id),
      evidence: ctx.evidence.map((e) =>
        evidenceJson({
          id: e.id as string,
          projectId: e.project_id as string,
          kind: e.kind as string,
          source: e.source as string,
          sha256: e.sha256 as string,
          bytes: Number(e.bytes),
          classification: e.classification as string,
          scanState: e.scan_state as string,
          findings: e.findings as string,
          reviewer: (e.reviewer as string | null) ?? null,
          status: e.status as string,
          createdAt: e.created_at as string,
        }),
      ),
      values: values.map(valueJson),
      reuse,
      gates,
      /** Which gates this actor may pass, so the UI hides what the server
       * would refuse rather than showing a button that always 403s. */
      canGate: Object.fromEntries(
        [...Object.keys(NEXT), RETIRED].map((s) => [
          s,
          canPassGate(held, s as StageOrRetired),
        ]),
      ),
    };
  }
  async function load(access: BrainAccess, id: string) {
    const project = await deps.loadProject(access, id);
    if (!project) return null;
    const row = await deps.db
      .prepare("SELECT * FROM atlas_onboarding WHERE project_id = ?")
      .bind(id)
      .first<OnboardingRow>();
    return { project, row };
  }
  const list = async (): Promise<Response> => {
    const auth = await deps.authorize("onboarding.view");
    if (auth.error) return auth.error;
    const visible = await deps.visibleIds(auth.access);
    const { results } = await deps.db
      .prepare(
        `SELECT o.project_id, o.stage, o.status, o.revision, o.updated_at, p.data
           FROM atlas_onboarding o JOIN atlas_projects p ON p.id = o.project_id
          ORDER BY o.updated_at DESC LIMIT 500`,
      )
      .bind()
      .all<Record<string, unknown>>();
    const projects = results
      .filter((r) => visible.has(r.project_id as string))
      .map((r) => ({
        projectId: r.project_id as string,
        name: nameOf(r.data as string),
        stage: r.stage as string,
        status: r.status as string,
        revision: Number(r.revision),
        updatedAt: r.updated_at as string,
      }));
    return json({ projects });
  };
  const get = async (id: string): Promise<Response> => {
    const auth = await deps.authorize("onboarding.view");
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await view(found.project, auth.access.permissions);
    if (!body) return notFound("not_onboarded");
    return json(body);
  };
  const create = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.create");
    if (auth.error) return auth.error;
    const project = await deps.loadProject(auth.access, id);
    if (!project) return notFound();
    if (!(await deps.canEdit(auth.access, id)))
      return json(
        { error: "You can view this project but not start its intake.", code: "not_editable" },
        403,
      );
    const existing = await deps.db
      .prepare("SELECT project_id FROM atlas_onboarding WHERE project_id = ?")
      .bind(id)
      .first();
    if (existing)
      return json({ error: "This project already has an intake.", code: "already_onboarded" }, 409);
    const body = await readBody(request);
    let data: BrainData;
    try {
      data = brainDataSchema.parse(body ? pickEditable(body) : {});
    } catch (error) {
      return json({ error: (error as Error).message, code: "invalid_fields" }, 400);
    }
    if (data.classificationDeclared && data.classification === null)
      return json(
        { error: "Choose a data classification.", code: "classification_required" },
        400,
      );
    const at = now();
    await deps.db
      .prepare(
        `INSERT INTO atlas_onboarding
           (project_id, stage, status, data, revision, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(id, "intake", "active", JSON.stringify(data), 1, auth.access.userId, at, at)
      .run();
    // Opening the intake is the first audited event of the project's brain.
    await appendGateEvent(deps.db, {
      projectId: id,
      stage: "intake",
      fromStage: null,
      toStage: "intake",
      actor: auth.access.userId,
      role: "onboarding.create",
      decision: "pass",
      reason: "Intake opened",
      at,
    });
    return get(id);
  };
  const patch = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.create");
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    if (!(await deps.canEdit(auth.access, id)))
      return json({ error: "You cannot edit this project.", code: "not_editable" }, 403);
    if (found.row.status === "retired")
      return json({ error: "A retired project is read-only.", code: "retired" }, 403);
    const body = await readBody(request);
    if (!body) return badBody();
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision !== found.row.revision)
      return json(
        {
          error: "This project changed since you opened it.",
          code: "revision_changed",
          current: found.row.revision,
        },
        409,
      );
    const unknown = Object.keys(body).filter((k) => k !== "revision" && k !== "fields");
    if (unknown.length)
      return json({ error: "Unknown field in the body.", code: "unknown_key", keys: unknown }, 400);
    const rawFields = body.fields;
    if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields))
      return badBody();
    const supplied = rawFields as Record<string, unknown>;
    const readOnly = Object.keys(supplied).filter((k) => !editable.has(k));
    if (readOnly.length)
      return json(
        {
          error: "That field is set by a hand-off, not by a save.",
          code: "read_only_field",
          keys: readOnly,
        },
        400,
      );
    const previous = parseRowData(found.row);
    let data: BrainData;
    try {
      data = brainDataSchema.parse({ ...previous, ...pickEditable(supplied) });
    } catch (error) {
      return json({ error: (error as Error).message, code: "invalid_fields" }, 400);
    }
    if (data.classificationDeclared && data.classification === null)
      return json(
        { error: "Choose a data classification.", code: "classification_required" },
        400,
      );
    const at = now();
    const digest = await digestOf(data);
    let stage = found.row.stage as StageOrRetired;
    let reopened = false;
    // PRD §6: a material change after alignment re-opens stage 4, and the
    // reopening is an audited event carrying the new digest — not a silent
    // edit to a project that had already been approved.
    if (
      previous.materialDigest &&
      digest !== previous.materialDigest &&
      isStageOrRetired(stage) &&
      stage !== RETIRED &&
      ["aligned", "value", "to-be", "build", "live", "measured"].includes(stage)
    ) {
      await appendGateEvent(deps.db, {
        projectId: id,
        stage: "aligned",
        fromStage: stage,
        toStage: "aligned",
        actor: auth.access.userId,
        role: "onboarding.create",
        decision: "reopen",
        reason: "Material change to the objective, success measure or scope",
        materialDigest: digest,
        at,
      });
      stage = "aligned";
      reopened = true;
    }
    await deps.db
      .prepare(
        "UPDATE atlas_onboarding SET data = ?, stage = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND revision = ?",
      )
      .bind(JSON.stringify(data), stage, at, id, found.row.revision)
      .run();
    const response = await get(id);
    if (!reopened) return response;
    return new Response(response.body, {
      status: 200,
      headers: { ...Object.fromEntries(response.headers), "X-Atlas-Reopened": "1" },
    });
  };
  const gate = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.view");
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await readBody(request);
    if (!body) return badBody();
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision !== found.row.revision)
      return json(
        {
          error: "This project changed since you opened it.",
          code: "revision_changed",
          current: found.row.revision,
        },
        409,
      );
    const stage = body.stage;
    if (!isStageOrRetired(stage))
      return json({ error: "Unknown stage.", code: "unknown_stage" }, 400);
    if (!(GATE_DECISIONS as readonly string[]).includes(String(body.decision)))
      return json({ error: "Unknown decision.", code: "unknown_decision" }, 400);
    const decision = body.decision as (typeof GATE_DECISIONS)[number];
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reasonRequired(decision) && !reason)
      return json({ error: "Give a reason for this decision.", code: "reason_required" }, 400);
    const current = found.row.stage as StageOrRetired;
    // Retirement is the one gate that is not "the stage you are in": it can be
    // asked for from any stage, and its own condition is a stated reason.
    const retiring = stage === RETIRED;
    if (!retiring && stage !== current)
      return json(
        { error: "That gate is not the project's current stage.", code: "wrong_stage", current },
        409,
      );
    const missingRole = missingGatePermissions([...auth.access.permissions], stage);
    if (missingRole.length)
      return json(
        {
          error: "You do not hold the role this gate needs.",
          code: "gate_role_required",
          missing: missingRole,
        },
        403,
      );
    const currentView = await view(found.project, auth.access.permissions);
    if (!currentView) return notFound("not_onboarded");
    const at = now();
    // Check the requirements of the stage being decided, not of the stage the
    // project is standing in: retirement is asked for from another stage.
    const missingFacts = requirementsFor(stage, currentView.facts);
    if (decision === "pass" && missingFacts.length)
      return json(
        {
          error: "This stage still has unmet requirements.",
          code: "prerequisite_missing",
          missing: missingFacts,
        },
        409,
      );
    const target: StageOrRetired =
      decision === "pass"
        ? retiring || current === RETIRED
          ? RETIRED
          : (NEXT[current as Stage] ?? RETIRED)
        : decision === "reopen"
          ? "aligned"
          : (current as StageOrRetired);
    const data = parseRowData(found.row);
    const digest =
      current === "aligned" || target === "aligned"
        ? await digestOf(data)
        : data.materialDigest;
    const stored = await appendGateEvent(deps.db, {
      projectId: id,
      stage,
      fromStage: current,
      toStage: decision === "reject" ? null : target,
      actor: auth.access.userId,
      role: gatePermissions(stage).join("+"),
      decision,
      reason,
      evidenceRef:
        typeof body.evidenceRef === "string" ? body.evidenceRef.slice(0, 200) : null,
      materialDigest: digest,
      at,
    });
    if (!stored.ok)
      return json(
        {
          error: "Another change landed at the same time. Reload and try again.",
          code: stored.code,
        },
        409,
      );
    await deps.db
      .prepare(
        "UPDATE atlas_onboarding SET stage = ?, status = ?, data = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND revision = ?",
      )
      .bind(
        decision === "reject" ? current : target,
        target === RETIRED ? "retired" : "active",
        JSON.stringify({ ...data, materialDigest: digest }),
        at,
        id,
        found.row.revision,
      )
      .run();
    return get(id);
  };
  const reuse = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.triage");
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await readBody(request);
    if (!body) return badBody();
    if (!(REUSE_DECISIONS as readonly string[]).includes(String(body.decision)))
      return json({ error: "Choose reuse, extend or new.", code: "unknown_decision" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason)
      return json({ error: "Say why this decision was taken.", code: "reason_required" }, 400);
    const matches = Array.isArray(body.matches) ? body.matches.slice(0, 50) : [];
    const at = now();
    await deps.db
      .prepare(
        `INSERT INTO atlas_reuse_checks
           (project_id, decision, reason, matches, decided_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET decision = excluded.decision,
           reason = excluded.reason, matches = excluded.matches,
           decided_by = excluded.decided_by, updated_at = excluded.updated_at`,
      )
      .bind(id, body.decision, reason, JSON.stringify(matches), auth.access.userId, at, at)
      .run();
    return get(id);
  };
  const evidenceAdd = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.capture.review");
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await readBody(request);
    if (!body) return badBody();
    const parsed = evidenceBody.safeParse(body);
    if (!parsed.success)
      return json(
        {
          error: parsed.error.issues[0]?.message ?? "Check the evidence details.",
          code: "invalid_evidence",
        },
        400,
      );
    const item = parsed.data;
    // PRD §9 G-1/G-2: a restricted class or a blocking scan writes NOTHING.
    if (!allowsUpload(item.classification))
      return json(
        {
          error: "This classification cannot be stored in Atlas.",
          code: "classification_blocked",
          classification: item.classification,
        },
        403,
      );
    if (item.scanState === "blocked")
      return json(
        { error: "The scan blocked this item. It was not stored.", code: "scan_blocked" },
        403,
      );
    const at = now();
    await deps.db
      .prepare(
        `INSERT INTO atlas_evidence
           (id, project_id, kind, source, sha256, bytes, classification, scan_state,
            findings, reviewer, status, retention_delete_after, os_ref, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        deps.newId(),
        id,
        item.kind,
        item.source,
        item.sha256,
        item.bytes,
        item.classification,
        item.scanState,
        JSON.stringify(item.findings),
        item.reviewer ?? null,
        item.status,
        item.retentionDeleteAfter ?? null,
        item.osRef ?? null,
        auth.access.userId,
        at,
      )
      .run();
    return get(id);
  };
  const valueAdd = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.value.edit");
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await readBody(request);
    if (!body) return badBody();
    const parsed = valueBody.safeParse(body);
    if (!parsed.success)
      return json(
        {
          error: parsed.error.issues[0]?.message ?? "Check the value record.",
          code: "invalid_value",
        },
        400,
      );
    const item = parsed.data;
    const problems = valueProblems({
      basis: item.basis,
      period: item.period,
      figures: item.figures,
      target: item.target,
      tier: item.tier ?? null,
      method: item.method,
      methodVersion: item.methodVersion,
      confidence: item.confidence,
      sourceRef: item.sourceRef ?? null,
      notes: item.notes ?? "",
    });
    if (problems.length)
      return json(
        { error: "This value record is not consistent.", code: "invalid_value", problems },
        400,
      );
    const at = now();
    await deps.db
      .prepare(
        `INSERT INTO atlas_value
           (id, project_id, basis, period, tier, figures, target, method, method_version,
            confidence, source_ref, notes, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        deps.newId(),
        id,
        item.basis,
        item.period,
        item.tier ?? null,
        JSON.stringify(item.figures),
        JSON.stringify(item.target),
        item.method,
        item.methodVersion,
        item.confidence,
        item.sourceRef ?? null,
        item.notes ?? "",
        auth.access.userId,
        at,
      )
      .run();
    return get(id);
  };
  return { list, get, create, patch, gate, reuse, evidenceAdd, valueAdd };
}
function nameOf(data: string) {
  try {
    return (JSON.parse(data) as { name?: string }).name ?? "";
  } catch {
    return "";
  }
}
export async function digestOf(data: BrainData) {
  return materialDigest({
    objective: data.objective,
    successMeasure: data.successMeasure,
    teoaScopeId: data.teoaScopeId,
    onboardingFacts: {
      problem: data.problem,
      functionArea: data.functionArea,
      site: data.site,
      volume: data.volume,
    },
  });
}
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const figuresBody = z
  .object({
    hours: z.number().finite().nonnegative().optional(),
    cost: z.number().finite().nonnegative().optional(),
    errorRate: z.number().finite().nonnegative().max(1).optional(),
    volume: z.number().finite().nonnegative().optional(),
  })
  .strict();
const evidenceBody = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    source: z.string().trim().min(1).max(200),
    sha256: hex64,
    bytes: z.number().int().nonnegative().max(2_147_483_648),
    classification: z.enum(CLASSIFICATIONS),
    scanState: z.enum(SCAN_VERDICTS),
    findings: z
      .array(z.string().regex(/^[a-z][a-z0-9._-]{0,59}$/))
      .max(20)
      .default([]),
    reviewer: z.string().trim().max(200).nullable().optional(),
    status: z.enum(["pending", "accepted"]).default("pending"),
    retentionDeleteAfter: z.string().datetime({ offset: true }).nullable().optional(),
    osRef: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
const valueBody = z
  .object({
    basis: z.enum(VALUE_BASES),
    period: z.enum(VALUE_PERIODS),
    tier: z.string().trim().max(60).nullable().optional(),
    figures: figuresBody.default({}),
    target: figuresBody.default({}),
    method: z.string().trim().min(1).max(120),
    methodVersion: z.string().trim().min(1).max(40),
    confidence: z.enum(CONFIDENCE),
    sourceRef: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export type { ChainDb };
