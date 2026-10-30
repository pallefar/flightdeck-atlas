import { json } from "@/lib/http";
import { updatePayload, updatePayloadFrom, type Release } from "@/lib/app-updates";
export const dynamic = "force-dynamic";

// Is there a newer Atlas app than the one asking? The caller names its version;
// without one the route refuses (UPDATES_NOT_CONFIGURED) rather than guess.
//
// The releases normally come from this deployment's own app-updates.json. When
// ATLAS_UPDATE_FEED names the central updater's feed, that is authoritative
// instead — the OS announces its apps, not each app to itself. A feed that
// cannot be read falls back to the local file and says so; it never turns into
// "you are up to date".
export async function GET(request: Request) {
  const version = new URL(request.url).searchParams.get("version");
  const feed = process.env.ATLAS_UPDATE_FEED;
  if (feed && /^https:\/\//.test(feed)) {
    try {
      const response = await fetch(feed, { headers: { accept: "application/json" } });
      if (response.ok) {
        const body = (await response.json()) as { releases?: Release[] };
        const remote = updatePayloadFrom(body.releases ?? [], version, "feed");
        return json(remote, 200);
      }
    } catch {
      // fall through to the local file
    }
  }
  const local = updatePayload(version);
  return json({ ...local, ...(feed ? { source: "local_fallback" } : {}) }, 200);
}
