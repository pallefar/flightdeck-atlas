import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Reserve a hand-off (KG, DiagramForge, Studio, Companion). The body and its
// idempotency key are stored before anything leaves Atlas; the transport is
// added by the repository that owns each contract.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.handoffCreate(request, (await params).id);
}
