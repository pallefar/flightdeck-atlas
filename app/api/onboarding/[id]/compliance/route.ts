import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Accept a studio-compliance-record/1 back. A record that did not pass never
// marks the build as shipped.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.compliance(request, (await params).id);
}
