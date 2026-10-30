import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

/** A receipt from Studio, Maps, Advantage, the PDF app or Vision: what was
 * built, by version. This is the return half of a hand-off. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return onboardingRoutes.receiptAdd(request, (await params).id);
}
