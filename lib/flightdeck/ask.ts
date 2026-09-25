// The editor's "Ask Super Admin to send revision r" and the Super Admin's
// "Waiting for you (n)" (onb-atlas-request-ui, plan 2026-09-25 J3, behind
// ATLAS_REQUESTER_REQUESTS, D-037 item 4). Pure, so the rules are tested
// without a browser. The ask itself is written by the server
// (sendRequestAction); nothing here sends: only the Super Admin presses Send
// (D-033 decision 7).
import {
  REVIEW_FIELDS,
  buildOnboardingPayload,
  isDraftLocked,
  reviewRows,
  type OnboardingDraft,
  type OnboardingStage,
  type PayloadProject,
} from "./onboarding";

/** Payload values that are not what the editor wrote: the Super Admin's
 * destination, values the server fills in at Send, and the computed task
 * progress (a board value that moves on its own). */
const NOT_ASKED = new Set([
  "target.workspaceId",
  "progress",
  "atlasProjectId",
  "atlasRevision",
  "installationId",
  "requestedBy",
  "idempotencyKey",
  "schema",
]);

/** The asked revision's sent fields, worded as Review words them, keyed by
 * payload path. Built by the server at the ask from the stored project. */
export function askSnapshot(project: PayloadProject): Record<string, string> {
  const payload = buildOnboardingPayload({
    project,
    destinationWorkspaceId: "",
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    installationId: "atlas-local",
    requestedBy: "0".repeat(64),
  });
  const out: Record<string, string> = {};
  for (const row of reviewRows(payload))
    if (!row.missing && !NOT_ASKED.has(row.path)) out[row.path] = row.value;
  return out;
}

export type AskDiffRow = {
  path: string;
  label: string;
  asked: string;
  now: string;
};

/** What changed between the asked revision and now, field by field in
 * Review's order. No snapshot (an ask made before Atlas kept one): null, so
 * the page says it cannot list the changes instead of claiming none. */
export function askDiff(
  asked: Record<string, string> | undefined,
  now: Record<string, string>,
): AskDiffRow[] | null {
  if (!asked) return null;
  const rows: AskDiffRow[] = [];
  for (const field of REVIEW_FIELDS) {
    if (NOT_ASKED.has(field.path)) continue;
    const before = asked[field.path] ?? "";
    const after = now[field.path] ?? "";
    if (before !== after)
      rows.push({ path: field.path, label: field.label, asked: before, now: after });
  }
  return rows;
}

export type RequesterAsk =
  | { kind: "none" }
  | { kind: "waiting" | "changed"; revision: number; by: string; at: string };

/** The editor's ask as the Review step and the card show it. Withdrawn, or
 * a draft FlightDeck may hold (the send is what shows then): none. */
export function requesterAsk(
  onboarding: OnboardingDraft | undefined,
  stage: OnboardingStage | null | undefined,
): RequesterAsk {
  const ask = onboarding?.sendRequest;
  if (!ask || ask.withdrawnAt || isDraftLocked(stage)) return { kind: "none" };
  return {
    kind: ask.stale ? "changed" : "waiting",
    revision: ask.revision,
    by: ask.by,
    at: ask.at,
  };
}

type WaitingProject = {
  id: string;
  archived?: boolean;
  source?: string;
  onboarding?: OnboardingDraft;
};

/** The Super Admin's "Waiting for you (n)": every open ask on an Atlas
 * project that FlightDeck does not hold, oldest ask first. The flag off:
 * none, so the page is exactly as before. */
export function waitingForYou<P extends WaitingProject>(
  projects: readonly P[],
  stages: Readonly<Record<string, OnboardingStage>> | null,
  enabled: boolean,
) {
  if (!enabled) return [];
  return projects
    .filter((p) => !p.archived && p.source === "atlas")
    .flatMap((project) => {
      const ask = requesterAsk(project.onboarding, stages?.[project.id]);
      return ask.kind === "none"
        ? []
        : [
            {
              project,
              revision: ask.revision,
              by: ask.by,
              at: ask.at,
              stale: ask.kind === "changed",
            },
          ];
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}
