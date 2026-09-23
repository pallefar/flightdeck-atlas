import { onboardRoute } from "@/lib/flightdeck/onboard-server";
export const dynamic = "force-dynamic";

// Closes an unconfirmed send (Atlas Super Admin only, same-origin), so the
// project can be sent again. Nothing is sent to FlightDeck. The rules live in
// lib/flightdeck/onboard-route.ts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardRoute.CLOSE(request, (await params).id);
}
