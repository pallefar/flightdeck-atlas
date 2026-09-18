import { env } from "cloudflare:workers";
import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { database, json, sameOrigin } from "@/lib/server-projects";
export const dynamic = "force-dynamic";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const projectId = (await params).id,
      p = await projectFor(a.access, projectId);
    if (!p) return json({ error: "Project not found." }, 404);
    if (!p.rights.edit)
      return json({ error: "Editing permission is required." }, 403);
    if (!env.BUCKET)
      return json({ error: "File storage is unavailable." }, 503);
    if (Number(req.headers.get("content-length")) > 11000000)
      return json({ error: "Files must be under 10 MB." }, 400);
    const form = await req.formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > 10000000 || !file.size)
      return json({ error: "Choose a file up to 10 MB." }, 400);
    const id = crypto.randomUUID(),
      name =
        file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 160) || "attachment";
    await env.BUCKET.put(`attachments/${id}`, file.stream());
    try {
      await database()
        .prepare(
          "INSERT INTO atlas_files(id,project_id,name,mime,size,author,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          projectId,
          name,
          file.type || "application/octet-stream",
          file.size,
          a.access.email,
          new Date().toISOString(),
        )
        .run();
    } catch (e) {
      await env.BUCKET.delete(`attachments/${id}`);
      throw e;
    }
    return json({ success: true });
  } catch {
    return json({ error: "Upload failed. Please try again." }, 503);
  }
}
