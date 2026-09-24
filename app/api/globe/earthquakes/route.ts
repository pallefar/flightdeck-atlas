import { authorize } from "@/lib/access";
import { json } from "@/lib/server-projects";
export const dynamic = "force-dynamic";
// The fields read from a USGS GeoJSON feature; every value is re-checked below.
type UsgsFeature = {
  id?: unknown;
  geometry?: { coordinates?: number[] } | null;
  properties: { mag: number; place?: string | null; time?: number; url?: unknown };
};
export async function GET() {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const r = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
      {
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json" },
        cf: { cacheTtl: 300, cacheEverything: true },
      },
    );
    if (!r.ok) throw Error();
    const raw = await r.text();
    if (raw.length > 8000000) throw Error();
    const b = JSON.parse(raw);
    if (!Array.isArray(b.features)) throw Error();
    return json({
      source: "USGS",
      updatedAt: new Date().toISOString(),
      events: b.features.slice(0, 3000).flatMap((f: UsgsFeature) => {
        const [longitude, latitude, depth] = f.geometry?.coordinates || [];
        const p = f.properties;
        if (
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(p?.mag) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180
        )
          return [];
        return [
          {
            id: String(f.id).slice(0, 100),
            longitude,
            latitude,
            depth,
            magnitude: p.mag,
            place: String(p.place || "Reported event").slice(0, 200),
            time: p.time,
            url:
              typeof p.url === "string" &&
              p.url.startsWith("https://earthquake.usgs.gov/")
                ? p.url
                : null,
          },
        ];
      }),
    });
  } catch {
    return json(
      { error: "USGS is unavailable. No current event data can be shown." },
      503,
    );
  }
}
