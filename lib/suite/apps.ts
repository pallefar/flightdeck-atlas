/**
 * The FlightDeck OS suite, as Atlas sees it.
 *
 * Atlas is the front door: it starts the work, records the sign-offs and hands
 * off to the app that does the doing. Every URL is configuration — an app that
 * has no URL configured is reported as such, never guessed. `{project}` in a
 * template is replaced with the project id.
 */
export type SuiteApp = {
  key: "teoa" | "pdf" | "maps" | "studio" | "vision";
  title: string;
  purpose: string;
  env: string;
};
export const SUITE_APPS: readonly SuiteApp[] = [
  { key: "teoa", title: "TEOA Advantage", purpose: "Value streams, scorecards and improvement work.", env: "ATLAS_TEOA_URL" },
  { key: "pdf", title: "PDF app", purpose: "The documents the process runs on.", env: "ATLAS_PDF_URL" },
  { key: "maps", title: "FlightDeck Maps", purpose: "The as-is and to-be maps.", env: "ATLAS_MAPS_URL" },
  { key: "studio", title: "FlightDeck Studio", purpose: "Complex workflows, built and owned there.", env: "ATLAS_STUDIO_URL" },
  { key: "vision", title: "Vision", purpose: "The objective the outcome serves.", env: "ATLAS_VISION_URL" },
];

/** A template with `{project}` filled in, or null when it is not configured. */
export function resolvedSuiteURL(template: string | undefined, projectId: string): string | null {
  const value = (template ?? "").trim();
  if (!value) return null;
  const filled = value.replaceAll("{project}", encodeURIComponent(projectId));
  try {
    const url = new URL(filled);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Every suite app and whether Atlas can reach it for this project. */
export function suiteLinks(
  env: Record<string, string | undefined>,
  projectId: string,
): { key: SuiteApp["key"]; title: string; purpose: string; url: string | null }[] {
  return SUITE_APPS.map((app) => ({
    key: app.key,
    title: app.title,
    purpose: app.purpose,
    url: resolvedSuiteURL(env[app.env], projectId),
  }));
}
