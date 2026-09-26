import { z } from "zod";
// Atlas's strict copy of the FlightDeck OS CRM projection, DTO v1 (crm-40).
//
// The OS owns the contract: docs/CRM-ATLAS-SYNC-CONTRACT.md and its
// machine-checked half, `crmProjectProjectionV1` in the OS's
// flightdeck/server/crm/inboundProjection.ts. This is a COPY of that schema,
// rule for rule, so Atlas refuses exactly what the OS refuses: every object is
// strict (an unknown key fails), and no email, phone number, full name, amount
// or unknown schema version can pass. tests/fixtures/crm-projection-v1.json is
// the shared fixture, byte for byte, pinned below and in the OS contract; a
// change there is a deliberate change on both sides.
//
// Free of server imports: the project page's CRM card (crm-41) may import it.

/** sha256 of the shared positive fixture (the OS contract, §Fixtures). */
export const CRM_PROJECTION_FIXTURE_SHA256 =
  "4b408bbded4c8a4309d4289fc5da77174f002d016383b5343e8d21f0a2de7f6b";

export const CRM_PROJECTION_MAX_ITEMS = 5;
/** Deal-contact roles in rank order. */
export const CRM_CONTACT_ROLES = [
  "champion",
  "decision_maker",
  "influencer",
  "user",
  "other",
] as const;
export const CRM_STAGE_KINDS = ["open", "won", "lost"] as const;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const INITIALS_RE = /^(?:—|[^\s.@]{1,3}\.(?: [^\s.@]{1,3}\.)*)$/u;
const INITIALS_MAX = 500;
/** Every multi-character upper-case expansion of one UTF-16 unit ("ß" →
 * "SS"): the only initials longer than one character the OS masker emits. */
const MULTI_CHAR_INITIALS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (let u = 0; u <= 0xffff; u++) {
    const up = String.fromCharCode(u).toUpperCase();
    if (up.length > 1) out.add(up);
  }
  return out;
})();
function isMaskedInitials(s: string): boolean {
  if (s === "—") return true;
  return s.split(" ").every((part) => {
    const g = part.slice(0, -1);
    return g.length === 1 || MULTI_CHAR_INITIALS.has(g);
  });
}
const PHONE_RUN_RE = /\+?\d[\d\s/().-]*\d/g;
function looksLikePhone(s: string): boolean {
  for (const m of s.matchAll(PHONE_RUN_RE))
    if ((m[0].match(/\d/g) ?? []).length >= 7) return true;
  return false;
}
/** Business text (a company or stage name) that can never carry a contact
 * channel. */
const businessText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !s.includes("@"), {
      message: "contains an email-like value",
    })
    .refine((s) => !looksLikePhone(s), {
      message: "contains a phone-like value",
    });

const id = z.string().regex(ID_RE);
const count = z.number().int().nonnegative();

const company = z
  .object({
    id,
    name: businessText(200),
    domain: z.string().regex(DOMAIN_RE).nullable(),
  })
  .strict();
const primaryDeal = z
  .object({
    id,
    stageName: businessText(80),
    stageKind: z.enum(CRM_STAGE_KINDS),
    status: z.enum(CRM_STAGE_KINDS),
    version: z.number().int().positive(),
  })
  .strict()
  .refine((d) => d.status === d.stageKind, {
    message: "status must equal the stage kind",
    path: ["status"],
  });
const contact = z
  .object({
    initials: z
      .string()
      .max(INITIALS_MAX)
      .regex(INITIALS_RE)
      .refine(isMaskedInitials, {
        message: "initials must be maskPersonName output",
      }),
    role: z.enum(CRM_CONTACT_ROLES),
  })
  .strict();
const stage = z
  .object({
    id,
    name: businessText(80),
    kind: z.enum(CRM_STAGE_KINDS),
    position: count,
  })
  .strict();
const unique = (ids: string[]) => new Set(ids).size === ids.length;

export const crmProjectionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: id,
    revision: count,
    companies: z.array(company).max(CRM_PROJECTION_MAX_ITEMS),
    companiesOverflow: count,
    primaryDeal: primaryDeal.nullable(),
    otherOpenDealCount: count,
    contacts: z.array(contact).max(CRM_PROJECTION_MAX_ITEMS),
    contactsOverflow: count,
    stages: z.array(stage).max(50),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (
      p.companies.length < CRM_PROJECTION_MAX_ITEMS &&
      p.companiesOverflow !== 0
    )
      issue("companiesOverflow", "overflow without a full list");
    if (
      p.contacts.length < CRM_PROJECTION_MAX_ITEMS &&
      p.contactsOverflow !== 0
    )
      issue("contactsOverflow", "overflow without a full list");
    if (!unique(p.companies.map((c) => c.id)))
      issue("companies", "duplicate company id");
    if (!unique(p.stages.map((s) => s.id)))
      issue("stages", "duplicate stage id");
    for (let i = 1; i < p.stages.length; i++) {
      const a = p.stages[i - 1]!;
      const b = p.stages[i]!;
      if (a.position > b.position || (a.position === b.position && a.id >= b.id))
        issue("stages", "stages must be ordered by position, then id");
    }
    const rank = (r: (typeof CRM_CONTACT_ROLES)[number]) =>
      CRM_CONTACT_ROLES.indexOf(r);
    for (let i = 1; i < p.contacts.length; i++)
      if (rank(p.contacts[i - 1]!.role) > rank(p.contacts[i]!.role))
        issue("contacts", "contacts must be ordered by role rank first");
    if (p.primaryDeal === null) {
      if (p.stages.length > 0)
        issue("stages", "stages belong to the primary deal's pipeline");
      if (p.otherOpenDealCount !== 0)
        issue("otherOpenDealCount", "an open deal would be the primary deal");
      if (p.contacts.length > 0)
        issue("contacts", "contacts are the people on the primary deal");
      if (p.contactsOverflow !== 0)
        issue("contactsOverflow", "contacts are the people on the primary deal");
    } else if (
      p.primaryDeal.status !== "open" &&
      p.otherOpenDealCount !== 0
    )
      issue("otherOpenDealCount", "an open deal always wins over a closed one");
  });
export type CrmProjectionV1 = z.infer<typeof crmProjectionV1Schema>;

/** GET …/crm/revision: `{ projectId, revision }` only. */
export const crmRevisionV1Schema = z
  .object({ projectId: id, revision: count })
  .strict();
export type CrmRevisionV1 = z.infer<typeof crmRevisionV1Schema>;

/** Why the card cannot be shown. Never carries data. */
export const crmUnavailableReasons = [
  "not_configured",
  "not_enabled",
  "not_linked",
  "link_mismatch",
  "unauthorized",
  "refused",
  "not_found",
  "workspace_disabled",
  "rate_limited",
  "os_unreachable",
  "invalid_response",
  "crm_not_ready",
  "crm_projection_invalid",
] as const;
export type CrmUnavailableReason = (typeof crmUnavailableReasons)[number];

/** What /api/flightdeck/crm answers the browser. */
export type CrmRouteView =
  | { state: "ok"; projection: CrmProjectionV1; openUrl: string }
  | { state: "unavailable"; reason: CrmUnavailableReason };
/** What /api/flightdeck/crm/revision answers the browser. */
export type CrmRevisionView =
  | { state: "ok"; revision: number }
  | { state: "unavailable"; reason: CrmUnavailableReason };
