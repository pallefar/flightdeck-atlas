import { onboardRoute } from "@/lib/flightdeck/onboard-server";
export const dynamic = "force-dynamic";

// Stored onboarding stages for the projects the caller can see. Never reads
// the OS.
export function GET() {
  return onboardRoute.LIST();
}
