import type { ContextReader, VisionClient } from "./context-client";
import { visionProjectionSchema, type VisionProjection } from "./vision";
import { isVisionOwner, type VisionViewer } from "./vision-card";

export type VisionLink = { installationId: string; osInstanceId: string; workspaceId: string; osProjectId: string; accessState: string };
export type VisionRead = { state: "ok"; link: VisionLink; projection: VisionProjection; openUrl: string | null } | { state: "not_linked" | "unavailable"; reason?: string };
export function createVisionReader<A extends VisionViewer>(deps: {
  projectFor: (access: A, projectId: string) => Promise<unknown>;
  links: (projectId: string) => Promise<VisionLink[]>;
  installationId: () => string | null;
  reader: () => ContextReader | null;
  vision: () => VisionClient | null;
  openUrl: () => string | null;
}) {
  return async (access: A, projectId: string): Promise<VisionRead> => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !(await deps.projectFor(access, projectId))) return { state: "unavailable", reason: "not_found" };
    const links = await deps.links(projectId);
    if (!links.length) return { state: "not_linked" };
    const installationId = deps.installationId();
    const link = links.find((row) => row.installationId === installationId);
    if (!link || link.accessState !== "active") return { state: "unavailable", reason: "link_mismatch" };
    const reader = deps.reader(), client = deps.vision();
    if (!reader || !client) return { state: "unavailable", reason: "not_configured" };
    const contexts = await reader.workspaces();
    if (contexts.state !== "ok") return { state: "unavailable", reason: contexts.state };
    if (!contexts.data.instanceId || contexts.data.instanceId !== link.osInstanceId || !contexts.data.workspaces.some((row) => row.id === link.workspaceId)) return { state: "unavailable", reason: "link_mismatch" };
    const result = await client.projection(link.workspaceId, link.osProjectId);
    if (result.state !== "ok") return { state: "unavailable", reason: result.state };
    const parsed = visionProjectionSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.workspaceId !== link.workspaceId || parsed.data.projectId !== link.osProjectId) return { state: "unavailable", reason: "invalid_response" };
    const checked = Date.parse(parsed.data.checkedAt), now = Date.now();
    if (now - checked > 5 * 60_000 || checked - now > 60_000) return { state: "unavailable", reason: "stale_response" };
    let openUrl: string | null = null;
    const configured = isVisionOwner(access) ? deps.openUrl() : null;
    if (configured) {
      const url = new URL(configured);
      url.searchParams.set("standalone", "1");
      url.searchParams.set("fdWorkspace", link.workspaceId);
      url.searchParams.set("fdProject", link.osProjectId);
      openUrl = url.href;
    }
    return { state: "ok", link, projection: parsed.data, openUrl };
  };
}

export function createVisionRoute<A extends VisionViewer>(deps: {
  authorize: () => Promise<{ access: A; error?: never } | { error: Response; access?: never }>;
  read: (access: A, projectId: string) => Promise<VisionRead>;
  syncPending?: (access: A, projectId: string) => Promise<boolean>;
}) {
  return {
    async GET(request: Request) {
      const site = request.headers.get("sec-fetch-site"), origin = request.headers.get("origin");
      if ((site && site !== "same-origin" && site !== "none") || (origin && origin !== new URL(request.url).origin)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
      const auth = await deps.authorize();
      if (auth.error) return auth.error;
      const projectId = new URL(request.url).searchParams.get("project") ?? "";
      try {
        const view = await deps.read(auth.access, projectId);
        if (view.state === "unavailable" && view.reason === "not_found") return Response.json({ error: "Project not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
        const syncing = view.state === "ok" && deps.syncPending ? await deps.syncPending(auth.access, projectId) : false;
        return Response.json(view.state === "ok"
          ? { state: "ok", projection: view.projection, openUrl: view.openUrl, syncPending: syncing }
          : view, { headers: { "Cache-Control": "private, no-store" } });
      } catch {
        return Response.json({ state: "unavailable", reason: "check_failed" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
    },
  };
}
