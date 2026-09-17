import { authorize } from "@/lib/access";
import { json } from "@/lib/server-projects";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  // Replace only after delegated SDK identity, per-project read filtering and durable links exist.
  return json({
    connected: false,
    reason:
      "FlightDeck is not connected yet. Accessible OS projects will appear here after the SDK connection is enabled.",
  });
}
