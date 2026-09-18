import { authorize } from "@/lib/access";
import { canChangeProject } from "@/lib/access-policy";
import { json, sameOrigin, database } from "@/lib/server-projects";
import { projectFor } from "@/lib/project-access";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const p = await projectFor(auth.access, id);
    if (!p) return json({ error: "Project not found." }, 404);
    if (!p.rights.edit)
      return json({ error: "You cannot onboard this project." }, 403);
    return json(
      {
        error:
          "FlightDeck creation is waiting for the SDK connection. No OS project has been created. Any saved onboarding draft remains in Atlas.",
        code: "flightdeck_not_connected",
      },
      503,
    );
  } catch {
    return json({ error: "Project storage is unavailable." }, 503);
  }
}
