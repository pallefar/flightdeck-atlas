import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { projectSchema, type Project, type ProjectFields } from "./projects";
export function database() {
  if (!env.DB)
    throw new Error(
      "Project storage is unavailable. Please try again shortly.",
    );
  return env.DB;
}
export async function owner() {
  const user = await getChatGPTUser();
  return user?.userId || null;
}
export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    (!origin || origin === new URL(request.url).origin)
  );
}
export async function readFields(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Send a JSON project.");
  const raw = await request.text();
  if (raw.length > 100_000) throw new Error("This project is too large.");
  const body = JSON.parse(raw);
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Check your project details.",
    );
  if (
    new Set(parsed.data.tasks.map((t) => t.id)).size !==
    parsed.data.tasks.length
  )
    throw new Error("Task IDs must be unique.");
  return { fields: parsed.data, revision: body.revision };
}
export function fromRow(row: Record<string, unknown>): Project {
  return {
    ...JSON.parse(row.data as string),
    id: row.id,
    source: row.source,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}
export function newProject(fields: ProjectFields): Project {
  return {
    ...fields,
    id: crypto.randomUUID(),
    source: "atlas",
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
}
