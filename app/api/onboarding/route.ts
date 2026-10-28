import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// The pipeline board's list: every onboarding project the caller may read.
// The handler and its rules live in lib/onboarding/routes.ts.
export async function GET() {
  return onboardingRoutes.list();
}
