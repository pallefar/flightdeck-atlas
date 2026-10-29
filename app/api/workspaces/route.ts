import { onboardingRoutes } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";

// The workspaces this actor may see (all of them for the Super Admin), and the
// Super Admin's workspace create. Rules live in lib/onboarding/routes.ts.
export async function GET(request: Request) {
  return onboardingRoutes.workspacesList(request);
}
export async function POST(request: Request) {
  return onboardingRoutes.workspaceCreate(request);
}
