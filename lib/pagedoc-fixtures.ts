// The dev-only PageDoc fixture route (pages-atlas-conformance; not part of the
// lib/pagedoc mirror). /__pagedoc-fixtures/<name> renders one conformance
// fixture from lib/pagedoc/fixtures, hydrated with stub adapters, so
// tests/pagedoc-conformance.spec.ts can check hydration, keyboard interaction,
// contrast and forced colours in Atlas's own page. The fixtures are synthetic,
// but the route is a test surface, not a product one: it FAILS CLOSED and is
// served only when NODE_ENV is exactly "development" (a production build, a
// test run or an unset NODE_ENV all get a 404).

export const PAGEDOC_FIXTURE_ROUTE = "/__pagedoc-fixtures";

export function pagedocFixturesEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development";
}

/** Where the stub media adapter points every media item (a placeholder image). */
export function pagedocFixtureMediaUrl(mediaId: string): string {
  return `${PAGEDOC_FIXTURE_ROUTE}/media/${encodeURIComponent(mediaId)}`;
}
