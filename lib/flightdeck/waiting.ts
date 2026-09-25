// The waiting view of a FlightDeck send (plan 2026-09-25 J4,
// onb-atlas-status-timeline): what the card and the form say about a send
// while FlightDeck holds it. Built only from the viewer's approved status
// projection (projectStatus), so it never shows more than that projection
// allows, and never guesses: every time shown is one Atlas saw, a send that
// predates the transition log reads "before tracking", and no ETA is shown
// unless the owner configured a response policy. Pure, so it is tested
// without a browser; app/flightdeck-onboarding.tsx renders it.
import { t, type Locale, type MessageKey } from "../i18n";
import type { OnboardingStage, OnboardingStatus } from "./onboarding";

/** ONB_RESPONSE_POLICY_DAYS (D-037 item 7, owner-owned, unset by default):
 * a whole number of working days from 1 to 60. Anything else is unset, so
 * a typo shows no ETA rather than a wrong one. */
export function responsePolicyDaysFrom(value: string | undefined) {
  const text = (value ?? "").trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const days = Number(text);
  return days >= 1 && days <= 60 ? days : null;
}

export type WaitingView = {
  /** The current send's observed transitions, oldest first. */
  rows: { stage: OnboardingStage; text: string }[];
  /** Earlier sends of the project, newest first, each linked to the send
   * that followed it. */
  history: string[];
  /** "Could not reach FlightDeck since <t>": three read-backs in a row
   * failed. The stage is left as it was. */
  outage: string | null;
  /** What happens next at this stage. */
  next: string | null;
  /** Only with an owner-set response policy, while FlightDeck reviews. */
  eta: string | null;
  /** Super Admin: when Atlas last checked. Editor: when Atlas last observed
   * an update (a transition), not a check attempt (their view never checks).
   * Only while FlightDeck may move it. */
  freshness: string | null;
};

const defaultWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function waitingView(
  status: OnboardingStatus,
  options: {
    superAdmin: boolean;
    locale?: Locale;
    when?: (iso: string) => string;
  },
): WaitingView {
  const locale = options.locale ?? "en";
  const when = options.when ?? defaultWhen;
  const op = status.operation;
  const stageText = (stage: OnboardingStage) =>
    t(`onb.stage.${stage}`, locale);
  const seen = (observedAt: string | null) =>
    observedAt
      ? t("onb.observed.seen", locale, { when: when(observedAt) })
      : t("onb.observed.before", locale);
  const rows = (status.transitions ?? []).map((row) => ({
    stage: row.stage,
    text: t("onb.observed.row", locale, {
      stage: stageText(row.stage),
      seen: seen(row.observedAt),
    }),
  }));
  // Newest first: each earlier send was followed by the one before it in
  // the list, and the newest by the current send.
  const earlier = status.history ?? [];
  const history = earlier.map((send, i) => {
    const next = i === 0 ? (op?.atlasRevision ?? null) : earlier[i - 1]!.revision;
    const last = send.transitions[send.transitions.length - 1];
    return [
      t("onb.history.row", locale, {
        send:
          send.revision === null
            ? t("onb.history.adopted", locale)
            : t("onb.history.revision", locale, { n: send.revision }),
        stage: stageText(send.stage),
        seen: seen(last?.observedAt ?? null),
      }),
      next === null
        ? t("onb.history.againAdopted", locale)
        : t("onb.history.again", locale, { n: next }),
    ].join(" ");
  });
  const days = status.responsePolicyDays ?? null;
  // The editor's "last update seen" is the newest transition Atlas actually
  // observed (the recorded submission counts), never op.checkedAt: a failed
  // read-back still advances checked_at, so it would claim an update that
  // never arrived, and keep moving during an outage.
  const lastSeen = (status.transitions ?? []).reduce<string | null>(
    (latest, row) =>
      row.observedAt && (latest === null || row.observedAt > latest)
        ? row.observedAt
        : latest,
    null,
  );
  const freshness =
    op && status.pollable
      ? options.superAdmin
        ? op.checkedAt
          ? t("onb.check.last", locale, { when: when(op.checkedAt) })
          : t("onb.check.never", locale)
        : lastSeen
          ? t("onb.check.seen", locale, { when: when(lastSeen) })
          : t("onb.check.seenNever", locale)
      : null;
  return {
    rows,
    history,
    outage: status.unreachableSince
      ? t("onb.outage", locale, { when: when(status.unreachableSince) })
      : null,
    next: op ? t(`onb.next.${op.stage}` as MessageKey, locale) : null,
    eta:
      op?.stage === "submitted" && days !== null
        ? days === 1
          ? t("onb.eta.one", locale)
          : t("onb.eta.many", locale, { n: days })
        : null,
    freshness,
  };
}
