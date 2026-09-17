import { authorize } from "@/lib/access";
import { json } from "@/lib/server-projects";
import { newsSources, parseFeed, type NewsItem } from "@/lib/ai-news";
export const dynamic = "force-dynamic";
let cache: {
  items: NewsItem[];
  checkedAt: string;
  unavailable: string[];
  stale: boolean;
} | null = null;
let cachedAt = 0;
export async function GET() {
  const auth = await authorize("ideas.use");
  if (auth.error) return auth.error;
  if (cache && Date.now() - cachedAt < 30 * 60 * 1000) return json(cache);
  const results = await Promise.allSettled(
    newsSources.map(async (source) => {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "Atlas/1.0 (AI news reader)",
        },
      });
      if (!response.ok) throw Error("Feed unavailable");
      const xml = await response.text();
      if (xml.length > 2_000_000) throw Error("Feed too large");
      const items = parseFeed(xml, source);
      if (!items.length) throw Error("No readable news");
      return items;
    }),
  );
  const items = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );
  const unavailable = results.flatMap((r, i) =>
    r.status === "rejected" ? [newsSources[i].name] : [],
  );
  if (!items.length && cache)
    return json({ ...cache, unavailable, stale: true });
  cache = {
    items: items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    checkedAt: new Date().toISOString(),
    unavailable,
    stale: false,
  };
  cachedAt = Date.now();
  return json(cache);
}
