import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

/** The workflow draft: the body must match its contract, and the brain carries it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return onboardingRoutes.workflowPut(request, (await params).id);
}
