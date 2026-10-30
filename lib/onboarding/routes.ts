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
  allowsUpload,
} from "../domain/classification";
import {
  GATE_DECISIONS,
  gatePermissions,
  reasonRequired,
} from "../domain/gates";
import { materialDigest } from "../domain/digest";
import { parseSteps, parseWorkflow } from "../domain/contracts";
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
import { portfolioReadiness } from "../domain/analysis";
import { findingCodes, scanText } from "../governance/scan";
import {
  HANDOFF_KINDS,
  type HandoffKind,
  diagramforgeHandoff,
  handoffsFor,
  mapsStepsRequest,
  parseComplianceRecord,
  reserveHandoff,
  studioSpec,
} from "./handoffs";
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
  email: string;
  superAdmin: boolean;
  permissions: readonly string[];
};
import {
  assignmentsFrom,
  canAssignRoles,
  canCreateIn,
  canCreateWorkspace,
  canEdit,
  canView,
  gateRefusal,
  isWorkspaceAdmin,
  type Actor,
} from "./access";
import { PROJECT_ROLES, type ProjectRole } from "./roles";
const actorOf = (access: BrainAccess): Actor => ({
  email: access.email,
  superAdmin: access.superAdmin,
  permissions: [...access.permissions],
});
export type BrainProject = { id: string; name: string; revision: number };
export type BrainDeps = {
  authorize(
    permission?: Permission,
    request?: Request,
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
  workspace_id: string | null;
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
  async function context(projectId: string, actorEmail?: string) {
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
    const workspace = onboarding?.workspace_id
      ? await db
          .prepare("SELECT id, name FROM atlas_workspaces WHERE id = ?")
          .bind(onboarding.workspace_id)
          .first<{ id: string; name: string }>()
      : null;
    const workspaceRoles: Record<string, "admin" | "member"> = {};
    if (actorEmail) {
      const memberRows = await db
        .prepare("SELECT workspace_id, role FROM atlas_workspace_members WHERE email = ?")
        .bind(actorEmail)
        .all<{ workspace_id: string; role: string }>();
      for (const member of memberRows.results)
        workspaceRoles[member.workspace_id] = member.role as "admin" | "member";
    }
    const roleRows = await db
      .prepare("SELECT role, email FROM atlas_project_roles WHERE project_id = ?")
      .bind(projectId)
      .all<{ role: string; email: string }>();
    return {
      onboarding,
      workspace,
      workspaceRoles,
      assignments: assignmentsFrom(
        roleRows.results.map((row) => ({ role: row.role as ProjectRole, email: row.email })),
      ),
      evidence: evidence.results,
      values: values.results,
      reuse,
      link,
      visionDeliveryCommitted: Number(delivery?.n ?? 0) > 0,
    };
  }
  /** The composed read the browser, macOS and Windows all use. */
  async function view(project: BrainProject, access: BrainAccess) {
    const ctx = await context(project.id, access.email);
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
      lane: (row as { lane?: string }).lane ?? "governed",
      deferredGates: data.deferredGates,
      workflow: data.workflow,
      steps: data.steps,
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
      handoffs: await handoffsFor(deps.db, project.id),
      workspace: ctx.workspace,
      assignments: ctx.assignments,
      access: (() => {
        const actor = actorOf(access);
        const input = {
          workspaceId: row.workspace_id,
          roles: ctx.workspaceRoles,
          assignments: ctx.assignments,
        };
        return {
          canEdit: canEdit(actor, input),
          canAssignRoles: canAssignRoles(actor, input),
          canView: canView(actor, input),
        };
      })(),
      reuse,
      gates,
      /** Which gates this actor may pass, so the UI hides what the server
       * would refuse rather than showing a button that always 403s. */
      canGate: Object.fromEntries(
        [...Object.keys(NEXT), RETIRED].map((s) => [
          s,
          gateRefusal(actorOf(access), s, {
            workspaceId: row.workspace_id,
            roles: ctx.workspaceRoles,
            assignments: ctx.assignments,
          }) === null,
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
  const list = async (request?: Request): Promise<Response> => {
    const auth = await deps.authorize("onboarding.view", request);
    if (auth.error) return auth.error;
    const visible = await deps.visibleIds(auth.access);
    // One query for the whole board: the seven readiness facts are counted by
    // correlated subqueries, so the badge on a card is the same score the
    // project's detail shows.
    const { results } = await deps.db
      .prepare(
        `SELECT o.project_id, o.stage, o.status, o.revision, o.updated_at, p.data, o.data AS brain_data, o.lane,
          (SELECT COUNT(*) FROM atlas_project_roles r
            WHERE r.project_id = o.project_id AND r.role = 'owner') AS has_owner,
          (SELECT COUNT(*) FROM atlas_project_roles r
            WHERE r.project_id = o.project_id AND r.role = 'process_owner') AS has_process_owner,
          (SELECT COUNT(*) FROM atlas_project_roles r
            WHERE r.project_id = o.project_id AND r.role IN ('teoa_approver','vision_approver')) AS approvers,
          (SELECT COUNT(*) FROM atlas_evidence e
            WHERE e.project_id = o.project_id AND e.status IN ('accepted','redacted')) AS accepted,
          (SELECT COUNT(*) FROM atlas_evidence e
            WHERE e.project_id = o.project_id AND e.status = 'pending') AS pending,
          (SELECT COUNT(*) FROM atlas_evidence e
            WHERE e.project_id = o.project_id AND e.scan_state = 'review'
              AND e.status IN ('accepted','pending','redacted')) AS review,
          (SELECT COUNT(*) FROM atlas_reuse_checks rc
            WHERE rc.project_id = o.project_id) AS reuse,
          (SELECT COUNT(*) FROM atlas_value v
            WHERE v.project_id = o.project_id AND v.period = 'baseline'
              AND v.basis <> 'not-tracked') AS baseline,
          (SELECT COUNT(*) FROM atlas_gate_events g
            WHERE g.project_id = o.project_id) AS events
           FROM atlas_onboarding o JOIN atlas_projects p ON p.id = o.project_id
          ORDER BY o.updated_at DESC LIMIT 500`,
      )
      .bind()
      .all<Record<string, unknown>>();
    const projects = results
      .filter((r) => visible.has(r.project_id as string))
      .map((r) => {
        const approvers = Number(r.approvers ?? 0);
        const facts = {
          rolesFilled:
            (Number(r.has_owner ?? 0) > 0 ? 1 : 0) +
            (Number(r.has_process_owner ?? 0) > 0 ? 1 : 0) +
            Math.min(approvers, 2),
          processOwner: Number(r.has_process_owner ?? 0) > 0,
          approvers: approvers >= 2,
          accepted: Number(r.accepted ?? 0),
          pending: Number(r.pending ?? 0),
          review: Number(r.review ?? 0),
          reuse: Number(r.reuse ?? 0) > 0,
          baseline: Number(r.baseline ?? 0) > 0,
        };
        const score = portfolioReadiness(facts);
        return {
          projectId: r.project_id as string,
          name: nameOf(r.data as string),
          stage: r.stage as string,
          status: r.status as string,
          revision: Number(r.revision),
          updatedAt: r.updated_at as string,
          kind: kindOf((r.brain_data as string) ?? "{}"),
          lane: (r.lane as string) ?? "governed",
          deferred: deferredCountOf((r.brain_data as string) ?? "{}"),
          readiness: score.readiness,
          met: score.met,
          total: score.total,
          events: Number(r.events ?? 0),
        };
      });
    return json({ projects });
  };
  const get = async (id: string, request?: Request): Promise<Response> => {
    const auth = await deps.authorize("onboarding.view", request);
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await view(found.project, auth.access);
    if (!body) return notFound("not_onboarded");
    return json(body);
  };
  const create = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.create", request);
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
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!workspaceId)
      return json(
        {
          error: "Choose the workspace this project belongs to.",
          code: "workspace_required",
        },
        400,
      );
    const actor = actorOf(auth.access);
    const memberRows = await deps.db
      .prepare("SELECT workspace_id, role FROM atlas_workspace_members WHERE email = ?")
      .bind(auth.access.email)
      .all<{ workspace_id: string; role: string }>();
    const roles: Record<string, "admin" | "member"> = {};
    for (const member of memberRows.results)
      roles[member.workspace_id] = member.role as "admin" | "member";
    const workspace = await deps.db
      .prepare("SELECT id FROM atlas_workspaces WHERE id = ?")
      .bind(workspaceId)
      .first();
    if (!workspace)
      return json({ error: "That workspace does not exist.", code: "unknown_workspace" }, 404);
    if (!canCreateIn(actor, workspaceId, roles))
      return json(
        {
          error: "Only a workspace admin can create projects there.",
          code: "workspace_admin_required",
        },
        403,
      );
    const lane = body?.lane === "quick" ? "quick" : "governed";
    const ownerEmail =
      typeof body?.ownerEmail === "string" && body.ownerEmail.trim()
        ? body.ownerEmail.trim().toLowerCase()
        : auth.access.email;
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
    // The quick lane: start where the work is, and record what was skipped as
    // a debt with an owner and a date rather than pretending it happened.
    const dueAt = new Date(Date.parse(at) + 14 * 24 * 3600 * 1000).toISOString();
    const deferred =
      lane === "quick"
        ? ["as-is", "aligned", "value"].map((stage) => ({
            stage: stage as "as-is" | "aligned" | "value",
            owner: ownerEmail,
            dueAt,
          }))
        : [];
    const startStage = lane === "quick" ? "capture" : "intake";
    if (lane === "quick") data = { ...data, deferredGates: deferred };
    await deps.db
      .prepare(
        `INSERT INTO atlas_onboarding
           (project_id, workspace_id, lane, stage, status, data, revision, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        workspaceId,
        lane,
        startStage,
        "active",
        JSON.stringify(data),
        1,
        auth.access.userId,
        at,
        at,
      )
      .run();
    // The assignment step starts here: every project has an owner from the
    // first moment, so the gate rules never fall back to "nobody".
    await deps.db
      .prepare(
        `INSERT INTO atlas_project_roles (project_id, role, email, assigned_by, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .bind(id, "owner", ownerEmail, auth.access.email, at)
      .run();
    // Opening the intake is the first audited event of the project's brain.
    // On the quick lane, the three stages it starts past are recorded with the
    // debt they leave, in the same chain.
    const opened: ("intake" | "reuse" | "capture")[] =
      lane === "quick" ? ["intake", "reuse", "capture"] : ["intake"];
    for (const stage of opened) {
      await appendGateEvent(deps.db, {
        projectId: id,
        lane,
        deferred: deferred.map((item) => item.stage),
        stage,
        fromStage: null,
        toStage: stage,
        actor: auth.access.userId,
        role: "onboarding.create",
        decision: "pass",
        reason: stage === "intake" ? "Intake opened" : `Quick lane: ${stage} recorded`,
        at,
      });
    }
    return get(id, request);
  };
  const patch = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.create", request);
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    if (!(await deps.canEdit(auth.access, id)))
      return json({ error: "You cannot edit this project.", code: "not_editable" }, 403);
    const patchCtx = await context(id, auth.access.email);
    if (
      !canEdit(actorOf(auth.access), {
        workspaceId: found.row.workspace_id,
        roles: patchCtx.workspaceRoles,
        assignments: patchCtx.assignments,
      })
    )
      return json(
        {
          error: "Only the project's owner or a workspace admin can change it.",
          code: "edit_assignment_required",
        },
        403,
      );
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
    const response = await get(id, request);
    if (!reopened) return response;
    return new Response(response.body, {
      status: 200,
      headers: { ...Object.fromEntries(response.headers), "X-Atlas-Reopened": "1" },
    });
  };
  const gate = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.view", request);
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
    const gateCtx = await context(id, auth.access.email);
    const refusal = gateRefusal(actorOf(auth.access), stage, {
      workspaceId: found.row.workspace_id,
      roles: gateCtx.workspaceRoles,
      assignments: gateCtx.assignments,
    });
    if (refusal)
      return json(
        refusal === "assignment_required"
          ? {
              error:
                "You are not assigned the role this gate needs on this project.",
              code: refusal,
            }
          : {
              error: "You do not hold the role this gate needs.",
              code: refusal,
            },
        403,
      );
    const currentView = await view(found.project, auth.access);
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
    // A deferred sign-off is paid off by passing its gate: the event carries
    // the remaining list, so the chain always says what is still owed.
    const stillDeferred = data.deferredGates.filter((item) => item.stage !== stage);
    const nextData = { ...data, deferredGates: stillDeferred };
    const digest =
      current === "aligned" || target === "aligned"
        ? await digestOf(nextData)
        : data.materialDigest;
    const stored = await appendGateEvent(deps.db, {
      projectId: id,
      stage,
      fromStage: current,
      toStage: decision === "reject" ? null : target,
      actor: auth.access.userId,
      role: gatePermissions(stage).join("+"),
      decision,
      lane: (found.row as { lane?: string }).lane === "quick" ? "quick" : "governed",
      deferred: stillDeferred.map((item) => item.stage),
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
        JSON.stringify({ ...nextData, materialDigest: digest }),
        at,
        id,
        found.row.revision,
      )
      .run();
    return get(id, request);
  };
  const reuse = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.triage", request);
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
    return get(id, request);
  };
  const evidenceAdd = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.capture.review", request);
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
    // The verdict is the SERVER's: the body may carry the text to scan, but
    // never the answer. Content we cannot inspect is a review, not a pass.
    const scan = scanText(item.scanText);
    if (scan.verdict === "blocked")
      return json(
        {
          error: "The scan blocked this item. It was not stored.",
          code: "scan_blocked",
          findings: findingCodes(scan),
        },
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
        scan.verdict,
        JSON.stringify(findingCodes(scan)),
        item.reviewer ?? null,
        scan.verdict === "clear" && item.status === "accepted"
          ? "accepted"
          : "pending",
        item.retentionDeleteAfter ?? null,
        item.osRef ?? null,
        auth.access.userId,
        at,
      )
      .run();
    return get(id, request);
  };
  const valueAdd = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.value.edit", request);
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
    return get(id, request);
  };
  /** Reserve one hand-off for another tool. Nothing is dispatched here: the
   * body and its idempotency key are stored so a transport added by the
   * contract's owner sends exactly these bytes, once. */
  const handoffCreate = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.handoff", request);
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await readBody(request);
    if (!body) return badBody();
    const kind = body.kind;
    if (!(HANDOFF_KINDS as readonly string[]).includes(String(kind)))
      return json({ error: "Unknown hand-off kind.", code: "unknown_kind" }, 400);
    const ctx = await context(id);
    if (!ctx.onboarding) return notFound("not_onboarded");
    const data = parseRowData(ctx.onboarding);
    const evidence = ctx.evidence
      .filter((item) => item.status === "accepted" || item.status === "redacted")
      .map((item) => ({
        id: item.id as string,
        sha256: item.sha256 as string,
        kind: item.kind as string,
        classification: item.classification as never,
      }));
    const mapType = body.mapType === "future" ? "future" : "as-is";
    const questions = Array.isArray(body.questions)
      ? body.questions.filter((q): q is string => typeof q === "string")
      : [];
    let payload: unknown;
    switch (kind as HandoffKind) {
      case "kg":
        payload = mapsStepsRequest({
          projectId: id,
          projectName: found.project.name,
          evidence,
          mapType,
          stepFormatRevision:
            typeof body.stepFormatRevision === "string"
              ? body.stepFormatRevision.slice(0, 80)
              : null,
        });
        break;
      case "diagramforge":
        payload = diagramforgeHandoff({
          projectId: id,
          projectName: found.project.name,
          mapType,
          evidence,
          questions,
        });
        break;
      case "studio":
        if (!data.buildDecision)
          return json(
            {
              error: "Choose the build decision before asking Studio.",
              code: "build_decision_missing",
            },
            409,
          );
        payload = studioSpec({
          projectId: id,
          projectName: found.project.name,
          decision: data.buildDecision,
          toBeMapRef: data.toBeMapRef,
          processManifestHash:
            typeof body.processManifestHash === "string"
              ? body.processManifestHash.slice(0, 128)
              : null,
          objective: data.objective,
          successMeasure: data.successMeasure,
          classification: (data.classification ?? "internal") as never,
        });
        break;
      default:
        payload = {
          schema: "atlas-companion-request/1",
          projectId: id,
          projectName: found.project.name,
        };
    }
    const reserved = await reserveHandoff(deps.db, {
      id: deps.newId(),
      projectId: id,
      kind: kind as HandoffKind,
      body: payload,
      at: now(),
    });
    if (!reserved.ok)
      return json(
        {
          error: "A hand-off of this kind is already open for this project.",
          code: reserved.code,
        },
        409,
      );
    return get(id, request);
  };
  /** Accept a Studio compliance record back. Only a record that names what
   * ran and whether it passed can mark a build as shipped. */
  const compliance = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.handoff", request);
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const body = await readBody(request);
    if (!body) return badBody();
    const parsed = parseComplianceRecord(body.record);
    if (!parsed.ok)
      return json(
        { error: "That is not a Studio compliance record.", code: parsed.code },
        400,
      );
    if (!parsed.value.passed)
      return json(
        { error: "The compliance record did not pass; nothing was shipped.", code: "not_passed" },
        409,
      );
    const data = parseRowData(found.row);
    const at = now();
    await deps.db
      .prepare(
        "UPDATE atlas_onboarding SET data = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND revision = ?",
      )
      .bind(
        JSON.stringify({
          ...data,
          complianceRecordId: parsed.value.recordId,
          shippedRef: parsed.value.subAppId,
        }),
        at,
        id,
        found.row.revision,
      )
      .run();
    return get(id, request);
  };
  /** The assignment step: name the owner, the process owner and the two
   * alignment approvers for this project. Only a workspace admin (or the
   * Super Admin) may assign, so an owner cannot hand themselves an approval. */
  const rolesAssign = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.triage", request);
    if (auth.error) return auth.error;
    const found = await load(auth.access, id);
    if (!found) return notFound();
    if (!found.row) return notFound("not_onboarded");
    const assignCtx = await context(id, auth.access.email);
    if (
      !canAssignRoles(actorOf(auth.access), {
        workspaceId: found.row.workspace_id,
        roles: assignCtx.workspaceRoles,
      })
    )
      return json(
        {
          error: "Only a workspace admin can assign roles on this project.",
          code: "assignment_forbidden",
        },
        403,
      );
    const body = await readBody(request);
    if (!body) return badBody();
    const role = body.role;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!(PROJECT_ROLES as readonly string[]).includes(String(role)))
      return json({ error: "Unknown role.", code: "unknown_role" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ error: "Name the person's email address.", code: "email_required" }, 400);
    const at = now();
    if (body.remove === true) {
      await deps.db
        .prepare("DELETE FROM atlas_project_roles WHERE project_id = ? AND role = ?")
        .bind(id, role)
        .run();
      if (role === "owner")
        return json(
          {
            error: "A project always has an owner; assign another one instead.",
            code: "owner_required",
          },
          409,
        );
      return get(id, request);
    }
    await deps.db
      .prepare(
        `INSERT INTO atlas_project_roles (project_id, role, email, assigned_by, created_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(project_id, role) DO UPDATE SET email = excluded.email,
           assigned_by = excluded.assigned_by, created_at = excluded.created_at`,
      )
      .bind(id, role, email, auth.access.email, at)
      .run();
    return get(id, request);
  };

  /** The workspaces this actor may see: all of them for the Super Admin, the
   * ones they belong to for everyone else. */
  const workspacesList = async (request?: Request): Promise<Response> => {
    const auth = await deps.authorize("onboarding.view", request);
    if (auth.error) return auth.error;
    const { results } = await deps.db
      .prepare("SELECT id, name, slug FROM atlas_workspaces WHERE archived_at IS NULL ORDER BY name")
      .bind()
      .all<{ id: string; name: string; slug: string }>();
    if (auth.access.superAdmin)
      return json({ workspaces: results.map((row) => ({ ...row, role: "super_admin" })) });
    const memberRows = await deps.db
      .prepare("SELECT workspace_id, role FROM atlas_workspace_members WHERE email = ?")
      .bind(auth.access.email)
      .all<{ workspace_id: string; role: string }>();
    const mine = new Map(memberRows.results.map((row) => [row.workspace_id, row.role]));
    return json({
      workspaces: results
        .filter((row) => mine.has(row.id))
        .map((row) => ({ ...row, role: mine.get(row.id) })),
    });
  };

  /** Only the Super Admin creates a workspace. */
  const workspaceCreate = async (request: Request): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.view", request);
    if (auth.error) return auth.error;
    if (!canCreateWorkspace(actorOf(auth.access)))
      return json(
        { error: "Only the Super Admin creates workspaces.", code: "super_admin_required" },
        403,
      );
    const body = await readBody(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80)
      return json({ error: "Give the workspace a name.", code: "name_required" }, 400);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    if (!slug) return json({ error: "That name has no usable letters.", code: "name_required" }, 400);
    try {
      await deps.db
        .prepare(
          "INSERT INTO atlas_workspaces (id, name, slug, created_by, created_at) VALUES (?,?,?,?,?)",
        )
        .bind(deps.newId(), name, slug, auth.access.email, now())
        .run();
    } catch {
      return json(
        { error: "A workspace with that name already exists.", code: "slug_taken" },
        409,
      );
    }
    return workspacesList(request);
  };

  /** Who is in a workspace. The Super Admin adds an admin; a workspace admin
   * may add members but never another admin. */
  const workspaceMemberAdd = async (request: Request, id: string): Promise<Response> => {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.view", request);
    if (auth.error) return auth.error;
    const memberCtx = await deps.db
      .prepare("SELECT workspace_id, role FROM atlas_workspace_members WHERE email = ?")
      .bind(auth.access.email)
      .all<{ workspace_id: string; role: string }>();
    const roles: Record<string, "admin" | "member"> = {};
    for (const row of memberCtx.results) roles[row.workspace_id] = row.role as "admin" | "member";
    const body = await readBody(request);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body?.role === "admin" ? "admin" : "member";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ error: "Name the person's email address.", code: "email_required" }, 400);
    const isAdmin = auth.access.superAdmin || isWorkspaceAdmin(roles, id);
    if (!isAdmin)
      return json(
        { error: "Only a workspace admin can add people.", code: "workspace_admin_required" },
        403,
      );
    if (role === "admin" && !auth.access.superAdmin)
      return json(
        { error: "Only the Super Admin makes a workspace admin.", code: "super_admin_required" },
        403,
      );
    await deps.db
      .prepare(
        `INSERT INTO atlas_workspace_members (workspace_id, email, role, added_by, created_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(workspace_id, email) DO UPDATE SET role = excluded.role`,
      )
      .bind(id, email, role, auth.access.email, now())
      .run();
    return workspacesList(request);
  };

  /** The workflow draft and the steps it was built from live in the brain, so
   * one read gives a project its whole story. Both are contract-validated on
   * the way in: the server stores what the schema says. */
  const putContract = async (
    request: Request,
    projectId: string,
    key: "workflow" | "steps",
    parse: (input: unknown) => { ok: boolean; data?: unknown; problems?: string[] },
  ) => {
    if (!sameOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize("onboarding.triage", request);
    if (auth.error) return auth.error;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send a JSON body.", code: "bad_body" }, 400);
    }
    const parsed = parse(body);
    if (!parsed.ok)
      return json(
        { error: "The payload does not match its contract.", problems: parsed.problems ?? [] },
        400,
      );
    const found = await deps.db
      .prepare("SELECT data, revision, updated_at FROM atlas_onboarding WHERE project_id = ?")
      .bind(projectId)
      .first<{ data: string; revision: number }>();
    if (!found) return json({ error: "That project is not onboarding.", code: "not_found" }, 404);
    const data = JSON.parse(found.data) as Record<string, unknown>;
    const now = new Date().toISOString();
    const next = { ...data, [key]: parsed.data, revision: found.revision + 1, updatedAt: now };
    await deps.db
      .prepare(
        "UPDATE atlas_onboarding SET data = ?, revision = ?, updated_at = ? WHERE project_id = ?",
      )
      .bind(JSON.stringify(next), found.revision + 1, now, projectId)
      .run();
    return json({ revision: found.revision + 1, [key]: parsed.data }, 200);
  };
  const workflowPut = (request: Request, projectId: string) =>
    putContract(request, projectId, "workflow", parseWorkflow);
  const stepsPut = (request: Request, projectId: string) =>
    putContract(request, projectId, "steps", parseSteps);

  return {
    list,
    get,
    create,
    patch,
    gate,
    reuse,
    evidenceAdd,
    valueAdd,
    handoffCreate,
    compliance,
    rolesAssign,
    workspacesList,
    workspaceCreate,
    workspaceMemberAdd,
    workflowPut,
    stepsPut,
  };
}


/** How many sign-offs a project's quick lane still owes. */
function deferredCountOf(data: string) {
  try {
    const parsed = JSON.parse(data) as { deferredGates?: unknown[] };
    return Array.isArray(parsed.deferredGates) ? parsed.deferredGates.length : 0;
  } catch {
    return 0;
  }
}
/** What is being onboarded, read from the stored draft. */
function kindOf(data: string) {
  try {
    const parsed = JSON.parse(data) as { entryType?: string };
    return parsed.entryType ?? "project";
  } catch {
    return "project";
  }
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
    /** The text to inspect (an excerpt, a transcript, an extracted page).
     * Absent means "nothing to inspect", which is a review. */
    scanText: z.string().max(20_000).optional(),
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
