import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod/v4";
import { examples } from "../lib/projects";
import { createDeck } from "../lib/presentations";
import {
  canonicalJson,
  createDeckExportRoute,
  DECK_EXPORT_FORMAT,
  serializeDeckExport,
  type DeckExportDb,
} from "../lib/deck-export";

// Runs the real /api/decks/export GET handler (the same function the route
// file exports) over a SQLite database built from the real atlas_decks
// migration. Source access is supplied the way projectFor() supplies it: a
// project the caller can no longer read answers null.
const ORIGIN = "http://localhost:5173";
const URL_PATH = `${ORIGIN}/api/decks/export`;

// The OS reader of an Atlas v0 deck (flightdeck/deckdoc/migrate/atlasV0.ts,
// atlasV0Schema, fix/deck-docschema), mirrored key for key. It is strict: an
// unknown key refuses the deck. The fixture test below keeps the mirror honest.
const atlasV0Schema = z.strictObject({
  id: z.string().min(1).max(80),
  revision: z.number().int().optional(),
  updatedAt: z.string().max(80).optional(),
  canEdit: z.boolean().optional(),
  title: z.string().trim().min(1).max(120),
  audience: z.string().max(100),
  period: z.string().max(100),
  template: z.enum([
    "Leadership update",
    "Project steering",
    "Strategy & KPIs",
    "TEOA improvement",
    "Consultancy proposal",
  ]),
  shared: z.boolean().default(false),
  projectIds: z.array(z.string().max(80)).min(1).max(30),
  snapshots: z
    .array(
      z.strictObject({
        id: z.string().max(80),
        name: z.string().max(100),
        revision: z.number().int(),
        at: z.string().max(80),
      }),
    )
    .max(30),
  slides: z
    .array(
      z.strictObject({
        id: z.string().max(80),
        title: z.string().max(160),
        body: z.string().max(5000),
        notes: z.string().max(2000),
      }),
    )
    .min(1)
    .max(60),
});
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/deckdoc/atlas-v0.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

type Exported = {
  format: string;
  exportedAt: string;
  decks: (Record<string, unknown> & { id: string; checksum: string })[];
  withheld: { id: string; reason: string }[];
};

function harness(readable: string[], userId: string | null = "owner") {
  const migration = readFileSync(
    new URL("../drizzle/0002_lowly_thing.sql", import.meta.url),
    "utf8",
  );
  const table = migration.match(/CREATE TABLE `atlas_decks` \([^;]*\);/);
  if (!table) throw Error("atlas_decks migration not found");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(table[0]);
  const db: DeckExportDb = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          return {
            async all<T>() {
              return {
                results: statement.all(...(values as SQLInputValue[])) as T[],
              };
            },
          };
        },
      };
    },
  };
  const state = { userId, readable: new Set(readable), lookups: 0 };
  const route = createDeckExportRoute({
    authorize: async () =>
      state.userId
        ? { access: { userId: state.userId } }
        : {
            error: Response.json(
              { error: "Sign in to continue." },
              { status: 401 },
            ),
          },
    database: () => db,
    canReadSource: async (_access, id) => {
      state.lookups++;
      return state.readable.has(id);
    },
  });
  const insert = (
    id: string,
    owner: string,
    data: unknown,
    revision = 1,
    at = "2026-09-20T10:00:00.000Z",
  ) =>
    sqlite
      .prepare(
        "INSERT INTO atlas_decks(id,owner_id,data,revision,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(
        id,
        owner,
        typeof data === "string" ? data : JSON.stringify(data),
        revision,
        at,
      );
  return { route, state, insert, db };
}

const deckFor = (...ids: string[]) =>
  createDeck(
    ids.map((id, i) => ({ ...examples[i % examples.length], id })),
    "Leadership update",
    "QA team",
    "Current",
  );
const get = (headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(URL_PATH, { headers });
const read = async (r: Response) => (await r.json()) as Exported;
const withoutChecksum = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).filter(([k]) => k !== "checksum"));
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

test("the owner's decks export with a checksum each, no-store", async () => {
  const h = harness(["a", "b"]);
  h.insert("d1", "owner", deckFor("a", "b"), 3, "2026-09-20T10:00:00.000Z");
  h.insert("d2", "owner", deckFor("b"), 1, "2026-09-21T10:00:00.000Z");
  const r = await h.route.GET(get());
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  const b = await read(r);
  expect(b.format).toBe(DECK_EXPORT_FORMAT);
  expect(DECK_EXPORT_FORMAT).toBe("atlas-decks-v0");
  expect(b.withheld).toEqual([]);
  expect(b.decks.map((d) => d.id)).toEqual(["d2", "d1"]);
  expect(b.decks[1]).toMatchObject({
    id: "d1",
    revision: 3,
    updatedAt: "2026-09-20T10:00:00.000Z",
    projectIds: ["a", "b"],
  });
  for (const d of b.decks) {
    expect(d.checksum).toBe(sha256(canonicalJson(withoutChecksum(d))));
  }
});

test("a deck someone else owns is absent, even a shared one on a readable source", async () => {
  const h = harness(["a"]);
  h.insert("mine", "owner", deckFor("a"));
  h.insert("theirs", "someone-else", { ...deckFor("a"), shared: true });
  const b = await read(await h.route.GET(get()));
  expect(b.decks.map((d) => d.id)).toEqual(["mine"]);
  expect(b.withheld).toEqual([]);
  expect(JSON.stringify(b)).not.toContain("theirs");
});

test("a deck with a lost source project is withheld, not exported", async () => {
  const h = harness(["a"]);
  h.insert("ok", "owner", deckFor("a"), 1, "2026-09-20T10:00:00.000Z");
  h.insert(
    "lost",
    "owner",
    deckFor("a", "gone"),
    1,
    "2026-09-21T10:00:00.000Z",
  );
  h.insert("broken", "owner", "{not json", 1, "2026-09-19T10:00:00.000Z");
  const b = await read(await h.route.GET(get()));
  expect(b.decks.map((d) => d.id)).toEqual(["ok"]);
  expect(b.withheld).toEqual([
    { id: "lost", reason: "source_unavailable" },
    { id: "broken", reason: "invalid" },
  ]);
  // The report names the deck only, never which source project was lost.
  expect(JSON.stringify(b.withheld)).not.toContain("gone");
});

test("anonymous is refused with 401 and cross-origin with 403, before any read", async () => {
  const h = harness(["a"], null);
  h.insert("d1", "owner", deckFor("a"));
  expect((await h.route.GET(get())).status).toBe(401);
  h.state.userId = "owner";
  const cross = await h.route.GET(get({ origin: "https://evil.test" }));
  expect(cross.status).toBe(403);
  const site = await h.route.GET(get({ "sec-fetch-site": "cross-site" }));
  expect(site.status).toBe(403);
  expect(h.state.lookups).toBe(0);
});

test("a failing source lookup or database fails closed with 503", async () => {
  const failing = createDeckExportRoute({
    authorize: async () => ({ access: { userId: "owner" } }),
    database: () => {
      throw Error("no database");
    },
    canReadSource: async () => true,
  });
  expect((await failing.GET(get())).status).toBe(503);
  const h = harness([]);
  h.insert("d1", "owner", deckFor("a"));
  const lookupFails = createDeckExportRoute({
    authorize: async () => ({ access: { userId: "owner" } }),
    database: () => ({
      prepare: () => ({
        bind: () => ({
          all: async <T>() => ({
            results: [
              {
                id: "d1",
                data: JSON.stringify(deckFor("a")),
                revision: 1,
                updated_at: "2026-09-20T10:00:00.000Z",
              },
            ] as T[],
          }),
        }),
      }),
    }),
    canReadSource: async () => {
      throw Error("rights lookup failed");
    },
  });
  const r = await lookupFails.GET(get());
  expect(r.status).toBe(503);
  expect(JSON.stringify(await r.json())).not.toContain("slides");
});

test("the export validates against the OS Atlas v0 reader and its fixture", async () => {
  // The mirror accepts the OS fixture, so it is the same reader.
  expect(atlasV0Schema.safeParse(fixture).success).toBe(true);
  const h = harness(["atlas-proj-falcon", "atlas-proj-heron"]);
  const { id, revision, updatedAt, ...data } = fixture;
  h.insert(
    id as string,
    "owner",
    data,
    revision as number,
    updatedAt as string,
  );
  h.insert("d2", "owner", deckFor("atlas-proj-falcon"));
  const b = await read(await h.route.GET(get()));
  expect(b.decks).toHaveLength(2);
  for (const d of b.decks) {
    expect(d.checksum).toMatch(/^[0-9a-f]{64}$/);
    const deck = withoutChecksum(d);
    const parsed = atlasV0Schema.safeParse(deck);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    // Same keys as the OS fixture: nothing extra (no per-reader canEdit),
    // nothing missing.
    expect(Object.keys(deck).sort()).toEqual(Object.keys(fixture).sort());
  }
  // A stored fixture exports back to the fixture itself.
  const round = b.decks.find((d) => d.id === fixture.id)!;
  expect(withoutChecksum(round)).toEqual(fixture);
});

// The bytes the downloader saves: presentation-studio.tsx writes the
// response body through serializeDeckExport (asserted below), so this is
// the size of the file the OS import receives.
const fileBytes = (b: Exported) =>
  new TextEncoder().encode(serializeDeckExport(b)).length;

test("the Studio downloader writes the file through serializeDeckExport", () => {
  const studio = readFileSync(
    new URL("../app/presentation-studio.tsx", import.meta.url),
    "utf8",
  );
  expect(studio).toContain("new Blob([serializeDeckExport(b)]");
  expect(serializeDeckExport({ a: [1] })).toBe(
    JSON.stringify({ a: [1] }, null, 2),
  );
});

function bulkyHarness(count: number) {
  const h = harness(["a"]);
  for (let i = 0; i < count; i++) {
    const deck = deckFor("a");
    deck.slides = deck.slides.map((s) => ({ ...s, body: "x".repeat(4000) }));
    const at = `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`;
    h.insert(`d${String(i).padStart(2, "0")}`, "owner", deck, 1, at);
  }
  const capped = (maxBytes: number) =>
    createDeckExportRoute({
      authorize: async () => ({ access: { userId: "owner" } }),
      database: () => h.db,
      canReadSource: async () => true,
      maxBytes,
    });
  return { h, capped };
}

test("the downloaded file, envelope and checksums included, stays within the import limit", async () => {
  const { h, capped } = bulkyHarness(12);
  const all = await read(await h.route.GET(get()));
  expect(all.decks).toHaveLength(12);
  // What a deck-only budget counts: the canonical JSON of each deck.
  const deckOnly = all.decks
    .map(
      (d) => new TextEncoder().encode(canonicalJson(withoutChecksum(d))).length,
    )
    .reduce((x, y) => x + y, 0);
  const limit = deckOnly + 1000;
  expect(fileBytes(all)).toBeGreaterThan(limit);
  const b = await read(await capped(limit).GET(get()));
  expect(fileBytes(b)).toBeLessThanOrEqual(limit);
  expect(b.withheld.length).toBeGreaterThan(0);
  expect(b.withheld.every((w) => w.reason === "too_large")).toBe(true);
  expect(b.decks.length + b.withheld.length).toBe(12);
});

test("a file that fits exactly exports every deck; one byte less withholds the oldest as too_large", async () => {
  const { h, capped } = bulkyHarness(12);
  const all = await read(await h.route.GET(get()));
  const exact = fileBytes(all);
  const fit = await read(await capped(exact).GET(get()));
  expect(fit.decks).toHaveLength(12);
  expect(fit.withheld).toEqual([]);
  expect(fileBytes(fit)).toBe(exact);
  const over = await read(await capped(exact - 1).GET(get()));
  expect(fileBytes(over)).toBeLessThanOrEqual(exact - 1);
  expect(over.decks.map((d) => d.id)).toEqual(
    all.decks.slice(0, 11).map((d) => d.id),
  );
  expect(over.withheld).toEqual([{ id: "d00", reason: "too_large" }]);
});

test("a too_large entry added after the budget filled still leaves the file within the limit", async () => {
  const { h, capped } = bulkyHarness(12);
  const all = await read(await h.route.GET(get()));
  // Exactly the file of the 11 newest decks with nothing withheld: the
  // oldest then no longer fits, and its withheld entry itself adds bytes.
  const limit = fileBytes({ ...all, decks: all.decks.slice(0, 11) });
  const b = await read(await capped(limit).GET(get()));
  expect(fileBytes(b)).toBeLessThanOrEqual(limit);
  expect(b.decks.map((d) => d.id)).toEqual(
    all.decks.slice(0, 10).map((d) => d.id),
  );
  expect(b.withheld).toEqual([
    { id: "d00", reason: "too_large" },
    { id: "d01", reason: "too_large" },
  ]);
});

test("a deck whose identity the OS reader would refuse is withheld as invalid, not exported", async () => {
  const h = harness(["a"]);
  const longId = "x".repeat(81);
  h.insert("ok", "owner", deckFor("a"), 1, "2026-09-22T10:00:00.000Z");
  h.insert(longId, "owner", deckFor("a"), 1, "2026-09-21T10:00:00.000Z");
  h.insert("long-at", "owner", deckFor("a"), 1, `2026-09-20T${"0".repeat(80)}`);
  const b = await read(await h.route.GET(get()));
  expect(b.decks.map((d) => d.id)).toEqual(["ok"]);
  expect(b.withheld).toEqual([
    { id: longId, reason: "invalid" },
    { id: "long-at", reason: "invalid" },
  ]);
  // Every exported deck is one the OS reader accepts.
  for (const d of b.decks)
    expect(atlasV0Schema.safeParse(withoutChecksum(d)).success).toBe(true);
  // An invalid deck costs no source lookup.
  expect(h.state.lookups).toBe(1);
});
