import { authorize } from "@/lib/access";
import { suiteLinks } from "@/lib/suite/apps";
import { json } from "@/lib/http";
export const dynamic = "force-dynamic";

// The suite, for a project: every app Atlas can reach, and every app it cannot
// yet because no URL is configured. No URL is ever guessed here.
export async function GET(request: Request) {
  const auth = await authorize("onboarding.view", false, request);
  if (auth.error) return auth.error;
  const projectId = new URL(request.url).searchParams.get("project") ?? "";
  if (!projectId)
    return json({ error: "Name the project.", code: "project_required" }, 400);
  return json({ apps: suiteLinks(process.env, projectId) });
}
