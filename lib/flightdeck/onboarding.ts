import { z } from "zod";
import type { Project } from "../projects";
import { ONBOARDING_CHECKLIST, opportunities } from "../opportunities";
import { isoSchema, osIdSchema } from "./context";
import { t, type Locale } from "../i18n";
import {
  gatedFields,
  type GatedPayload,
  type InboundFeatures,
} from "./features";
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

/** An RFC 9562 UUID (version 1-8, variant 10xx), lower case. Not
 * `z.string().uuid()`: the OS validates with zod 4, whose uuid demands the
 * version and variant, while Atlas's zod 3 accepts any 8-4-4-4-12 hex. A
 * value in between would pass here and be refused 400 by the OS. Lower case
 * only, so `subject` equals the OS's lower-cased `atlas-<id>`.
 * `crypto.randomUUID()` always matches. */
const RFC_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Plan §4.2, verbatim: the OS validates the same schema and answers 400
 * without echoing keys. Checked here first so an extra key is never sent. */
export const projectOnboardingPayloadSchema = z
  .object({
    schema: z.literal(ONBOARDING_SCHEMA_ID),
    idempotencyKey: z.string().regex(RFC_UUID_RE),
    atlasProjectId: z.string().regex(RFC_UUID_RE),
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
 * draft yields a payload that fails the strict schema; the caller checks.
 *
 * `gated` fields travel only when `features` (this credential's whoami
 * flags, read just before the send) has their flag true: the OS refuses a
 * field whose feature is off. No features read means none of them. */
export function buildOnboardingPayload(input: {
  project: PayloadProject;
  destinationWorkspaceId: string;
  idempotencyKey: string;
  installationId: string;
  requestedBy: string;
  features?: InboundFeatures;
  gated?: GatedPayload;
}): ProjectOnboardingPayload & GatedPayload {
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
    ...gatedFields(input.gated, input.features),
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
/** Who completes a requirement. The destination workspace is the Super
 * Admin's: editors never see the workspace list (plan 2026-09-25 §7). */
export type RequirementActor = "requester" | "superAdmin";
export type ReadinessProject = Pick<
  Project,
  | "flightdeckDraft"
  | "functionArea"
  | "category"
  | "description"
  | "benefit"
  | "onboarding"
  | "onboardingStage"
>;
export type Requirement = {
  id: string;
  actor: RequirementActor;
  /** Optional items are listed but never counted in 'n of N'. */
  optional: boolean;
  label: string;
  tab: OnboardingTab;
  field: string;
  check: (project: ReadinessProject, dest: string | null) => boolean;
};
/** The one requirement definition, in the order the meter lists it. Every
 * count (the full Send gate and each actor's 'n of N for you') derives from
 * it. AI agents and Apps are selections, never requirements. */
export const REQUIREMENTS = [
  {
    id: "label",
    actor: "requester",
    optional: false,
    label: "Proposed OS project name",
    tab: "basics",
    field: "fd-label",
    check: (p) => !!clean(p.flightdeckDraft?.label),
  },
  {
    id: "destination",
    actor: "superAdmin",
    optional: false,
    label: "Destination workspace",
    tab: "review",
    field: "fd-destination",
    check: (_p, dest) => !!dest,
  },
  {
    id: "functionArea",
    actor: "requester",
    optional: false,
    label: "Function area",
    tab: "basics",
    field: "fd-function",
    check: (p) => !!clean(p.functionArea),
  },
  {
    id: "category",
    actor: "requester",
    optional: false,
    label: "Category",
    tab: "basics",
    field: "fd-category",
    check: (p) => !!clean(p.category),
  },
  {
    id: "summary",
    actor: "requester",
    optional: false,
    label: "Summary",
    tab: "basics",
    field: "fd-summary",
    check: (p) => !!clean(p.description),
  },
  {
    id: "successMeasure",
    actor: "requester",
    optional: false,
    label: "Success measure",
    tab: "basics",
    field: "fd-success",
    check: (p) => !!clean(p.benefit),
  },
  {
    id: "countryCode",
    actor: "requester",
    optional: false,
    label: "Country",
    tab: "details",
    field: "fd-country",
    check: (p) => !!p.onboarding?.countryCode,
  },
  {
    id: "worksCouncilRelevant",
    actor: "requester",
    optional: false,
    label: "Works council relevance",
    tab: "details",
    field: "fd-works-council",
    check: (p) => !!p.onboarding?.worksCouncilRelevant,
  },
  {
    id: "ready",
    actor: "requester",
    optional: false,
    label: "Marked Ready for FlightDeck",
    tab: "details",
    field: "fd-ready",
    check: (p) => p.onboardingStage === "Ready for FlightDeck",
  },
] as const satisfies readonly Requirement[];
export type ReadinessKey = (typeof REQUIREMENTS)[number]["id"];
/** Required items as the meter lists them, derived from REQUIREMENTS. */
export const READINESS_ITEMS = REQUIREMENTS.map(
  ({ id, label, tab, field }) => ({ key: id, label, tab, field }),
);

function tally<R extends Requirement>(
  requirements: readonly R[],
  project: ReadinessProject,
  destinationWorkspaceId: string | null,
) {
  const items = requirements
    .filter((r) => !r.optional)
    .map(({ id, label, tab, field, check }) => ({
      key: id as R["id"],
      label,
      tab,
      field,
      done: check(project, destinationWorkspaceId),
    }));
  const count = items.filter((i) => i.done).length;
  return {
    items,
    done: count,
    total: items.length,
    ready: count === items.length,
  };
}

/** Every requirement, whoever owns it. Send is gated on `ready` here. */
export function readiness(
  project: ReadinessProject,
  destinationWorkspaceId: string | null,
) {
  return tally(REQUIREMENTS, project, destinationWorkspaceId);
}

/** Only the viewing actor's non-optional items: 'n of N for you'. The
 * `requirements` parameter exists so a new item needs no UI edit (and for
 * tests); callers use the default. */
export function readinessFor(
  project: ReadinessProject,
  destinationWorkspaceId: string | null,
  actor: RequirementActor,
  requirements: readonly Requirement[] = REQUIREMENTS,
) {
  return tally(
    requirements.filter((r) => r.actor === actor),
    project,
    destinationWorkspaceId,
  );
}

/** Everything Atlas holds that never travels to FlightDeck (plan §3). Only
 * what Atlas can keep: it cannot promise that text someone typed holds no
 * name (see FREE_TEXT_NOTE). */
export const NEVER_SENT = [
  "Sponsor",
  "Task assignees and their emails",
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
/** What a reviewer's read-back may point at (plan 2026-09-25 §7, D-037
 * item 5): the payload fields a requester can change. Technical ids, the
 * key, the requester hash and the format are never pointed at. A pointer
 * outside this list is dropped on read. */
export const FIELD_POINTERS = [
  "target.label",
  "target.workspaceId",
  "target.projectId",
  "profile.functionArea",
  "profile.category",
  "profile.summary",
  "profile.successMeasure",
  "profile.status",
  "profile.priority",
  "profile.targetDate",
  "profile.site",
  "facts.countryCode",
  "facts.worksCouncilRelevant",
  "facts.legalEntity",
  "facts.headcountBand",
  "facts.ownerRoles.process",
  "facts.ownerRoles.data",
  "facts.ownerRoles.support",
  "facts.dataSources",
  "facts.accessRequested",
  "progress",
  "cowork.requested",
] as const;
export type FieldPointer = (typeof FIELD_POINTERS)[number];
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

/** Decision 6 (retention and cross-border handling) is open with Legal and
 * no agent can answer it. Stated where the Super Admin authorises the send,
 * as an open question: no legal position is taken either way. */
export const LEGAL_OPEN_NOTE =
  "Legal has not answered owner decision 6 yet: how long FlightDeck may keep the Summary and Success measure, or how that free text may be handled across borders. Until Legal answers, FlightDeck keeps what it receives and nothing is deleted automatically. Sending does not answer this question.";
/** What the review says under "Never sent" about the free text. */
export const FREE_TEXT_NOTE =
  "Summary and Success measure are sent as you wrote them, including any name or email address typed there. Atlas refuses an email address or phone number in every other field, but it cannot recognise a person's name.";

/** A phone number, not any long run of digits. The two callers ask different
 * questions because the cost of being wrong is not the same. The free text is
 * only warned about, so it casts wide: nine digits anywhere in a run of phone
 * punctuation. A strict field is refused outright, with no override, so it
 * asks for a shape only a phone number has — seven digits running together,
 * or an international `+` prefix — and never adds up digits across separate
 * groups. Otherwise a role title with a plant number and a year range ("Head
 * of Quality, Plant 4 (2024-2026)"), an ERP version ("SAP ECC 6.0 / S4
 * 2021-2024") or a cost centre ("100-200-300-400") could not be sent at all,
 * and the refusal would name a phone number that is not there — while owner
 * decision 4 asks for exactly those titles in place of a person's name. A
 * value that is itself nine digits in a row (a bare VAT or entity number)
 * still reads as a phone number; grouping it sends it. */
const personalShape = (
  text: string,
  strict = false,
): "email" | "phone" | null => {
  if (text.includes("@")) return "email";
  for (const match of text.matchAll(/\+?\(?\d[\d\s().\/-]{6,}\d/g)) {
    if (match[0].replace(/\D/g, "").length < 9) continue;
    if (!strict) return "phone";
    const runs = match[0].match(/\d+/g) ?? [];
    if (match[0].startsWith("+") || runs.some((run) => run.length >= 7))
      return "phone";
  }
  return null;
};
/** A hint under a field. Free text (summary, success measure) is only
 * warned about: the owner chose to send it (decision 5). Every other field
 * is `strict`: the server refuses an email or phone-number shape there. */
export function personalDataHint(text: string, strict = false) {
  const shape = personalShape(text, strict);
  if (!shape) return null;
  if (strict)
    return "Atlas will not send an email address or phone number here. Use a role title or a system name.";
  return shape === "email"
    ? "This looks like it contains an email address. It is sent as written: send facts and role titles, not personal details."
    : "This looks like it contains a phone number. It is sent as written: send facts and role titles, not personal details.";
}

/** Free text the owner allowed to travel (decision 5): warned, not refused. */
export const FREE_TEXT_FIELDS = ["profile.summary", "profile.successMeasure"];
/** Every other text field. §3 classes them as not personal, so an email or
 * phone-number shape there is refused before anything is reserved or sent.
 * In review order. */
export const STRICT_TEXT_FIELDS = [
  "target.label",
  "profile.functionArea",
  "profile.category",
  "profile.site",
  "facts.legalEntity",
  "facts.ownerRoles.process",
  "facts.ownerRoles.data",
  "facts.ownerRoles.support",
  "facts.dataSources",
  "facts.accessRequested",
];
const textsAt = (payload: ProjectOnboardingPayload, path: string) => {
  const value = at(payload, path);
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.map((v) =>
    typeof v === "string" ? v : String((v as { system?: string }).system ?? ""),
  );
};
/** Review paths whose text looks like an email address or phone number. The
 * route refuses `refused`; the form warns about `warned`. Never the values. */
export function personalDataIn(payload: ProjectOnboardingPayload) {
  const hit = (paths: string[], strict: boolean) =>
    paths.filter((path) =>
      textsAt(payload, path).some((text) => personalShape(text, strict)),
    );
  return {
    refused: hit(STRICT_TEXT_FIELDS, true),
    warned: hit(FREE_TEXT_FIELDS, false),
  };
}
export const fieldLabel = (path: string) =>
  REVIEW_FIELDS.find((f) => f.path === path)?.label ?? path;

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
/** The OS's other two 409s (OS server/routes/inbound.ts). Neither says
 * whether this request was filed; each has its own remedy. */
export const osSubmitConflictSchema = z.object({
  code: z.enum(["lock_unreadable", "idempotency_key_conflict"]),
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
  // Read leniently below: a cause word this Atlas does not know yet must not
  // fail the whole read-back.
  outcomeWithheld: z.unknown().optional(),
  // Optional read-back fields a newer OS may add (reviewer note, lineage,
  // decision time). Each is read on its own below, so an older OS, or a
  // malformed value, never fails the read-back: the value is just absent.
  note: z.unknown().optional(),
  fields: z.unknown().optional(),
  supersedes: z.unknown().optional(),
  supersededBy: z.unknown().optional(),
  decidedAt: z.unknown().optional(),
});
/** A reviewer note is bounded plain text (D-037 item 5: at most 500
 * characters). Typed only: it is never rendered from here, and never
 * logged. */
const reviewerNoteSchema = z.string().min(1).max(500);
const FIELD_POINTER_SET: ReadonlySet<string> = new Set(FIELD_POINTERS);
/** Why the OS answered `promoted` without an outcome: Atlas's credential
 * lacks read:context (`scope`: re-mint it), or the destination is not in
 * readWorkspaces (`workspace-not-shared`: share it). */
export const outcomeWithheldCauses = ["scope", "workspace-not-shared"] as const;
export type OutcomeWithheld = (typeof outcomeWithheldCauses)[number];
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
  /** Only when promoted without an outcome, and the OS said why. Null from
   * an OS that predates the field, or for a cause Atlas does not know. */
  outcomeWithheld: OutcomeWithheld | null;
  // Present only when a newer OS sent a well-formed value; an older OS's
  // read-back has none of them.
  /** The reviewer's bounded plain-text note. */
  note?: string;
  /** The payload fields the reviewer pointed at, allowlisted. */
  fields?: FieldPointer[];
  /** The submission this one replaces. */
  supersedes?: string;
  /** The submission that replaced this one. */
  supersededBy?: string;
  /** When a human decided. */
  decidedAt?: string;
};
export type ParseSubmissionOptions = {
  /** Receives how many field pointers were dropped as unknown: a count,
   * never the values. Defaults to a console warning. */
  onUnknownFieldPointers?: (count: number) => void;
};
function readBackOptionals(
  top: Record<string, unknown>,
  outcome: unknown,
  options: ParseSubmissionOptions,
): Partial<OsSubmissionStatus> {
  // The note and its pointers belong to the decision, so they may come at
  // the top level or with the outcome; the top level wins.
  const inOutcome =
    outcome && typeof outcome === "object" && !Array.isArray(outcome)
      ? (outcome as Record<string, unknown>)
      : {};
  const pick = (key: string) => top[key] ?? inOutcome[key];
  const out: Partial<OsSubmissionStatus> = {};
  const note = reviewerNoteSchema.safeParse(pick("note"));
  if (note.success) out.note = note.data;
  const raw = pick("fields");
  if (Array.isArray(raw)) {
    const known = new Set<FieldPointer>();
    let unknown = 0;
    for (const value of raw)
      if (typeof value === "string" && FIELD_POINTER_SET.has(value))
        known.add(value as FieldPointer);
      else unknown++;
    if (unknown) {
      const report =
        options.onUnknownFieldPointers ??
        ((count: number) =>
          console.warn(
            `FlightDeck read-back: dropped ${count} unknown field pointer(s)`,
          ));
      report(unknown);
    }
    out.fields = [...known];
  }
  for (const key of ["supersedes", "supersededBy"] as const) {
    const id = submissionIdSchema.safeParse(top[key]);
    if (id.success) out[key] = id.data;
  }
  const decidedAt = isoSchema.safeParse(top.decidedAt);
  if (decidedAt.success) out.decidedAt = decidedAt.data;
  return out;
}
export function parseSubmissionStatus(
  body: unknown,
  options: ParseSubmissionOptions = {},
): OsSubmissionStatus | null {
  const parsed = osSubmissionStatusSchema.safeParse(body);
  if (!parsed.success) return null;
  const s = parsed.data;
  const promoted =
    s.state === "promoted" ? osPromotedSchema.safeParse(s.outcome) : null;
  const rejected =
    s.state === "rejected" ? osRejectedSchema.safeParse(s.outcome) : null;
  const withheld =
    s.state === "promoted" && !promoted?.success
      ? z.enum(outcomeWithheldCauses).safeParse(s.outcomeWithheld)
      : null;
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
    outcomeWithheld: withheld?.success ? withheld.data : null,
    ...readBackOptionals(s, s.outcome, options),
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
  "closed",
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
      // Closed by the Atlas Super Admin before FlightDeck confirmed it:
      // FlightDeck may still hold it, so it is not "Not sent".
      return op.reasonCode === "abandoned" ? "closed" : "not-sent";
  }
}
/** The operation states in which FlightDeck may hold this request, so the
 * draft must stay exactly as it was sent: the form locks itself, and nothing
 * outside the form (the list row's own buttons) may edit or drop it either. */
export const lockedStates = [
  "reserved",
  "filed",
  "promoted",
  "linked",
] as const satisfies readonly OperationState[];
export const isLockedState = (state: OperationState) =>
  (lockedStates as readonly OperationState[]).includes(state);
/** Every stage a locked state can show. Derived from stageFor(), not typed
 * out a second time: the form knows the operation state and the row knows
 * only the stage, and the two surfaces must never disagree about what is
 * locked. Locked states never branch on reasonCode, but it is varied here
 * too so a later branch cannot slip past. */
export const lockedStages: readonly OnboardingStage[] = [
  ...new Set(
    lockedStates.flatMap((state) =>
      [null, ...setupStates].flatMap((setupState) =>
        [null, ...rejectionReasons, "abandoned"].map((reasonCode) =>
          stageFor({ state, reasonCode, setupState }),
        ),
      ),
    ),
  ),
];
export const isDraftLocked = (stage: OnboardingStage | null | undefined) =>
  !!stage && lockedStages.includes(stage);
/** Whether a project save changes the onboarding draft itself: its
 * FlightDeck label and hint, or its onboarding details. These are what the
 * lock holds on the server (DRAFT_NOT_HELD_SQL); the rest of the project
 * (its board status, tasks, stage) keeps moving while FlightDeck holds the
 * draft, and later edits there are simply not sent. Compared as parsed, with
 * keys sorted, so a save that sends the draft back unchanged never counts. */
export function draftEdited(
  previous: Pick<Project, "flightdeckDraft" | "onboarding">,
  next: Pick<Project, "flightdeckDraft" | "onboarding">,
) {
  const canon = (value: unknown) =>
    JSON.stringify(value ?? null, (_, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          )
        : v,
    );
  const onboarding = (p: Pick<Project, "onboarding">) => {
    const parsed = onboardingSchema.safeParse(p.onboarding ?? {});
    return parsed.success ? parsed.data : p.onboarding;
  };
  return (
    canon(previous.flightdeckDraft) !== canon(next.flightdeckDraft) ||
    canon(onboarding(previous)) !== canon(onboarding(next))
  );
}
/** Why the draft is locked, one sentence per locked stage: the row's tooltip
 * and the form's banner say the same thing, and "FlightDeck is reviewing it"
 * is never claimed of a project FlightDeck has already created. */
export const LOCK_NOTE: Partial<Record<OnboardingStage, string>> = {
  "not-confirmed":
    "FlightDeck has not confirmed this send yet. Retry or close it before the draft can change.",
  submitted:
    "FlightDeck is reviewing this request. The draft stays as it was sent until FlightDeck answers.",
  linked: "FlightDeck holds this project. The draft stays as it was sent.",
  "setup-in-progress":
    "FlightDeck holds this project. The draft stays as it was sent.",
  "setup-complete":
    "This project is linked to a FlightDeck project. The draft stays as it was sent.",
};
export const lockNote = (stage: OnboardingStage | null | undefined) =>
  (stage && LOCK_NOTE[stage]) || "";
/** Export draft's text. What it says about FlightDeck follows the send, if
 * there is one: a draft FlightDeck holds is never called "not submitted",
 * and where it went is the destination it was sent to, not the owner's
 * planning note. `sent` is the project's stored send (its stage, and the
 * destination and revision Atlas recorded; both are null for a request
 * Atlas adopted), or null when it has none. */
export function exportDraftText(
  project: Pick<
    Project,
    | "id"
    | "name"
    | "description"
    | "functionArea"
    | "category"
    | "sponsor"
    | "benefit"
    | "flightdeckDraft"
  >,
  sent: {
    stage: OnboardingStage;
    destinationWorkspaceId: string | null;
    atlasRevision: number | null;
  } | null,
) {
  const stage = sent?.stage ?? null;
  const filed = !!stage && stage !== "not-sent" && stage !== "closed";
  const revision = sent?.atlasRevision ? `revision ${sent.atlasRevision}` : "";
  const where = sent?.destinationWorkspaceId
    ? `workspace ${sent.destinationWorkspaceId}`
    : "";
  const which = [revision, where].filter(Boolean).join(", ");
  const record = `Sent to FlightDeck${which ? ` (${which})` : ""}`;
  const closing: Record<OnboardingStage | "none", string> = {
    none: "Prepared in Atlas. Not submitted to FlightDeck. Workspace access and final project details must be reviewed before creation.",
    "not-sent":
      "Prepared in Atlas. FlightDeck refused the last send, so nothing was filed. Workspace access and final project details must be reviewed before creation.",
    closed:
      "Prepared in Atlas. The last send was closed before FlightDeck confirmed it; if FlightDeck did file it, the next send follows that request. Workspace access and final project details must be reviewed before creation.",
    "not-confirmed": `${record}, not yet confirmed by FlightDeck. FlightDeck's record is what counts; later edits in Atlas are not sent.`,
    submitted: `${record} and under review there. FlightDeck's record is what counts; later edits in Atlas are not sent.`,
    linked: `${record} and linked to a FlightDeck project. FlightDeck's record is what counts; later edits in Atlas are not sent.`,
    "setup-in-progress": `${record} and linked to a FlightDeck project, which is being set up. FlightDeck's record is what counts; later edits in Atlas are not sent.`,
    "setup-complete": `${record} and linked to a FlightDeck project, which is set up. FlightDeck's record is what counts; later edits in Atlas are not sent.`,
    "needs-more-info": `${record}. FlightDeck asked for more information; this draft is open again to update and send again.`,
    rejected: `${record}. FlightDeck declined it; this draft is open again.`,
  };
  const draft = project.flightdeckDraft;
  return [
    `# FlightDeck onboarding draft: ${draft?.label ?? ""}`,
    `Atlas project: ${project.name}`,
    `Atlas ID: ${project.id}`,
    filed && sent?.destinationWorkspaceId
      ? `Sent to workspace: ${sent.destinationWorkspaceId}`
      : `Preferred workspace: ${draft?.workspaceHint || (filed ? "Not recorded in Atlas" : "To select")}`,
    `Description: ${project.description}`,
    `Function: ${project.functionArea || project.category}`,
    `Sponsor: ${project.sponsor || "To confirm"}`,
    `Success measure: ${project.benefit || "To define"}`,
    "",
    closing[stage ?? "none"],
  ].join("\n\n");
}
/** The dashboard card's line for the stored stage of every visible project.
 * "Sent" is every request FlightDeck filed, answered ones included: a
 * declined or needs-more-info project shows "Submitted" done on its own
 * timeline, so the card must not call it unsent. */
export function onboardingSummaryLine(
  stages: readonly OnboardingStage[],
  locale: Locale = "en",
) {
  if (!stages.length) return t("onb.summary.none", locale);
  const count = (...list: OnboardingStage[]) =>
    stages.filter((stage) => list.includes(stage)).length;
  const linked = count("linked", "setup-in-progress", "setup-complete");
  const moreInfo = count("needs-more-info");
  const declined = count("rejected");
  const sent = count("submitted") + linked + moreInfo + declined;
  const extra = [
    [moreInfo, "onb.summary.moreInfo"],
    [declined, "onb.summary.declined"],
    [count("not-confirmed"), "onb.summary.awaiting"],
    [count("not-sent"), "onb.summary.notSent"],
    [count("closed"), "onb.summary.closed"],
  ] as const;
  return t("onb.summary.line", locale, {
    parts: [
      t("onb.summary.sent", locale, { n: sent }),
      t("onb.summary.linked", locale, { n: linked }),
      ...extra.filter(([n]) => n).map(([n, key]) => t(key, locale, { n })),
    ].join(", "),
  });
}
/** Stages Atlas still reads back from FlightDeck (the server's own pollable
 * set, as stages): the status can change with nobody here doing anything, so
 * these are the ones that say when Atlas last checked. Every one of them is
 * locked; being locked does not make a status move. */
export const movingStages: readonly OnboardingStage[] = [
  "submitted",
  "linked",
  "setup-in-progress",
];
export const isStatusMoving = (stage: OnboardingStage | null | undefined) =>
  !!stage && movingStages.includes(stage);
export const TIMELINE = [
  { stage: "submitted", label: "Submitted" },
  { stage: "linked", label: "Linked" },
  { stage: "setup-in-progress", label: "Setup in progress" },
  { stage: "setup-complete", label: "Setup complete" },
] as const;
export type TimelineStep = {
  stage: OnboardingStage;
  state: "done" | "current" | "upcoming";
};
/** The status timeline for a stage. Every stage is on it as the current
 * step, so no status ever shows an empty timeline. The four happy-path steps
 * are the frame; the other five stages take the place where they happened:
 * an unconfirmed send stands where "Submitted" would, an answer (needs more
 * info, declined) follows a done "Submitted" and ends the line, and a send
 * refused before filing or closed unconfirmed stands alone, never claiming a
 * filing that FlightDeck did not confirm. */
export function timelineSteps(stage: OnboardingStage): TimelineStep[] {
  const frame = TIMELINE.map((step) => step.stage as OnboardingStage);
  const at = frame.indexOf(stage);
  if (at >= 0)
    return frame.map((s, i) => ({
      stage: s,
      state: i < at ? "done" : i === at ? "current" : "upcoming",
    }));
  switch (stage) {
    case "not-confirmed":
      return [
        { stage, state: "current" },
        ...frame
          .slice(1)
          .map((s) => ({ stage: s, state: "upcoming" as const })),
      ];
    case "needs-more-info":
    case "rejected":
      return [
        { stage: "submitted", state: "done" },
        { stage, state: "current" },
      ];
    default:
      return [{ stage, state: "current" }];
  }
}
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
        /** The revision FlightDeck was sent; null when Atlas adopted a
         * request it had no record of. */
        atlasRevision: z.number().int().positive().nullable(),
        /** FlightDeck already held this project's request and Atlas follows
         * it: its destination and revision are not Atlas's to show. */
        adopted: z.boolean(),
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
    /** Super Admin only, while a send is unconfirmed: exactly what Retry
     * send resends, which may be an older revision than the project now. */
    pendingPayload: projectOnboardingPayloadSchema.nullable(),
    /** No open request: a (new) send is possible. */
    canSend: z.boolean(),
    /** Super Admin only: the send is unconfirmed (reserved), or filed but
     * unknown to FlightDeck, and may be closed so a new send can go. */
    canClose: z.boolean(),
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
  fields: z.array(z.string()).optional(),
  atlasRevision: z.number().int().positive().optional(),
  status: onboardingStatusSchema.optional(),
});
export const onboardStagesSchema = z.object({
  stages: z.record(z.enum(onboardingStages)),
  /** When Atlas last read each project's send back from FlightDeck. */
  checked: z.record(isoSchema.nullable()),
  retryAfter: z.number().int().positive().nullable(),
});
