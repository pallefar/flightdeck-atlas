import type { Project } from "./projects";
export async function freshProject(id: string): Promise<Project> {
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}`),
    b = (await r.json()) as { project: Project; error: string };
  if (!r.ok)
    throw Error(b.error || "Project access changed. Reload before exporting.");
  return b.project;
}
export async function freshProjects(): Promise<Project[]> {
  const r = await fetch("/api/projects"),
    b = (await r.json()) as { projects: Project[]; error: string };
  if (!r.ok)
    throw Error(b.error || "Project access changed. Reload before exporting.");
  return b.projects;
}
