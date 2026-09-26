// The /api/flightdeck/apps handler: the FlightDeck OS sub-apps for the 9-dot
// app menu. Dependencies are passed in so the spec runs exactly this code over
// a fake OS; the route file wires the real authorisation, reader and origin.
// No Worker bindings are imported here.
//
// ⚠ WHO SEES IT. The OS credential is a machine credential and cannot filter
// by Atlas user, so this lists what is ENABLED in the OS workspace, not what
// one person may open. That is safe to show to any Atlas member with
// projects.read because the list is product names and links only: opening a
// link still needs an OS sign-in and the OS's own role check.
import { json } from "../http";
import {
  pickWorkspace,
  type ContextState,
  type FlightdeckAppLink,
  type OsAppsResponse,
  type OsSelection,
} from "./context";
import type { ContextReader } from "./context-client";

export type AppsAuth =
  | { access: { userId: string; superAdmin: boolean }; error?: never }
  | { access?: never; error: Response };

/** `not_linked` and `project_disabled` come only from a `?project=` read
 * (the Slides tool): the Atlas project has no OS link, or the linked OS
 * project is disabled. */
export type AppsState = ContextState | "not_linked" | "project_disabled";
export type AppsView = {
  state: AppsState;
  workspaceId: string | null;
  /** The OS project whose enable state the list reflects (a `?project=`
   * read only; null otherwise). */
  projectId?: string | null;
  apps: FlightdeckAppLink[];
  retryAfter: number | null;
};
/** The OS project an Atlas project is linked to (atlas_project_links). */
export type ProjectLink = { workspaceId: string; osProjectId: string };
/** An Atlas project id worth looking up; anything else is not linked. */
const ATLAS_PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type OsApp = OsAppsResponse["apps"][number];
const view = (
  state: AppsState,
  extra: Partial<AppsView> = {},
): AppsView => ({
  state,
  workspaceId: null,
  apps: [],
  retryAfter: null,
  ...extra,
});

export function createAppsRoute(deps: {
  authorize: () => Promise<AppsAuth>;
  reader: (fresh: boolean) => ContextReader | null;
  /** The OS origin for links ("" when not configured). */
  origin: () => string;
  /** The viewer's saved FlightDeck selection, if any. */
  selection: (userId: string) => Promise<OsSelection | null>;
  /** The OS project linked to an Atlas project, or null (not linked). */
  linkOf?: (atlasProjectId: string) => Promise<ProjectLink | null>;
}) {
  const respond = (v: AppsView) =>
    json({ ...v, checkedAt: new Date().toISOString() });
  const links = (
    origin: string,
    data: { workspaceId: string; projectId: string; apps: OsApp[] },
  ): FlightdeckAppLink[] =>
    data.apps.map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      // The OS console adopts these into its workspace/project switchers
      // (web/src/launchContext.ts), so the app opens in the context whose
      // enable state this list reflects, not the browser's last one.
      url: `${origin}${a.path}?${new URLSearchParams({
        fdWorkspace: data.workspaceId,
        fdProject: data.projectId,
      })}`,
    }));

  /** deck-atlas-link (plan 2026-09-26 R1-J1): the apps enabled in the OS
   * project LINKED to one Atlas project, read through the OS's validated
   * `?projectId=` (deck-host-launch-project), so the Slides tool's link opens
   * that project and never the workspace default.
   *
   * ⚠ Fails closed: only the Atlas Super Admin gets an answer. The link names
   * the linked OS workspace and project, which the onboarding status
   * projection (plan 2026-09-25 J4, projectStatus) withholds from everyone
   * else; anyone else gets `not_permitted` before the link is read. */
  async function appsForProject(
    access: { superAdmin: boolean },
    atlasProjectId: string,
  ) {
    if (!access.superAdmin) return respond(view("not_permitted"));
    const os = deps.reader(false);
    const origin = deps.origin();
    if (!os || !os.appsForProject || !origin || !deps.linkOf)
      return respond(view("not_configured"));
    if (!ATLAS_PROJECT_ID_RE.test(atlasProjectId))
      return respond(view("not_linked"));
    const link = await deps.linkOf(atlasProjectId);
    if (!link) return respond(view("not_linked"));
    const res = await os.appsForProject(link.workspaceId, link.osProjectId);
    if (res.state !== "ok")
      return respond(
        view(res.state, {
          workspaceId: link.workspaceId,
          projectId: link.osProjectId,
          retryAfter: res.retryAfter ?? null,
        }),
      );
    return respond(
      view("ok", {
        workspaceId: res.data.workspaceId,
        projectId: res.data.projectId,
        apps: links(origin, res.data),
      }),
    );
  }

  async function GET(request?: Request) {
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const project = request
      ? new URL(request.url).searchParams.get("project")
      : null;
    if (project !== null) return appsForProject(auth.access, project);
    const os = deps.reader(false);
    const origin = deps.origin();
    if (!os || !os.apps || !origin) return respond(view("not_configured"));
    const ws = await os.workspaces();
    if (ws.state !== "ok")
      return respond(view(ws.state, { retryAfter: ws.retryAfter ?? null }));
    let saved: OsSelection | null = null;
    try {
      saved = await deps.selection(auth.access.userId);
    } catch {
      saved = null; // a missing preference row is not an error here
    }
    // Same rule as the context switcher: a saved selection is kept even when
    // it is gone or disabled, and reported - never swapped for another
    // workspace whose apps would then be shown as if they were the selection's.
    const { workspace: target } = pickWorkspace(
      ws.data.workspaces,
      saved?.osWorkspaceId ?? null,
    );
    if (!target) return respond(view("workspace_not_found"));
    if (!target.enabled)
      return respond(view("workspace_disabled", { workspaceId: target.id }));
    const res = await os.apps(target.id);
    if (res.state !== "ok")
      return respond(
        view(res.state, {
          workspaceId: target.id,
          retryAfter: res.retryAfter ?? null,
        }),
      );
    return respond(
      view("ok", {
        workspaceId: target.id,
        apps: links(origin, res.data),
      }),
    );
  }
  return { GET };
}
