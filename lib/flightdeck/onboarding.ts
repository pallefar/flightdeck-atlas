import { z } from "zod";
import type { Project } from "../projects";
import { ONBOARDING_CHECKLIST, opportunities } from "../opportunities";
import { isoSchema, osIdSchema } from "./context";
// Atlas -> FlightDeck OS project onboarding (onboarding plan §3, §4.2, §4.6).
// Shared by the server route and the browser, so the review screen lists
// exactly what the server sends. Keep this module free of server-only
// imports: it must never reach the inbound credential.
//
// Sending files a PROPOSAL (kind "project-onboarding") for an OS admin to
// review. Nothing becomes OS data until that reviewer accepts it.

export const ONBOARDING_KIND = "project-onboarding" as const;
export const ONBOARDING_SCHEMA_ID = "atlas-project-onboarding/1" as const;
/** The OS envelope requires a summary; this kind's is fixed text, so no
 * free text travels outside the payload. */
export const ONBOARDING_SUMMARY = "Atlas project onboarding request" as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const slug = z.string().regex(SLUG_RE);
const txt = (n: number) => z.string().trim().min(1).max(n);
export const SUBMISSION_ID_RE = /^[0-9a-f]{24}$/;

// ISO 3166-1 alpha-2, officially assigned codes.
export const ISO_COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
const countryCodes = new Set(ISO_COUNTRY_CODES);
export const headcountBands = ["<50", "50-249", "250+", "unknown"] as const;
export const worksCouncilAnswers = ["yes", "no", "unknown"] as const;
export const accessLevels = ["read", "write", "admin"] as const;
export const setupStates = [
  "none",
  "awaiting-cowork",
  "result-landed",
  "complete",
] as const;
export const rejectionReasons = [
  "needs-more-info",
  "duplicate",
  "out-of-scope",
  "other",
] as const;
export type SetupState = (typeof setupStates)[number];
export type RejectionReason = (typeof rejectionReasons)[number];

/** The FlightDeck details saved on an Atlas project. Strict, so a draft can
 * never hold a sponsor, assignee or email: the owner fields are role titles,
 * and people are appointed in the OS from its own roster. */
export const onboardingSchema = z
  .object({
    /** The OS project id is permanent once created. */
    proposedProjectId: slug.optional(),
    countryCode: z
      .string()
      .refine((code) => countryCodes.has(code), "Choose a country.")
      .optional(),
    /** A fact for a human. It never starts or skips a step. */
    worksCouncilRelevant: z.enum(worksCouncilAnswers).optional(),
    legalEntity: z.string().trim().max(120).optional(),
    headcountBand: z.enum(headcountBands).optional(),
    ownerRoles: z
      .object({
        process: z.string().trim().max(80).optional(),
        data: z.string().trim().max(80).optional(),
        support: z.string().trim().max(80).optional(),
      })
      .strict()
      .optional(),
    dataSources: z.array(txt(80)).max(10).optional(),
    /** Shown to the OS reviewer as to-dos; access is never granted by this. */
    accessRequested: z
      .array(
        z.object({ system: txt(80), level: z.enum(accessLevels) }).strict(),
      )
      .max(10)
      .optional(),
    coworkRequested: z.boolean().optional(),
  })
  .strict();
export type OnboardingDraft = z.infer<typeof onboardingSchema>;

/** Plan §4.2, verbatim: the OS validates the same schema and answers 400
 * without echoing keys. Checked here first so an extra key is never sent. */
export const projectOnboardingPayloadSchema = z
  .object({
    schema: z.literal(ONBOARDING_SCHEMA_ID),
    idempotencyKey: z.string().uuid(),
    atlasProjectId: z.string().uuid(),
    atlasRevision: z.number().int().positive(),
    installationId: slug,
    /** sha256 of the Atlas user id, never a name or email. */
    requestedBy: z.string().regex(/^[a-f0-9]{64}$/),
    target: z
      .object({
        workspaceId: slug,
        label: txt(100),
        projectId: slug.optional(),
      })
      .strict(),
    profile: z
      .object({
        summary: z.string().max(1500),
        successMeasure: z.string().max(500),
        functionArea: txt(80),
        category: txt(60),
        status: z
          .enum(["In progress", "Planning", "On hold", "Completed"])
          .optional(),
        priority: z.enum(["High", "Normal", "Low"]).optional(),
        targetDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        site: z.string().max(100).optional(),
      })
      .strict(),
    facts: z
      .object({
        countryCode: z.string().regex(/^[A-Z]{2}$/),
        legalEntity: z.string().max(120).optional(),
        headcountBand: z.enum(headcountBands).optional(),
        worksCouncilRelevant: z.enum(worksCouncilAnswers),
        ownerRoles: z
          .object({
            process: txt(80).optional(),
            data: txt(80).optional(),
            support: txt(80).optional(),
          })
          .strict(),
        dataSources: z.array(txt(80)).max(10),
        accessRequested: z
          .array(
            z.object({ system: txt(80), level: z.enum(accessLevels) }).strict(),
          )
          .max(10),
      })
      .strict(),
    progress: z
      .object({
        done: z.number().int().min(0),
        total: z.number().int().min(0),
      })
      .strict()
      .nullable(),
    cowork: z.object({ requested: z.boolean() }).strict(),
  })
  .strict();
export type ProjectOnboardingPayload = z.infer<
  typeof projectOnboardingPayloadSchema
>;

export const onboardingSubject = (atlasProjectId: string) =>
  `atlas-${atlasProjectId}`;
export const onboardingEnvelopeSchema = z
  .object({
    kind: z.literal(ONBOARDING_KIND),
    subject: z.string().regex(SLUG_RE),
    summary: z.literal(ONBOARDING_SUMMARY),
    payload: projectOnboardingPayloadSchema,
  })
  .strict()
  .refine((e) => e.subject === onboardingSubject(e.payload.atlasProjectId));
export type OnboardingEnvelope = z.infer<typeof onboardingEnvelopeSchema>;
export const onboardingEnvelope = (
  payload: ProjectOnboardingPayload,
): OnboardingEnvelope => ({
  kind: ONBOARDING_KIND,
  subject: onboardingSubject(payload.atlasProjectId),
  summary: ONBOARDING_SUMMARY,
  payload,
});

export type PayloadProject = Pick<
  Project,
  | "id"
  | "revision"
  | "description"
  | "benefit"
  | "functionArea"
  | "category"
  | "status"
  | "priority"
  | "dueDate"
  | "location"
  | "flightdeckDraft"
  | "onboarding"
  | "tasks"
>;
const clean = (value?: string | null) => (value ?? "").trim();

/** Builds the payload field by field from the allowlist. Nothing is copied
 * wholesale, so a field Atlas adds later cannot leak into it. An unfinished
 * draft yields a payload that fails the strict schema; the caller checks. */
export function buildOnboardingPayload(input: {
  project: PayloadProject;
  destinationWorkspaceId: string;
  idempotencyKey: string;
  installationId: string;
  requestedBy: string;
}): ProjectOnboardingPayload {
  const p = input.project,
    o = p.onboarding ?? {};
  const active = p.tasks.filter((t) => !t.archived);
  const ownerRoles: ProjectOnboardingPayload["facts"]["ownerRoles"] = {};
  for (const role of ["process", "data", "support"] as const)
    if (clean(o.ownerRoles?.[role]))
      ownerRoles[role] = clean(o.ownerRoles?.[role]);
  return {
    schema: ONBOARDING_SCHEMA_ID,
    idempotencyKey: input.idempotencyKey,
    atlasProjectId: p.id,
    atlasRevision: p.revision,
    installationId: input.installationId,
    requestedBy: input.requestedBy,
    target: {
      workspaceId: input.destinationWorkspaceId,
      label: clean(p.flightdeckDraft?.label),
      ...(o.proposedProjectId ? { projectId: o.proposedProjectId } : {}),
    },
    profile: {
      summary: clean(p.description),
      successMeasure: clean(p.benefit),
      functionArea: clean(p.functionArea),
      category: clean(p.category),
      status: p.status,
      ...(p.priority ? { priority: p.priority } : {}),
      ...(p.dueDate ? { targetDate: p.dueDate } : {}),
      ...(clean(p.location) ? { site: clean(p.location) } : {}),
    },
    facts: {
      countryCode: o.countryCode ?? "",
      ...(clean(o.legalEntity) ? { legalEntity: clean(o.legalEntity) } : {}),
      ...(o.headcountBand ? { headcountBand: o.headcountBand } : {}),
      worksCouncilRelevant:
        o.worksCouncilRelevant as ProjectOnboardingPayload["facts"]["worksCouncilRelevant"],
      ownerRoles,
      dataSources: (o.dataSources ?? []).map(clean).filter(Boolean),
      accessRequested: (o.accessRequested ?? [])
        .map((a) => ({ system: clean(a.system), level: a.level }))
        .filter((a) => a.system),
    },
    // Counts only. Task titles, assignees and time entries stay in Atlas.
    progress: active.length
      ? { done: active.filter((t) => t.done).length, total: active.length }
      : null,
    cowork: { requested: !!o.coworkRequested },
  };
}

/** Sorted leaf paths of a payload: arrays and `progress` are leaves, empty
 * objects contribute nothing, undefined values are not sent. */
export function payloadLeafPaths(value: object, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      path !== "progress" &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    )
      paths.push(...payloadLeafPaths(child, path));
    else paths.push(path);
  }
  return prefix ? paths : paths.sort();
}

export type OnboardingTab = "basics" | "details" | "review";
/** Required items, in the order the meter lists them. */
export const READINESS_ITEMS = [
  {
    key: "label",
    label: "Proposed OS project name",
    tab: "basics",
    field: "fd-label",
  },
  {
    key: "destination",
    label: "Destination workspace",
    tab: "review",
    field: "fd-destination",
  },
  {
    key: "functionArea",
    label: "Function area",
    tab: "basics",
    field: "fd-function",
  },
  { key: "category", label: "Category", tab: "basics", field: "fd-category" },
  { key: "summary", label: "Summary", tab: "basics", field: "fd-summary" },
  {
    key: "successMeasure",
    label: "Success measure",
    tab: "basics",
    field: "fd-success",
  },
  { key: "countryCode", label: "Country", tab: "details", field: "fd-country" },
  {
    key: "worksCouncilRelevant",
    label: "Works council relevance",
    tab: "details",
    field: "fd-works-council",
  },
  {
    key: "ready",
    label: "Marked Ready for FlightDeck",
    tab: "details",
    field: "fd-ready",
  },
] as const satisfies readonly {
  key: string;
  label: string;
  tab: OnboardingTab;
  field: string;
}[];
export type ReadinessKey = (typeof READINESS_ITEMS)[number]["key"];
export function readiness(
  project: Pick<
    Project,
    | "flightdeckDraft"
    | "functionArea"
    | "category"
    | "description"
    | "benefit"
    | "onboarding"
    | "onboardingStage"
  >,
  destinationWorkspaceId: string | null,
) {
  const done: Record<ReadinessKey, boolean> = {
    label: !!clean(project.flightdeckDraft?.label),
    destination: !!destinationWorkspaceId,
    functionArea: !!clean(project.functionArea),
    category: !!clean(project.category),
    summary: !!clean(project.description),
    successMeasure: !!clean(project.benefit),
    countryCode: !!project.onboarding?.countryCode,
    worksCouncilRelevant: !!project.onboarding?.worksCouncilRelevant,
    ready: project.onboardingStage === "Ready for FlightDeck",
  };
  const items = READINESS_ITEMS.map((item) => ({
    ...item,
    done: done[item.key],
  }));
  const count = items.filter((i) => i.done).length;
  return {
    items,
    done: count,
    total: items.length,
    ready: count === items.length,
  };
}

/** Everything Atlas holds that never travels to FlightDeck (plan §3). */
export const NEVER_SENT = [
  "Sponsor",
  "Task assignees and their emails",
  "Any email address or person's name",
  "Time entries",
  "Goal owners",
  "Discussions, reviews and other collaboration",
  "Files",
  "Budget",
  "Task and checklist titles",
  "The preferred-workspace planning note",
];

export const REVIEW_FIELDS: {
  path: string;
  label: string;
  required?: boolean;
}[] = [
  { path: "target.label", label: "Proposed OS project name", required: true },
  {
    path: "target.workspaceId",
    label: "Destination workspace",
    required: true,
  },
  { path: "target.projectId", label: "Proposed OS project id" },
  { path: "profile.functionArea", label: "Function area", required: true },
  { path: "profile.category", label: "Category", required: true },
  { path: "profile.summary", label: "Summary", required: true },
  { path: "profile.successMeasure", label: "Success measure", required: true },
  { path: "profile.status", label: "Status" },
  { path: "profile.priority", label: "Priority" },
  { path: "profile.targetDate", label: "Target date" },
  { path: "profile.site", label: "Site" },
  { path: "facts.countryCode", label: "Country", required: true },
  {
    path: "facts.worksCouncilRelevant",
    label: "Works council relevant",
    required: true,
  },
  { path: "facts.legalEntity", label: "Legal entity" },
  { path: "facts.headcountBand", label: "Headcount band" },
  { path: "facts.ownerRoles.process", label: "Process owner (role title)" },
  { path: "facts.ownerRoles.data", label: "Data owner (role title)" },
  { path: "facts.ownerRoles.support", label: "Support owner (role title)" },
  { path: "facts.dataSources", label: "Data sources" },
  { path: "facts.accessRequested", label: "Access requested" },
  { path: "progress", label: "Progress" },
  { path: "cowork.requested", label: "Cowork setup requested" },
  { path: "atlasProjectId", label: "Atlas project id" },
  { path: "atlasRevision", label: "Atlas revision" },
  { path: "installationId", label: "Atlas installation" },
  { path: "requestedBy", label: "Requested by" },
  { path: "idempotencyKey", label: "Request key" },
  { path: "schema", label: "Format" },
];
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      value,
    );
export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}
/** One row per field the payload carries (plus required fields still
 * missing), in plain words. `preview` describes the three values the server
 * fills in when Send is pressed instead of showing placeholders. */
export function reviewRows(
  payload: ProjectOnboardingPayload,
  { preview = true }: { preview?: boolean } = {},
) {
  const rows: {
    path: string;
    label: string;
    value: string;
    missing: boolean;
  }[] = [];
  for (const field of REVIEW_FIELDS) {
    const value = at(payload, field.path);
    const empty =
      value === undefined ||
      value === "" ||
      (value === null && field.path !== "progress");
    if (empty && !field.required) continue;
    let shown: string;
    if (empty) shown = "Missing";
    else if (field.path === "requestedBy")
      shown = "A one-way hash of your Atlas user id (no name or email)";
    else if (field.path === "idempotencyKey" && preview)
      shown = "Assigned when you press Send; a retry reuses it";
    else if (field.path === "installationId" && preview)
      shown = "This Atlas installation";
    else if (field.path === "progress")
      shown = value
        ? `${(value as { done: number }).done} of ${(value as { total: number }).total} tasks done`
        : "Progress not tracked";
    else if (field.path === "facts.countryCode")
      shown = `${countryName(String(value))} (${value})`;
    else if (field.path === "facts.accessRequested")
      shown = (value as { system: string; level: string }[]).length
        ? (value as { system: string; level: string }[])
            .map((a) => `${a.system} (${a.level})`)
            .join(", ")
        : "None";
    else if (Array.isArray(value))
      shown = value.length ? value.join(", ") : "None";
    else if (typeof value === "boolean") shown = value ? "Yes" : "No";
    else shown = String(value);
    rows.push({
      path: field.path,
      label: field.label,
      value: shown,
      missing: empty,
    });
  }
  return rows;
}

/** A nudge, not a filter: free text may still hold personal data. */
export function personalDataHint(text: string) {
  if (text.includes("@"))
    return "This looks like it contains an email address. Send facts and role titles, not personal details.";
  for (const match of text.matchAll(/\+?\(?\d[\d\s().\/-]{6,}\d/g))
    if (match[0].replace(/\D/g, "").length >= 9)
      return "This looks like it contains a phone number. Send facts and role titles, not personal details.";
  return null;
}

export type SuggestionField =
  | "functionArea"
  | "summary"
  | "successMeasure"
  | "ownerRoles.process"
  | "ownerRoles.data"
  | "ownerRoles.support";
/** One-click prefill from the pilot checklist (lib/opportunities.ts). Only
 * empty fields are offered; the value is a role title or the pilot's own
 * text, never the checklist title (shown as the reason, not sent). */
export function checklistSuggestions(
  project: Pick<
    Project,
    "tasks" | "functionArea" | "description" | "benefit" | "onboarding"
  >,
) {
  const titles = new Set(project.tasks.map((t) => t.title));
  const out: { field: SuggestionField; value: string; source: string }[] = [];
  const idea = opportunities.find((o) => titles.has(o.discovery));
  if (idea) {
    if (!clean(project.functionArea))
      out.push({
        field: "functionArea",
        value: idea.area,
        source: idea.discovery,
      });
    if (!clean(project.description))
      out.push({ field: "summary", value: idea.pilot, source: idea.discovery });
    if (!clean(project.benefit) && titles.has(ONBOARDING_CHECKLIST.outcome))
      out.push({
        field: "successMeasure",
        value: idea.measure,
        source: ONBOARDING_CHECKLIST.outcome,
      });
  }
  const roles = project.onboarding?.ownerRoles;
  for (const [role, title, value] of [
    ["process", ONBOARDING_CHECKLIST.owners, "Process owner"],
    ["data", ONBOARDING_CHECKLIST.data, "Data owner"],
    ["support", ONBOARDING_CHECKLIST.support, "Support owner"],
  ] as const)
    if (titles.has(title) && !clean(roles?.[role]))
      out.push({ field: `ownerRoles.${role}`, value, source: title });
  return out;
}

// ── OS wire DTOs for the kind (plan §4.3, §4.6) ────────────────────────────
// Parsed in strip mode: Atlas stores only the fields named here, so an extra
// field (for example a reviewer's name, which §8b decision 9 forbids) is
// dropped and never stored or shown.
const submissionIdSchema = z.string().regex(SUBMISSION_ID_RE);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const osSubmitAcceptedSchema = z.object({
  submissionId: submissionIdSchema,
  state: z.literal("filed"),
  receivedAt: isoSchema,
  payloadSha256: sha256Schema,
});
export const osSubmitDuplicateSchema = z.object({
  submissionId: submissionIdSchema,
  duplicate: z.literal(true),
  receivedAt: isoSchema.optional(),
  payloadSha256: sha256Schema.optional(),
});
export const osAlreadySubmittedSchema = z.object({
  code: z.literal("already_submitted"),
  submissionId: submissionIdSchema.optional(),
  state: z.string().max(40).optional(),
});
const osPromotedSchema = z.object({
  workspaceId: osIdSchema,
  projectId: osIdSchema,
  setupState: z.enum(setupStates),
});
const osRejectedSchema = z.object({ reasonCode: z.enum(rejectionReasons) });
const osSubmissionStatusSchema = z.object({
  submissionId: submissionIdSchema,
  kind: z.string().max(64),
  subject: z.string().max(64),
  receivedAt: isoSchema,
  payloadSha256: z.union([sha256Schema, z.literal("")]),
  state: z.enum(["filed", "promoted", "rejected", "promoted-or-withdrawn"]),
  outcome: z.unknown().optional(),
});
export type OsSubmissionStatus = {
  submissionId: string;
  kind: string;
  subject: string;
  receivedAt: string;
  payloadSha256: string | null;
  state: z.infer<typeof osSubmissionStatusSchema>["state"];
  /** Only when promoted AND the destination is in readWorkspaces. */
  promoted: z.infer<typeof osPromotedSchema> | null;
  reasonCode: RejectionReason | null;
};
export function parseSubmissionStatus(
  body: unknown,
): OsSubmissionStatus | null {
  const parsed = osSubmissionStatusSchema.safeParse(body);
  if (!parsed.success) return null;
  const s = parsed.data;
  const promoted =
    s.state === "promoted" ? osPromotedSchema.safeParse(s.outcome) : null;
  const rejected =
    s.state === "rejected" ? osRejectedSchema.safeParse(s.outcome) : null;
  return {
    submissionId: s.submissionId,
    kind: s.kind,
    subject: s.subject,
    receivedAt: s.receivedAt,
    payloadSha256: s.payloadSha256 || null,
    state: s.state,
    promoted: promoted?.success ? promoted.data : null,
    reasonCode: rejected
      ? rejected.success
        ? rejected.data.reasonCode
        : "other"
      : null,
  };
}

// ── What Atlas's own route returns to the browser ──────────────────────────
export const operationStates = [
  "reserved",
  "filed",
  "promoted",
  "linked",
  "rejected",
  "refused",
] as const;
export type OperationState = (typeof operationStates)[number];
export const onboardingStages = [
  "not-confirmed",
  "submitted",
  "linked",
  "setup-in-progress",
  "setup-complete",
  "needs-more-info",
  "rejected",
  "not-sent",
] as const;
export type OnboardingStage = (typeof onboardingStages)[number];
export function stageFor(op: {
  state: OperationState;
  reasonCode: string | null;
  setupState: string | null;
}): OnboardingStage {
  switch (op.state) {
    case "reserved":
      return "not-confirmed";
    case "filed":
    case "promoted":
      return "submitted";
    case "linked":
      return op.setupState === "complete"
        ? "setup-complete"
        : op.setupState === "awaiting-cowork" ||
            op.setupState === "result-landed"
          ? "setup-in-progress"
          : "linked";
    case "rejected":
      return op.reasonCode === "needs-more-info"
        ? "needs-more-info"
        : "rejected";
    case "refused":
      return "not-sent";
  }
}
export const TIMELINE = [
  { stage: "submitted", label: "Submitted" },
  { stage: "linked", label: "Linked" },
  { stage: "setup-in-progress", label: "Setup in progress" },
  { stage: "setup-complete", label: "Setup complete" },
] as const;
export const onboardingStatusSchema = z
  .object({
    operation: z
      .object({
        state: z.enum(operationStates),
        stage: z.enum(onboardingStages),
        /** Shown to the Super Admin only. */
        destinationWorkspaceId: osIdSchema.nullable(),
        submittedAt: isoSchema.nullable(),
        reasonCode: z.string().max(40).nullable(),
        setupState: z.enum(setupStates).nullable(),
        atlasRevision: z.number().int().positive(),
        updatedAt: isoSchema,
        checkedAt: isoSchema.nullable(),
      })
      .strict()
      .nullable(),
    /** A confirmed link; Super Admin only. */
    link: z
      .object({
        workspaceId: osIdSchema,
        osProjectId: osIdSchema,
        linkedAt: isoSchema,
        accessState: z.enum(["active", "disabled"]),
      })
      .strict()
      .nullable(),
    /** No open request: a (new) send is possible. */
    canSend: z.boolean(),
    /** The last send was not confirmed; a retry reuses its key. */
    retryPending: z.boolean(),
    /** FlightDeck may still change this status. */
    pollable: z.boolean(),
    notice: z.string().max(300).nullable(),
    retryAfter: z.number().int().positive().nullable(),
  })
  .strict();
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;
export const onboardErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  retryAfter: z.number().int().positive().nullable().optional(),
  missing: z.array(z.string()).optional(),
  status: onboardingStatusSchema.optional(),
});
export const onboardStagesSchema = z.object({
  stages: z.record(z.enum(onboardingStages)),
});
