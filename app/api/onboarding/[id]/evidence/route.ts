import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Attach one evidence item's metadata. A blocked classification or a blocking
// scan is refused before anything is stored (PRD §9 G-1/G-2).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.evidenceAdd(request, (await params).id);
}
