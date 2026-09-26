// apps-33: what the 9-dot menu's FlightDeck OS section shows for the apps
// directory (apps-32), as plain code the spec can run without a browser.
// The card contract is the OS's SubAppCard (apps-07; plan 2026-09-25 Lane B,
// "One card specification for OS and Atlas"): an openable app gets Open and
// See more; a locked app is one link to its bridge page with the reason.
//
// ⛔ AFFORDANCE, NOT A GATE. Atlas signs in to the OS with a shared machine
// credential, so an "enabled" app still checks access when it is opened. An
// app is openable here only when the route built it an http(s) link; every
// other case is shown locked (fails closed), never as a dead Open.
import type { MessageKey } from "../i18n";
import type { DirectoryApp, DirectoryView } from "./apps-directory-route";
import type { ContextState, OsSelection } from "./context";

/** Atlas's bridge page for an OS app (apps-34 renders the release there). */
export const appBridgeHref = (id: string) =>
  `/apps/os/${encodeURIComponent(id)}`;

/** Favourites and recents share the Atlas preference lists with native
 * apps; FlightDeck ids carry a prefix so the two can never collide. */
export const fdPrefId = (id: string) => `fd:${id}`;
/** The preference lists hold ids of at most 80 characters. */
export const fdPrefIdFits = (id: string) => fdPrefId(id).length <= 80;

/** Literal keys (never built from the status string at run time), mirroring
 * the OS's APP_BLOCKED_REASONS and its guidanceFor() responsible parties. */
const REASONS: Record<string, [MessageKey, MessageKey | null]> = {
  "operator-off": ["apps.card.reason.operator-off", "apps.card.party.operator"],
  "workspace-disabled": [
    "apps.card.reason.workspace-disabled",
    "apps.card.party.operator",
  ],
  "project-archived": [
    "apps.card.reason.project-archived",
    "apps.card.party.workspace-admin",
  ],
  "schema-missing": [
    "apps.card.reason.schema-missing",
    "apps.card.party.operator",
  ],
  "app-schema-behind": [
    "apps.card.reason.app-schema-behind",
    "apps.card.party.workspace-admin",
  ],
  "app-schema-ahead": [
    "apps.card.reason.app-schema-ahead",
    "apps.card.party.operator",
  ],
  "coming-soon": ["apps.card.reason.coming-soon", "apps.card.party.publisher"],
  "no-identity": ["apps.card.reason.no-identity", null],
  role: ["apps.card.reason.role", "apps.card.party.workspace-admin"],
  "needs-owner-approval": [
    "apps.card.reason.needs-owner-approval",
    "apps.card.party.owner",
  ],
  "needs-function-enable": [
    "apps.card.reason.needs-function-enable",
    "apps.card.party.workspace-admin",
  ],
  "not-enabled": [
    "apps.card.reason.not-enabled",
    "apps.card.party.workspace-admin",
  ],
};

const httpUrl = (value: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
};

export type AppCardModel = {
  openable: boolean;
  openUrl: string | null;
  bridgeHref: string;
  reasonKey: MessageKey | null;
  partyKey: MessageKey | null;
};

export function appCardModel(app: DirectoryApp): AppCardModel {
  const openUrl = app.workspaceStatus === "enabled" ? httpUrl(app.url) : null;
  const [reasonKey, partyKey] = openUrl
    ? [null, null]
    : (Object.hasOwn(REASONS, app.workspaceStatus)
        ? REASONS[app.workspaceStatus]
        : ["apps.card.reason.locked" as const, null]);
  return {
    openable: openUrl !== null,
    openUrl,
    bridgeHref: appBridgeHref(app.id),
    reasonKey,
    partyKey,
  };
}

export type SectionInput = {
  /** Whether this viewer has an OS selection at all (the Super Admin). */
  contextEnabled: boolean;
  context: {
    loaded: boolean;
    state: ContextState | "check_failed" | null;
    selected: OsSelection | null;
    /** The shown project replaces a saved one that is gone. */
    projectFallback?: boolean;
  };
  directory: {
    loading: boolean;
    state: string | null;
    data: DirectoryView | null;
  };
  query: string;
  favourites: string[];
};

export const SECTION_STATES = [
  "not_configured",
  "not_permitted",
  "os_unreachable",
  "unauthorized",
  "rate_limited",
  "invalid_response",
  "workspace_disabled",
  "directory_unavailable",
  "no_project_selected",
  "project_not_available",
  "error",
] as const;
export type SectionState = (typeof SECTION_STATES)[number];
/** Transient failures: a Retry makes sense. */
const RETRY = new Set<SectionState>([
  "os_unreachable",
  "rate_limited",
  "invalid_response",
  "error",
]);
const STATE_KEY: Record<SectionState, MessageKey> = {
  not_configured: "apps.fd.state.not_configured",
  not_permitted: "apps.fd.state.not_permitted",
  os_unreachable: "apps.fd.state.os_unreachable",
  unauthorized: "apps.fd.state.unauthorized",
  rate_limited: "apps.fd.state.rate_limited",
  invalid_response: "apps.fd.state.invalid_response",
  workspace_disabled: "apps.fd.state.workspace_disabled",
  directory_unavailable: "apps.fd.state.directory_unavailable",
  no_project_selected: "apps.fd.state.no_project_selected",
  project_not_available: "apps.fd.state.project_not_available",
  error: "apps.fd.state.error",
};

export type SectionView =
  | { kind: "loading" }
  | {
      kind: "message";
      key: MessageKey;
      retry: boolean;
      /** The shown-but-unsaved selection the viewer may save (see below). */
      confirm?: OsSelection;
    }
  | { kind: "cards"; apps: DirectoryApp[] };

const message = (state: SectionState): SectionView => ({
  kind: "message",
  key: STATE_KEY[state],
  retry: RETRY.has(state),
});
const asState = (value: string | null): SectionState =>
  (SECTION_STATES as readonly string[]).includes(value ?? "")
    ? (value as SectionState)
    : value === "workspace_not_found"
      ? "project_not_available"
      : "error";

/** One answer for the section: loading, one honest message, or the cards
 * (pinned enabled apps first, then enabled, then locked; OS order within). */
export function flightdeckSection(input: SectionInput): SectionView {
  if (!input.contextEnabled) return message("no_project_selected");
  const { context, directory } = input;
  if (!context.loaded) return { kind: "loading" };
  if (!context.selected?.osProjectId)
    return message(
      context.state === "ok" || context.state === null
        ? "no_project_selected"
        : asState(context.state === "check_failed" ? "error" : context.state),
    );
  if (directory.loading || directory.state === null) return { kind: "loading" };
  // The context GET shows the OS default (or a fallback for a saved project
  // that is gone) WITHOUT saving it, while the directory reads only the
  // SAVED selection. Offer to save what is shown instead of a dead end. Only
  // against a context the OS has just confirmed; the save (PUT) re-validates
  // it against fresh OS lists before anything is stored.
  const unsaved =
    directory.state === "no_project_selected" ||
    (directory.state === "project_not_available" && !!context.projectFallback);
  if (unsaved && context.state === "ok")
    return {
      kind: "message",
      key: "apps.fd.state.confirm_project",
      retry: false,
      confirm: context.selected,
    };
  if (!directory.data || directory.state !== "ok")
    return message(asState(directory.state === "ok" ? "error" : directory.state));
  if (directory.data.apps.length === 0)
    return { kind: "message", key: "apps.fd.empty", retry: false };
  const q = input.query.trim().toLowerCase();
  const shown = q
    ? directory.data.apps.filter((a) => a.label.toLowerCase().includes(q))
    : directory.data.apps;
  if (shown.length === 0)
    return { kind: "message", key: "apps.fd.noMatch", retry: false };
  const rank = (a: DirectoryApp) =>
    !appCardModel(a).openable
      ? 2
      : input.favourites.includes(fdPrefId(a.id))
        ? 0
        : 1;
  return {
    kind: "cards",
    apps: shown
      .map((a, i) => ({ a, i, r: rank(a) }))
      .sort((x, y) => x.r - y.r || x.i - y.i)
      .map((x) => x.a),
  };
}
