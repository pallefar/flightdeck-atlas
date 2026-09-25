// The FlightDeck card on the Atlas project page (plan 2026-09-25 J1,
// onb-atlas-project-entry-card): the requester's main surface. One card whose
// state follows the project's draft and the approved status projection
// (projectStatus in onboard-route.ts), never a raw OS status. Pure, so the
// rules are tested without a browser; app/flightdeck-project-card.tsx renders it.
import {
  readinessFor,
  type OnboardingStage,
  type OnboardingStatus,
  type ReadinessProject,
} from "./onboarding";

/** The element id of the card: the connection page's rows link to
 * `#flightdeck` on the project page. */
export const CARD_ANCHOR = "flightdeck";

/** ATLAS_REQUESTER_REQUESTS (D-037 item 4): default off; only "true" or "1"
 * turns it on, so a typo keeps it off. */
export const requesterRequestsOn = (value: string | undefined) =>
  ["true", "1"].includes((value ?? "").trim().toLowerCase());

/** Who sees the card. The Super Admin always (as today, the one who sends).
 * Anyone else only with the flag on AND rights to edit the project; a
 * view-only member never does. An example project has no server record. */
export const cardVisible = (v: {
  superAdmin: boolean;
  canEdit: boolean;
  requesterRequests: boolean;
  demo: boolean;
}) => !v.demo && (v.superAdmin || (v.requesterRequests && v.canEdit));

export type CardView =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "prepare" }
  | {
      kind: "continue";
      done: number;
      total: number;
      /** The last send's stage when it reopened the draft (declined,
       * refused, closed), so the card never reads as "never sent". */
      stage: OnboardingStage | null;
    }
  | {
      kind: "waiting";
      on: "superAdmin" | "flightdeck";
      stage: OnboardingStage;
      reasonCode: string | null;
      checkedAt: string | null;
    }
  | { kind: "fix"; reasonCode: string | null }
  | { kind: "created"; stage: OnboardingStage; openHref: string | null };

/** "Open in FlightDeck": for the Super Admin the linked workspace and
 * project; for anyone else the project only, and only if the projection
 * gave them the link (today's editor projection never does, so it is
 * hidden). No OS origin configured: no link. */
export function openInFlightDeckHref(
  status: OnboardingStatus,
  superAdmin: boolean,
  osOrigin: string,
) {
  const origin = osOrigin.replace(/\/+$/, "");
  const link = status.link;
  if (!origin || !link) return null;
  const params = new URLSearchParams(
    superAdmin
      ? { fdWorkspace: link.workspaceId, fdProject: link.osProjectId }
      : { fdProject: link.osProjectId },
  );
  return `${origin}/console?${params}`;
}

/** The card's state. `status` is the viewer's projection, or null while it
 * has not loaded (`failed` when it could not be read): nothing is guessed. */
export function projectCardView(input: {
  project: ReadinessProject;
  status: OnboardingStatus | null;
  failed: boolean;
  superAdmin: boolean;
  osOrigin: string;
}): CardView {
  const { project, status } = input;
  if (!status) return { kind: input.failed ? "unavailable" : "checking" };
  const op = status.operation;
  const stage = op?.stage ?? null;
  switch (stage) {
    case "not-confirmed":
    case "submitted":
      return {
        kind: "waiting",
        on: stage === "not-confirmed" ? "superAdmin" : "flightdeck",
        stage,
        reasonCode: op!.reasonCode,
        checkedAt: op!.checkedAt,
      };
    case "needs-more-info":
      return { kind: "fix", reasonCode: op!.reasonCode };
    case "linked":
    case "setup-in-progress":
    case "setup-complete":
      return {
        kind: "created",
        stage,
        openHref: openInFlightDeckHref(status, input.superAdmin, input.osOrigin),
      };
  }
  if (!project.flightdeckDraft) return { kind: "prepare" };
  // 'n of N for you': the requester's items. The destination is the Super
  // Admin's and is chosen at Send, so it is not counted on the card.
  const { done, total } = readinessFor(project, null, "requester");
  return { kind: "continue", done, total, stage };
}
