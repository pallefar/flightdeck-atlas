import { onboardRoute } from "@/lib/flightdeck/onboard-server";
export const dynamic = "force-dynamic";

// Atlas -> FlightDeck OS onboarding for one project: POST sends it for OS
// review (Atlas Super Admin only, same-origin), GET reads its status. The
// handlers and their rules live in lib/flightdeck/onboard-route.ts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardRoute.POST(request, (await params).id);
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardRoute.GET(request, (await params).id);
}
