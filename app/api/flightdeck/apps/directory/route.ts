import { authorize } from "@/lib/access";
import { database } from "@/lib/server-projects";
import { createAppsDirectoryRoute } from "@/lib/flightdeck/apps-directory-route";
import { preferenceSelectionStore } from "@/lib/flightdeck/context-route";
import { osDirectory, osOrigin } from "@/lib/flightdeck/os-server";
export const dynamic = "force-dynamic";

// Read-only: the FlightDeck OS apps directory for the viewer's SELECTED OS
// project (apps-32). The rules live in lib/flightdeck/apps-directory-route.ts;
// this file only wires the Worker. /api/flightdeck/apps is unchanged.
const store = preferenceSelectionStore(database);
const route = createAppsDirectoryRoute({
  authorize: () => authorize("projects.read"),
  os: osDirectory,
  origin: osOrigin,
  selection: (userId) => store.load(userId),
});

export function GET(request: Request) {
  return route.GET(request);
}
