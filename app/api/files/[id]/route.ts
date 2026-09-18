import { env } from "cloudflare:workers";
import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { database, json, sameOrigin } from "@/lib/server-projects";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const id = (await params).id,
      file = await database()
        .prepare("SELECT * FROM atlas_files WHERE id=?")
        .bind(id)
        .first();
    if (!file || !(await projectFor(a.access, file.project_id as string)))
      return json({ error: "File not found." }, 404);
    const obj = await env.BUCKET?.get(`attachments/${id}`);
    if (!obj) return json({ error: "File is unavailable." }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name as string)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return json({ error: "Download unavailable." }, 503);
  }
}
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const id = (await params).id,
      file = await database()
        .prepare("SELECT * FROM atlas_files WHERE id=?")
        .bind(id)
        .first(),
      p = file ? await projectFor(a.access, file.project_id as string) : null;
    if (!file || !p) return json({ error: "File not found." }, 404);
    if (!p.rights.edit)
      return json({ error: "Editing permission required." }, 403);
    await database()
      .prepare("DELETE FROM atlas_files WHERE id=?")
      .bind(id)
      .run();
    await env.BUCKET?.delete(`attachments/${id}`);
    return json({ success: true });
  } catch {
    return json({ error: "File could not be removed." }, 503);
  }
}
