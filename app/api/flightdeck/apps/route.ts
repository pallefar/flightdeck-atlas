import { authorize } from "@/lib/access";
import { database } from "@/lib/server-projects";
import { createAppsRoute } from "@/lib/flightdeck/apps-route";
import { preferenceSelectionStore } from "@/lib/flightdeck/context-route";
import { osOrigin, osReader } from "@/lib/flightdeck/os-server";
export const dynamic = "force-dynamic";

// Read-only: the FlightDeck OS sub-apps for the 9-dot app menu. The rules
// live in lib/flightdeck/apps-route.ts; this file only wires the Worker.
const store = preferenceSelectionStore(database);
const route = createAppsRoute({
  authorize: () => authorize("projects.read"),
  reader: osReader,
  origin: osOrigin,
  selection: (userId) => store.load(userId),
});

export function GET() {
  return route.GET();
}
