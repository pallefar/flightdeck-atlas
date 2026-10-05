import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { sameOrigin } from "@/lib/server-projects";
import { retryVisionSync } from "@/lib/flightdeck/vision-wiring";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  const projectId = new URL(request.url).searchParams.get("project") ?? "";
  const project = await projectFor(auth.access, projectId);
  if (!project?.rights.edit) return Response.json({ error: "Project not found." }, { status: 404 });
  const synced = await retryVisionSync(auth.access, projectId);
  return Response.json({ synced }, { status: synced ? 200 : 409, headers: { "Cache-Control": "private, no-store" } });
}
