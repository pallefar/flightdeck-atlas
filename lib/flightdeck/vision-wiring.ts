import { authorize } from "../access";
import { projectFor } from "../project-access";
import { database } from "../server-projects";
import type { AccessProfile } from "../access-policy";
import type { Project, ProjectFields } from "../projects";
import { atlasInstallationId, osReader, osVision, osVisionCardConfig } from "./os-server";
import { createVisionReader, createVisionRoute, type VisionLink } from "./vision-route";
import { drainVisionSync, hasVisionSync } from "./vision-sync";
import { prepareVisionChange } from "./vision-save";

export const readVision = createVisionReader<AccessProfile>({
  projectFor,
  async links(projectId) {
    const rows = await database().prepare("SELECT installation_id,os_instance_id,workspace_id,os_project_id,access_state FROM atlas_project_links WHERE atlas_project_id=?").bind(projectId).all<{ installation_id: string; os_instance_id: string; workspace_id: string; os_project_id: string; access_state: string }>();
    return rows.results.map((r): VisionLink => ({ installationId: r.installation_id, osInstanceId: r.os_instance_id, workspaceId: r.workspace_id, osProjectId: r.os_project_id, accessState: r.access_state }));
  },
  installationId: atlasInstallationId, reader: () => osReader(true), vision: osVision,
  openUrl: () => osVisionCardConfig()?.url ?? null,
});
export const visionRoute = createVisionRoute({ authorize: () => authorize("projects.read"), read: readVision, syncPending: (_access, id) => hasVisionSync(database(), id) });

export async function prepareVisionSave(access: AccessProfile, previous: Project, next: ProjectFields) {
  return prepareVisionChange(previous, next, { read: () => readVision(access, previous.id), client: osVision });
}
export async function retryVisionSync(access: AccessProfile, projectId: string) {
  const read = await readVision(access, projectId);
  const client = osVision();
  return read.state === "ok" && client ? drainVisionSync(database(), projectId, read.link, client, read.projection) : false;
}
