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
import type { ContextState, FlightdeckAppLink, OsSelection } from "./context";
import type { ContextReader } from "./context-client";

export type AppsAuth =
  | { access: { userId: string; superAdmin: boolean }; error?: never }
  | { access?: never; error: Response };

export type AppsView = {
  state: ContextState;
  workspaceId: string | null;
  apps: FlightdeckAppLink[];
  retryAfter: number | null;
};

const view = (
  state: ContextState,
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
}) {
  const respond = (v: AppsView) =>
    json({ ...v, checkedAt: new Date().toISOString() });

  async function GET() {
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
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
    const list = ws.data.workspaces;
    const target =
      list.find((w) => w.id === saved?.osWorkspaceId && w.enabled) ??
      list.find((w) => w.isDefault && w.enabled) ??
      list.find((w) => w.enabled);
    if (!target) return respond(view("workspace_not_found"));
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
        apps: res.data.apps.map((a) => ({
          id: a.id,
          label: a.label,
          icon: a.icon,
          url: origin + a.path,
        })),
      }),
    );
  }
  return { GET };
}
