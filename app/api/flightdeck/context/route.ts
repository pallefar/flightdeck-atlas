import { env } from "cloudflare:workers";
import { authorize } from "@/lib/access";
import { database } from "@/lib/server-projects";
import {
  createCachedReader,
  createContextClient,
  readContextConfig,
  type ContextResult,
} from "@/lib/flightdeck/context-client";
import {
  createContextRoute,
  preferenceSelectionStore,
} from "@/lib/flightdeck/context-route";
export const dynamic = "force-dynamic";

// Read-only FlightDeck OS workspace/project context; the handlers and their
// rules live in lib/flightdeck/context-route.ts. Import/onboard stay
// disconnected (see ../import, ../onboard).
const cache = new Map<
  string,
  { until: number; value?: ContextResult<unknown> }
>();

const route = createContextRoute({
  authorize: () => authorize("projects.read"),
  reader(fresh) {
    const config = readContextConfig({
      url: env.ATLAS_FLIGHTDECK_URL,
      token: env.ATLAS_FLIGHTDECK_INBOUND_TOKEN,
    });
    return config
      ? createCachedReader(createContextClient(config), cache, { fresh })
      : null;
  },
  store: preferenceSelectionStore(database),
});

export function GET() {
  return route.GET();
}
export function PUT(request: Request) {
  return route.PUT(request);
}
