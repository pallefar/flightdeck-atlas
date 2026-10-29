import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// Add or change one person's workspace role. Only the Super Admin makes an
// admin; a workspace admin may add members.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return onboardingRoutes.workspaceMemberAdd(request, (await params).id);
}
