import { authorize } from "@/lib/access";
import { createConnectionRoute } from "@/lib/flightdeck/connection-route";
import { osWhoami } from "@/lib/flightdeck/os-server";
export const dynamic = "force-dynamic";

// Read-only: the Connections page's one connection line, from the
// credential's whoami. The rules live in lib/flightdeck/connection-route.ts.
const route = createConnectionRoute({
  authorize: () => authorize("projects.read"),
  whoami: osWhoami,
});

export function GET(request: Request) {
  return route.GET(request);
}
