import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// One project's brain: GET the composed view (record, stage requirements,
// chain state, evidence, value, reuse) and PATCH its editable fields. A save
// must name the revision it was made against.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.get((await params).id);
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.patch(request, (await params).id);
}
