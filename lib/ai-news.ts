export type NewsItem = {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
};
export const newsSources = [
  {
    name: "OpenAI",
    url: "https://openai.com/news/rss.xml",
    home: "https://openai.com/news/",
    host: "openai.com",
  },
  {
    name: "Google AI",
    url: "https://blog.google/innovation-and-ai/technology/ai/rss/",
    home: "https://blog.google/innovation-and-ai/technology/ai/",
    host: "blog.google",
  },
  {
    name: "Google DeepMind",
    url: "https://deepmind.google/blog/rss.xml",
    home: "https://deepmind.google/blog/",
    host: "deepmind.google",
  },
];
function plain(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const code =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
export function parseFeed(
  xml: string,
  source: (typeof newsSources)[number],
  now = Date.now(),
): NewsItem[] {
  const items: NewsItem[] = [];
  for (const entry of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (name: string) =>
      plain(
        entry[1].match(
          new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"),
        )?.[1] || "",
      );
    const title = field("title"),
      url = field("link"),
      date = new Date(field("pubDate"));
    try {
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        !(u.hostname === source.host || u.hostname.endsWith(`.${source.host}`))
      )
        continue;
    } catch {
      continue;
    }
    if (
      !title ||
      !Number.isFinite(date.getTime()) ||
      date.getTime() > now + 3600000
    )
      continue;
    items.push({
      title: title.slice(0, 220),
      url,
      publishedAt: date.toISOString(),
      source: source.name,
    });
  }
  return items
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 5);
}
