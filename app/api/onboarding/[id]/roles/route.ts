import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// The assignment step: owner, process owner and the two alignment approvers.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.rolesAssign(request, (await params).id);
}
