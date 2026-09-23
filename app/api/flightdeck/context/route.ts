import { authorize } from "@/lib/access";
import { database } from "@/lib/server-projects";
import {
  createContextRoute,
  preferenceSelectionStore,
} from "@/lib/flightdeck/context-route";
import { osReader } from "@/lib/flightdeck/os-server";
export const dynamic = "force-dynamic";

// Read-only FlightDeck OS workspace/project context; the handlers and their
// rules live in lib/flightdeck/context-route.ts. Onboarding (../onboard)
// shares this route's OS reader and rate-limit cache; import stays
// disconnected (../import).
const route = createContextRoute({
  authorize: () => authorize("projects.read"),
  reader: osReader,
  store: preferenceSelectionStore(database),
});

export function GET() {
  return route.GET();
}
export function PUT(request: Request) {
  return route.PUT(request);
}
