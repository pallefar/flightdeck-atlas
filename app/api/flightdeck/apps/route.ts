import { authorize } from "@/lib/access";
import { database } from "@/lib/server-projects";
import { createAppsRoute } from "@/lib/flightdeck/apps-route";
import { preferenceSelectionStore } from "@/lib/flightdeck/context-route";
import {
  atlasInstallationId,
  osOrigin,
  osReader,
  osWhoami,
} from "@/lib/flightdeck/os-server";
export const dynamic = "force-dynamic";

// Read-only: the FlightDeck OS sub-apps for the 9-dot app menu, and with
// ?project=<Atlas project id> those of the OS project linked to it (the
// project Slides tool), and with ?mode=discovery the apps a requester can ask
// for (the OS allowlisted app catalog). The rules live in lib/flightdeck/apps-route.ts; this
// file only wires the Worker.
const store = preferenceSelectionStore(database);
const route = createAppsRoute({
  authorize: () => authorize("projects.read"),
  reader: osReader,
  origin: osOrigin,
  selection: (userId) => store.load(userId),
  whoami: () => osWhoami(false),
  async linkOf(atlasProjectId) {
    const installationId = atlasInstallationId();
    if (!installationId) return null;
    const row = await database()
      .prepare(
        "SELECT os_instance_id, workspace_id, os_project_id FROM atlas_project_links WHERE installation_id=? AND atlas_project_id=?",
      )
      .bind(installationId, atlasProjectId)
      .first<{
        os_instance_id: string;
        workspace_id: string;
        os_project_id: string;
      }>();
    // The instance id is kept so the route can refuse a link recorded on
    // another FlightDeck instance than the configured one.
    return row
      ? {
          osInstanceId: row.os_instance_id,
          workspaceId: row.workspace_id,
          osProjectId: row.os_project_id,
        }
      : null;
  },
});

export function GET(request: Request) {
  return route.GET(request);
}
