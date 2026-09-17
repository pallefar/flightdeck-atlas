import { authorize } from "@/lib/access";
import { json, sameOrigin } from "@/lib/server-projects";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize("projects.create");
  if (auth.error) return auth.error;
  return json(
    {
      error:
        "FlightDeck import is waiting for the SDK connection. No project has been imported.",
      code: "flightdeck_not_connected",
    },
    503,
  );
}
