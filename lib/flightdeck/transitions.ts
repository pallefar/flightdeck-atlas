// The transition log of an Atlas -> FlightDeck send (plan 2026-09-25 §7,
// onb-atlas-transition-log). One row per stage Atlas SAW the send move to:
// `observed_at` is when Atlas saw it (its own send's answer, a read-back
// poll, or a webhook), never when FlightDeck did it, so no row claims a time
// Atlas does not know. Sends that existed before the log was added have one
// 'backfill' row (migration 0006) with no time, shown as "before tracking".
//
// Every writer (the poll path in onboard-route.ts, and the webhook receiver,
// EPIC atlas-onb-atlas-webhook-receiver) records through applyObservedStage,
// so the rules below hold whoever reports a stage and in whatever order the
// reports arrive.
import type { OnboardDb } from "./onboard-route";
import { onboardingStages, type OnboardingStage } from "./onboarding";

/** How Atlas saw a stage. 'atlas': the answer to Atlas's own action (the
 * send's reply, or the Super Admin closing a send), 'poll': a read-back,
 * 'webhook': FlightDeck pushed it, 'backfill': the send predates the log.
 * Kept in step with the CHECK in db/schema.ts. */
export const transitionSources = [
  "atlas",
  "poll",
  "webhook",
  "backfill",
] as const;
export type TransitionSource = (typeof transitionSources)[number];

export type Transition = {
  sendId: string;
  seq: number;
  stage: OnboardingStage;
  /** When Atlas saw it; null only for a backfilled row. */
  observedAt: string | null;
  source: TransitionSource;
};

export const BEFORE_TRACKING = "before tracking";
/** The time a transition was seen, or "before tracking" for a send that
 * predates the log. Never a guessed time. */
export const observedAtText = (observedAt: string | null) =>
  observedAt ?? BEFORE_TRACKING;

/** The happy path, in order. It only moves forward. */
const FRAME: readonly OnboardingStage[] = [
  "not-confirmed",
  "submitted",
  "linked",
  "setup-in-progress",
  "setup-complete",
];
/** FlightDeck created the project: a later answer cannot un-create it. */
const CREATED: readonly OnboardingStage[] = [
  "linked",
  "setup-in-progress",
  "setup-complete",
];
/** The send ended: FlightDeck declined it, refused it before filing, or the
 * Super Admin closed it unconfirmed. A new send is a new row with its own
 * log, so nothing follows these. */
const ENDED: readonly OnboardingStage[] = ["rejected", "not-sent", "closed"];

/** Whether `next` may follow `prev` in one send's log. A terminal stage
 * (created, declined, ended) is never followed by an earlier stage, so a
 * late poll or an out-of-order webhook cannot move a send backwards. The
 * one reopen path is needs-more-info -> submitted (the request was sent
 * again). A repeat of the latest stage is not a transition. */
export function mayFollow(
  prev: OnboardingStage | null,
  next: OnboardingStage,
): boolean {
  if (prev === null) return true;
  if (prev === next) return false;
  if (ENDED.includes(prev)) return false;
  if (prev === "needs-more-info") return next !== "not-confirmed";
  if (FRAME.includes(next)) return FRAME.indexOf(next) > FRAME.indexOf(prev);
  // An answer or a closing after the happy path: never once created.
  return !CREATED.includes(prev);
}

const uniqueViolation = (error: unknown) =>
  /UNIQUE constraint failed/i.test(String((error as Error)?.message));

/** Records that Atlas saw send `sendId` at `stage`, at `at`. One
 * conditional INSERT…SELECT: seq is the send's max + 1, and the row is
 * written only while the send exists and its latest stage is one `stage`
 * may follow (mayFollow; so never a repeat of the latest). Two writers
 * racing to the same seq meet UNIQUE(send_id, seq): the loser records
 * nothing. Returns whether a row was written. */
export async function applyObservedStage(
  db: OnboardDb,
  sendId: string,
  stage: OnboardingStage,
  at: string,
  source: Exclude<TransitionSource, "backfill">,
): Promise<boolean> {
  const after = onboardingStages.filter((prev) => mayFollow(prev, stage));
  const latest =
    "(SELECT stage FROM atlas_flightdeck_transitions WHERE send_id=?1 ORDER BY seq DESC LIMIT 1)";
  const sql =
    "INSERT INTO atlas_flightdeck_transitions (send_id,seq,stage,observed_at,source) " +
    "SELECT ?1,COALESCE((SELECT MAX(seq) FROM atlas_flightdeck_transitions WHERE send_id=?1),0)+1,?2,?3,?4 " +
    "WHERE EXISTS(SELECT 1 FROM atlas_flightdeck_operations WHERE id=?1) " +
    `AND (${latest} IS NULL${after.length ? ` OR ${latest} IN (${after.map((s) => `'${s}'`).join(",")})` : ""})`;
  try {
    const result = await db.prepare(sql).bind(sendId, stage, at, source).run();
    return result.meta.changes > 0;
  } catch (error) {
    if (uniqueViolation(error)) return false;
    throw error;
  }
}

/** A send's log, oldest first. */
export async function transitionsOf(
  db: OnboardDb,
  sendId: string,
): Promise<Transition[]> {
  const { results } = await db
    .prepare(
      "SELECT send_id,seq,stage,observed_at,source FROM atlas_flightdeck_transitions WHERE send_id=? ORDER BY seq",
    )
    .bind(sendId)
    .all<{
      send_id: string;
      seq: number;
      stage: OnboardingStage;
      observed_at: string | null;
      source: TransitionSource;
    }>();
  return results.map((r) => ({
    sendId: r.send_id,
    seq: r.seq,
    stage: r.stage,
    observedAt: r.observed_at,
    source: r.source,
  }));
}
