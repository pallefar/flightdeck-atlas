import { onboardRoute } from "@/lib/flightdeck/onboard-server";
export const dynamic = "force-dynamic";

// Stored onboarding stages for the projects the caller can see. With
// ?refresh=1 (same-origin, Atlas Super Admin only) it first reads back a few
// due sends from FlightDeck; the rules live in lib/flightdeck/onboard-route.ts.
export function GET(request: Request) {
  return onboardRoute.LIST(request);
}
