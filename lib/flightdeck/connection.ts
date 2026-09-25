import { z } from "zod";
import type { Project } from "../projects";
import { t, type Locale } from "../i18n";
import type { WhoamiRead } from "./context-client";
import { isDraftLocked, type OnboardingStage } from "./onboarding";
// The Connections page's ONE connection line (onb-atlas-connection-clarity).
// It is derived from the credential's own whoami (GET /api/inbound/v1/whoami)
// and nothing else, so the page can no longer show a "Connected" chip next to
// a "Not enabled" one. Shared by the route and the page: no server-only
// imports (context-client is imported for its type only).
//
// FAILS CLOSED: only a whoami answer that parses and names a known scope is
// "Connected"; every other answer is "Not connected (reason)".

/** The whoami scopes Atlas knows, in a fixed order. */
export const ATLAS_SCOPES = ["read:context", "submit:proposal"] as const;
export type AtlasScope = (typeof ATLAS_SCOPES)[number];

export const connectionFailures = [
  "not_configured",
  "unauthorized",
  "os_unreachable",
  "rate_limited",
  "invalid_response",
  "no_scope",
  "check_failed",
] as const;
export type ConnectionFailure = (typeof connectionFailures)[number];

/** What /api/flightdeck/connection answers: the derived state and the known
 * scopes only. Never the credential, its expiry, limits or features. */
export const connectionViewSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("ok"),
      scopes: z.array(z.enum(ATLAS_SCOPES)).min(1),
    })
    .strict(),
  z.object({ state: z.enum(connectionFailures) }).strict(),
]);
export type ConnectionView = z.infer<typeof connectionViewSchema>;

const whoamiScopesSchema = z.object({
  integrationId: z.string().min(1).max(64),
  scopes: z.array(z.string()),
});

/** The view of one whoami read. */
export function connectionFromWhoami(
  read: WhoamiRead | { state: "not_configured" },
): ConnectionView {
  if (read.state !== "ok") return { state: read.state };
  const parsed = whoamiScopesSchema.safeParse(read.body);
  if (!parsed.success) return { state: "invalid_response" };
  const scopes = ATLAS_SCOPES.filter((s) => parsed.data.scopes.includes(s));
  return scopes.length ? { state: "ok", scopes } : { state: "no_scope" };
}

/** The one connection line; null means the first answer has not come yet. */
export function connectionLine(
  view: ConnectionView | null,
  locale: Locale = "en",
): string {
  if (!view) return t("onb.conn.checking", locale);
  if (view.state !== "ok")
    return t("onb.conn.notConnected", locale, {
      reason: t(`onb.conn.reason.${view.state}`, locale),
    });
  const read = view.scopes.includes("read:context");
  const submit = view.scopes.includes("submit:proposal");
  return t(
    read && submit
      ? "onb.conn.readSubmit"
      : read
        ? "onb.conn.readOnly"
        : "onb.conn.submitOnly",
    locale,
  );
}

/** Whether work waits on the To FlightDeck tab, so the page opens there: an
 * Atlas project with a draft FlightDeck does not hold yet, or an open ask to
 * the Super Admin to send it. Before the stages have loaded (null) a draft
 * may still be unsent, so it counts. */
export function workWaitingForFlightDeck(
  projects: readonly Pick<
    Project,
    "archived" | "source" | "flightdeckDraft" | "onboarding" | "id"
  >[],
  stages: Readonly<Record<string, OnboardingStage>> | null,
): boolean {
  return projects.some((p) => {
    if (p.archived || p.source !== "atlas") return false;
    const stage = stages?.[p.id];
    const unsent =
      !!p.flightdeckDraft && (!stage || stage === "not-sent");
    const ask = p.onboarding?.sendRequest;
    const asked = !!ask && !ask.withdrawnAt && !isDraftLocked(stage);
    return unsent || asked;
  });
}
