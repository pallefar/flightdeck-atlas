// The dev-only fixture route's placeholder media (/__pagedoc-fixtures/media/<id>):
// one fixed SVG for every id, so fixture images have real bytes to load and a
// request for an id is observable. The id is never reflected into the body.
// FAILS CLOSED: a 404 unless NODE_ENV is exactly "development".
import { pagedocFixturesEnabled } from "@/lib/pagedoc-fixtures";

const PLACEHOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
  '<rect width="640" height="360" fill="#8a94a6"/><circle cx="320" cy="180" r="90" fill="#c9d1dc"/></svg>';

export function GET() {
  if (!pagedocFixturesEnabled(process.env.NODE_ENV)) return new Response("Not found", { status: 404 });
  return new Response(PLACEHOLDER, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
