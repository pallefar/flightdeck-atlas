import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Pass, reject or reopen one stage gate. The gate's role, the stage order and
// every prerequisite are enforced in lib/onboarding/routes.ts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.gate(request, (await params).id);
}
