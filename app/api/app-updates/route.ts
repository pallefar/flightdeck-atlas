import { json } from "@/lib/http";
import { updatePayload } from "@/lib/app-updates";
export const dynamic = "force-dynamic";

// Is there a newer Atlas app than the one asking? The caller names its version;
// without one the route refuses (UPDATES_NOT_CONFIGURED) rather than guess.
export async function GET(request: Request) {
  const version = new URL(request.url).searchParams.get("version");
  return json(updatePayload(version), 200);
}
