import { crmRoute } from "@/lib/flightdeck/crm-wiring";
export const dynamic = "force-dynamic";

// Read-only: the FlightDeck OS CRM projection for ONE Atlas project
// (?project=<Atlas project id>), read through the project's STORED link.
// The rules live in lib/flightdeck/crm-route.ts.
export function GET(request: Request) {
  return crmRoute.GET(request);
}
