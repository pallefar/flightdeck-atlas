// The dev-only PageDoc fixture route, served at /__pagedoc-fixtures/<name>
// (the folder is %5F%5F because an "_" folder is private in the app router).
// It renders one accepted conformance fixture from the lib/pagedoc mirror,
// server-rendered and then hydrated with stub adapters (fixture-view.tsx), for
// tests/pagedoc-conformance.spec.ts. ?locale=en|de, ?theme=default|calm|accent.
// FAILS CLOSED: a 404 unless NODE_ENV is exactly "development".
import { notFound } from "next/navigation";
import { pagedocFixturesEnabled } from "@/lib/pagedoc-fixtures";
import { DOC_FIXTURES } from "@/lib/pagedoc/fixtures/index.js";
// schema only: the renderer (a client component tree with a class error
// boundary) must not be imported into this server component
import { PAGEDOC_THEME_VALUES, parsePageDoc } from "@/lib/pagedoc/schema/index.js";
// the client view lives outside this folder: Vite would decode %5F in its module URL and 404 it
import FixtureView from "../../pagedoc-fixture-view";

export const dynamic = "force-dynamic";

export default async function PageDocFixture({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!pagedocFixturesEnabled(process.env.NODE_ENV)) notFound();
  const { name } = await params;
  const query = await searchParams;
  const fixture = DOC_FIXTURES.find((f) => f.name === name && f.expect === "ok");
  if (!fixture) notFound();
  const read = parsePageDoc(fixture.doc);
  if (!read.ok) notFound();
  const locale = query.locale === "de" ? "de" : "en";
  const theme = (PAGEDOC_THEME_VALUES as readonly string[]).includes(String(query.theme))
    ? (query.theme as (typeof PAGEDOC_THEME_VALUES)[number])
    : undefined;
  return (
    <main data-pagedoc-fixture={name} style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      <h1 style={{ fontSize: "1.25rem", margin: "0 0 16px" }}>PageDoc fixture: {name}</h1>
      <FixtureView doc={read.doc} locale={locale} theme={theme} />
    </main>
  );
}
