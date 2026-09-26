import { crmRoute } from "@/lib/flightdeck/crm-wiring";
export const dynamic = "force-dynamic";

// Read-only: the CRM revision of ONE Atlas project's linked OS project, for
// the card's 60-second poll. The rules live in lib/flightdeck/crm-route.ts.
export function GET(request: Request) {
  return crmRoute.revision(request);
}
