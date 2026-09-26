// Worker wiring shared by /api/flightdeck/crm and /api/flightdeck/crm/revision
// (crm-40). The rules live in lib/flightdeck/crm-route.ts.
import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { database } from "@/lib/server-projects";
import { createCrmRoute } from "./crm-route";
import {
  atlasInstallationId,
  osCrm,
  osOrigin,
  osReader,
  osWhoami,
} from "./os-server";

export const crmRoute = createCrmRoute({
  authorize: () => authorize("projects.read"),
  projectFor,
  // Every stored row of the Atlas project, whatever installation recorded
  // it, so the route can tell "not linked" from "linked by another
  // installation" and check the whole row.
  async links(atlasProjectId) {
    const rows = await database()
      .prepare(
        "SELECT installation_id, os_instance_id, workspace_id, os_project_id, access_state FROM atlas_project_links WHERE atlas_project_id=?",
      )
      .bind(atlasProjectId)
      .all<{
        installation_id: string;
        os_instance_id: string;
        workspace_id: string;
        os_project_id: string;
        access_state: string;
      }>();
    return rows.results.map((r) => ({
      installationId: r.installation_id,
      osInstanceId: r.os_instance_id,
      workspaceId: r.workspace_id,
      osProjectId: r.os_project_id,
      accessState: r.access_state,
    }));
  },
  installationId: atlasInstallationId,
  reader: () => osReader(false),
  whoami: () => osWhoami(false),
  crm: osCrm,
  origin: osOrigin,
});
