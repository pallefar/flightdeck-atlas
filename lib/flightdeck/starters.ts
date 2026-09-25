import { z } from "zod";
import { isoSchema } from "./context";
import {
  STARTER_SOURCE_RE,
  withoutPrefill,
  type OnboardingDraft,
  type Provenance,
} from "./onboarding";
import raw from "./starters.v1.json" with { type: "json" };
import { t, type Locale, type MessageKey } from "../i18n";

// Starters for the To FlightDeck draft (onb-starter-choice-machinery).
// Starter content is human-owned (plan 2026-09-25 §6, GATE legal/protected
// content): starters.v1.json ships empty and gets an entry only once the
// owner approves it. A starter holds label-free descriptive fields only, so
// works council, legal entity, headcount, access, owner roles and any other
// fact for a human can never be prefilled from one: the schema is strict.

/** The only fields a starter may fill. */
export const STARTER_FIELDS = [
  "summary",
  "successMeasure",
  "functionArea",
  "category",
] as const;
export type StarterField = (typeof STARTER_FIELDS)[number];

const text = (n: number) => z.string().trim().min(1).max(n);
export const starterSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    version: z.number().int().min(1).max(999999),
    /** Who owns the content (a role or team), and when they approved it. */
    owner: text(120),
    approvedAt: isoSchema,
    name: text(80),
    fields: z
      .object({
        summary: text(1500).optional(),
        successMeasure: text(500).optional(),
        functionArea: text(80).optional(),
        category: text(60).optional(),
      })
      .strict()
      .refine((f) => Object.keys(f).length > 0, "A starter fills something."),
  })
  .strict();
export type Starter = z.infer<typeof starterSchema>;

/** The approved list, or none at all when any entry is malformed or an id
 * repeats: a list that fails its own check offers nothing (fails closed). */
export function loadStarters(value: unknown): Starter[] {
  const parsed = z.array(starterSchema).safeParse(value);
  if (!parsed.success) return [];
  const ids = parsed.data.map((s) => s.id);
  return new Set(ids).size === ids.length ? parsed.data : [];
}
export const approvedStarters: Starter[] = loadStarters(raw);

/** 'Start blank' first, then the approved starters; none approved means
 * there is no choice to make, so the step is skipped. */
export const starterChoices = (starters: Starter[]) =>
  starters.length ? ["blank", ...starters.map((s) => s.id)] : [];

export const starterSource = (s: Pick<Starter, "id" | "version">) =>
  `starter:${s.id}@${s.version}`;

/** The label for a prefill source: a starter names its id and version. */
export function prefillLabel(source: string, locale: Locale) {
  const m = STARTER_SOURCE_RE.test(source)
    ? /^starter:(.+)@(\d+)$/.exec(source)
    : null;
  return m
    ? t("onb.prefill.starter", locale, { id: m[1], version: m[2] })
    : t(`onb.prefill.${source}` as MessageKey, locale);
}

export type StarterTarget = {
  functionArea?: string;
  description?: string;
  benefit?: string;
  category?: string;
  onboarding: OnboardingDraft;
};
const KEY = {
  summary: "description",
  successMeasure: "benefit",
  functionArea: "functionArea",
  category: "category",
} as const satisfies Record<StarterField, keyof StarterTarget>;
const clean = (v: string | undefined) => (v ?? "").trim();

export type StarterPlanItem = {
  field: StarterField;
  before: string;
  after: string;
};
/** Exactly the fields applying would fill: like every prefill, a starter
 * fills empty fields only, so it never replaces text a person wrote. */
export function starterPlan(
  target: StarterTarget,
  starter: Starter,
): StarterPlanItem[] {
  const out: StarterPlanItem[] = [];
  for (const field of STARTER_FIELDS) {
    const after = starter.fields[field];
    const before = target[KEY[field]] ?? "";
    if (after && !clean(before)) out.push({ field, before, after });
  }
  return out;
}

export type AppliedStarter = {
  source: string;
  name: string;
  version: number;
  plan: StarterPlanItem[];
  prefillBefore: Partial<Record<StarterField, Provenance>>;
};
/** What the choice shows: nothing when no starter is approved (the step is
 * skipped); otherwise 'Start blank' and the starters, the chosen starter's
 * preview, or the applied starter with its Undo. */
export function starterView(
  starters: Starter[],
  target: StarterTarget,
  choice: string,
  applied: AppliedStarter | null,
) {
  if (!starterChoices(starters).length) return null;
  if (applied) return { kind: "applied" as const, applied };
  const chosen = starters.find((s) => s.id === choice) ?? null;
  return {
    kind: "choose" as const,
    starters,
    chosen,
    plan: chosen ? starterPlan(target, chosen) : [],
  };
}

/** Fills the planned fields and records `starter:<id>@<version>` on each. */
export function applyStarter<T extends StarterTarget>(
  target: T,
  starter: Starter,
  at: string,
): { next: T; applied: AppliedStarter } {
  const plan = starterPlan(target, starter);
  const source = starterSource(starter);
  const prefill = { ...target.onboarding.prefill };
  const prefillBefore: AppliedStarter["prefillBefore"] = {};
  const next: T = { ...target };
  for (const { field, after } of plan) {
    if (prefill[field]) prefillBefore[field] = prefill[field];
    next[KEY[field]] = after as T[(typeof KEY)[StarterField]];
    prefill[field] = { source, at, value: after };
  }
  next.onboarding = plan.length
    ? { ...target.onboarding, prefill }
    : target.onboarding;
  return {
    next,
    applied: {
      source,
      name: starter.name,
      version: starter.version,
      plan,
      prefillBefore,
    },
  };
}

/** Undo: each field still holding the starter's text gets its previous
 * value and provenance back; a field the user edited since stays theirs. */
export function undoStarter<T extends StarterTarget>(
  current: T,
  applied: AppliedStarter,
): T {
  const next: T = { ...current };
  let onboarding = current.onboarding;
  for (const { field, before, after } of applied.plan) {
    if (clean(current[KEY[field]]) !== after) continue;
    next[KEY[field]] = before as T[(typeof KEY)[StarterField]];
    const was = applied.prefillBefore[field];
    onboarding = was
      ? { ...onboarding, prefill: { ...onboarding.prefill, [field]: was } }
      : withoutPrefill(onboarding, field);
  }
  next.onboarding = onboarding;
  return next;
}
