import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Add one value record (baseline, 30 or 90 days). A measured record without a
// source is refused.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.valueAdd(request, (await params).id);
}
