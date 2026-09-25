// Onboarding measures in Atlas (plan 2026-09-25 lane A "GATE metrics", item
// onb-metrics-atlas; D-037 item 7 approves ONB_METRICS_ENABLED, default OFF).
//
// The moments of one onboarding draft (one Atlas project):
//   - 'draft-opened'  someone who may edit it opened its onboarding while it
//                     held no details yet (the start);
//   - 'draft-saved'   its onboarding details were first saved;
//   - 'asked'         an editor first asked the Super Admin to send it (the
//                     producer arrives with onb-atlas-ask-persistence);
//   - 'sent'          Atlas first saw it filed with FlightDeck;
//   - 'correction'    Atlas first saw FlightDeck ask for more information.
// Time to first saved draft (opened -> saved), ask-to-send (asked -> sent)
// and the correction rate (corrected / sent) are read off these.
//
// ⛔ NO VALUES. A row is {draft_hash, kind, at}: the sha256 of the Atlas
// project id, the moment and when Atlas saw it. No field value, id, label,
// user, workspace or submission is stored, and these functions take nothing
// wider than a draft id and a kind, so nothing else CAN be written.
//
// ⛔ DEFAULT OFF. Only the exact string "true" turns it on (fails closed).
// ONCE PER MOMENT: UNIQUE(draft_hash, kind), so the first of each wins and a
// retry, a second poll or a later edit never counts twice.
// BEST-EFFORT: it runs after what it measures was committed, and a failure
// here is swallowed, so a measure never fails the request it measures.
import type { OnboardDb } from "./onboard-route";

/** Kept in step with the CHECK in db/schema.ts. */
export const onboardingMetricKinds = [
  "draft-opened",
  "draft-saved",
  "asked",
  "sent",
  "correction",
] as const;
export type OnboardingMetricKind = (typeof onboardingMetricKinds)[number];
export type OnboardingMetricEvent = {
  draftHash: string;
  kind: OnboardingMetricKind;
  at: string;
};

/** ONB_METRICS_ENABLED: on only for the exact string "true". */
export const metricsFlagOn = (value: unknown) => value === "true";

async function draftHash(draftId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(draftId),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Records one moment of draft `draftId` at `at`, once. Returns whether a
 * row was written (false: off, an unknown kind, already recorded, or the
 * write failed). Never throws. */
export async function recordOnboardingMetric(
  db: OnboardDb,
  enabled: boolean,
  draftId: string,
  kind: OnboardingMetricKind,
  at: string,
): Promise<boolean> {
  if (enabled !== true) return false;
  if (!(onboardingMetricKinds as readonly string[]).includes(kind))
    return false;
  try {
    const result = await db
      .prepare(
        "INSERT OR IGNORE INTO atlas_onboarding_metrics (draft_hash,kind,at) VALUES (?,?,?)",
      )
      .bind(await draftHash(draftId), kind, at)
      .run();
    return result.meta.changes > 0;
  } catch {
    return false;
  }
}

/** Records 'draft-saved' for a committed project save that wrote the
 * onboarding field (`before` -> `after`). A save that left the draft as it
 * was is not a saved draft. */
export async function recordDraftSave(
  db: OnboardDb,
  enabled: boolean,
  draftId: string,
  before: { onboarding?: unknown },
  after: { onboarding?: unknown },
  at: string,
): Promise<boolean> {
  if (enabled !== true || after.onboarding === undefined) return false;
  if (
    JSON.stringify(before.onboarding ?? null) ===
    JSON.stringify(after.onboarding ?? null)
  )
    return false;
  return recordOnboardingMetric(db, enabled, draftId, "draft-saved", at);
}

/** Every recorded moment. */
export async function onboardingMetricEvents(
  db: OnboardDb,
): Promise<OnboardingMetricEvent[]> {
  const { results } = await db
    .prepare(
      "SELECT draft_hash,kind,at FROM atlas_onboarding_metrics ORDER BY at",
    )
    .bind()
    .all<{ draft_hash: string; kind: OnboardingMetricKind; at: string }>();
  return results.map((r) => ({ draftHash: r.draft_hash, kind: r.kind, at: r.at }));
}

type Duration = { count: number; medianMs: number | null };
function median(values: number[]): Duration {
  if (!values.length) return { count: 0, medianMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    count: sorted.length,
    medianMs:
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

/** The three measures. A duration is counted only for a draft that has
 * both moments with the end after the start, so a draft whose start
 * predates the flag, or a skewed clock, adds nothing rather than a guess. */
export function summariseOnboardingMetrics(events: OnboardingMetricEvent[]) {
  const drafts = new Map<string, Partial<Record<OnboardingMetricKind, number>>>();
  for (const e of events) {
    const moments = drafts.get(e.draftHash) ?? {};
    const time = Date.parse(e.at);
    if (Number.isFinite(time)) moments[e.kind] = time;
    drafts.set(e.draftHash, moments);
  }
  const between = (from: OnboardingMetricKind, to: OnboardingMetricKind) =>
    median(
      [...drafts.values()].flatMap((m) =>
        m[from] !== undefined && m[to] !== undefined && m[to]! > m[from]!
          ? [m[to]! - m[from]!]
          : [],
      ),
    );
  const sent = [...drafts.values()].filter((m) => m.sent !== undefined);
  const corrected = sent.filter((m) => m.correction !== undefined).length;
  return {
    timeToFirstSavedDraft: between("draft-opened", "draft-saved"),
    askToSend: between("asked", "sent"),
    correctionRate: {
      sent: sent.length,
      corrected,
      rate: sent.length ? corrected / sent.length : null,
    },
  };
}
