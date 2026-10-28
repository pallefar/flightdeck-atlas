import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Record the reuse check: what was searched, what matched, and the decision
// with its reason (reuse / extend / new).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.reuse(request, (await params).id);
}
