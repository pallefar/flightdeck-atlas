import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

/** Every deferred sign-off the caller can see, late ones first. */
export async function GET(request: Request) {
  return onboardingRoutes.deferredList(request);
}
