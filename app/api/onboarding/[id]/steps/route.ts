import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

/** The process steps: the body must match its contract, and the brain carries it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return onboardingRoutes.stepsPut(request, (await params).id);
}
