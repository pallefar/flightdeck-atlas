import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { examples } from "../lib/projects";
import { createDeck } from "../lib/presentations";
import {
  createDeckWriteRoute,
  deckWriteDecision,
  type DeckDb,
  type SourceRights,
} from "../lib/deck-policy";

// Runs the real /api/decks POST and DELETE handlers (the same functions the
// route file exports) over a SQLite database built from the real atlas_decks
// migration, with per-project rights supplied the way projectFor() supplies
// them. The loopback dev identity is the Super Admin, who can edit every
// project, so the read-only and lost-edit cases can only be exercised here.
const ORIGIN = "http://localhost:5173";
const URL_PATH = `${ORIGIN}/api/decks`;

function harness(rights: Record<string, SourceRights>, userId = "owner") {
  const migration = readFileSync(
    new URL("../drizzle/0002_lowly_thing.sql", import.meta.url),
    "utf8",
  );
  const table = migration.match(/CREATE TABLE `atlas_decks` \([^;]*\);/);
  if (!table) throw Error("atlas_decks migration not found");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(table[0]);
  const db: DeckDb = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          const args = values as SQLInputValue[];
          return {
            async first<T>() {
              return (statement.get(...args) as T | undefined) ?? null;
            },
            async run() {
              return {
                meta: { changes: Number(statement.run(...args).changes) },
              };
            },
          };
        },
      };
    },
  };
  const state = { userId, rights };
  const route = createDeckWriteRoute({
    authorize: async () => ({ access: { userId: state.userId } }),
    database: () => db,
    sourceRights: async (_access, id) => state.rights[id] ?? null,
  });
  const row = (id: string) =>
    sqlite
      .prepare("SELECT owner_id, revision, data FROM atlas_decks WHERE id=?")
      .get(id) as
      { owner_id: string; revision: number; data: string } | undefined;
  return { route, state, row, sqlite };
}

const deckFor = (...ids: string[]) =>
  createDeck(
    ids.map((id, i) => ({ ...examples[i % examples.length], id })),
    "Leadership update",
    "QA team",
    "Current",
  );
const post = (body: unknown, origin = ORIGIN) =>
  new Request(URL_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const del = (id: string, revision: number, origin = ORIGIN) =>
  new Request(`${URL_PATH}?id=${id}&revision=${revision}`, {
    method: "DELETE",
    headers: { origin },
  });
const body = async (r: Response) =>
  (await r.json()) as {
    code?: string;
    deck: { id: string; revision: number; canEdit: boolean };
  };
const edit = { edit: true },
  readOnly = { edit: false };

test("a read-only source project cannot receive a new deck", async () => {
  const h = harness({ a: edit, b: readOnly });
  const r = await h.route.POST(
    post({ id: "d1", revision: 0, data: deckFor("a", "b") }),
  );
  expect(r.status).toBe(403);
  expect((await body(r)).code).toBe("deck_source_read_only");
  expect(h.row("d1")).toBeUndefined();
});

test("an unreadable source project fails closed", async () => {
  const h = harness({ a: edit });
  const r = await h.route.POST(
    post({ id: "d1", revision: 0, data: deckFor("a", "gone") }),
  );
  expect(r.status).toBe(403);
  expect((await body(r)).code).toBe("deck_source_unavailable");
  expect(h.row("d1")).toBeUndefined();
});

test("an owner who lost edit on one source project cannot update the deck", async () => {
  const h = harness({ a: edit, b: edit });
  const data = deckFor("a", "b");
  expect(
    (await h.route.POST(post({ id: "d1", revision: 0, data }))).status,
  ).toBe(200);
  h.state.rights = { a: edit, b: readOnly };
  const r = await h.route.POST(
    post({ id: "d1", revision: 1, data: { ...data, title: "Changed" } }),
  );
  expect(r.status).toBe(403);
  expect((await body(r)).code).toBe("deck_source_read_only");
  expect(h.row("d1")).toMatchObject({ revision: 1 });
  expect(JSON.parse(h.row("d1")!.data).title).toBe(data.title);
});

test("the paired positive case saves, and a stale revision still conflicts", async () => {
  const h = harness({ a: edit, b: edit });
  const data = deckFor("a", "b");
  const created = await h.route.POST(post({ id: "d1", revision: 0, data }));
  expect(created.status).toBe(200);
  expect((await body(created)).deck).toMatchObject({
    id: "d1",
    revision: 1,
    canEdit: true,
  });
  const updated = await h.route.POST(
    post({ id: "d1", revision: 1, data: { ...data, title: "Changed" } }),
  );
  expect(updated.status).toBe(200);
  expect((await body(updated)).deck.revision).toBe(2);
  const stale = await h.route.POST(
    post({ id: "d1", revision: 1, data: { ...data, title: "Stale" } }),
  );
  expect(stale.status).toBe(409);
  expect((await body(stale)).code).toBe("deck_stale");
  expect(JSON.parse(h.row("d1")!.data).title).toBe("Changed");
});

test("only the owner may update or delete, even with edit on every source", async () => {
  const h = harness({ a: edit });
  const data = deckFor("a");
  expect(
    (await h.route.POST(post({ id: "d1", revision: 0, data }))).status,
  ).toBe(200);
  h.state.userId = "someone-else";
  const update = await h.route.POST(
    post({ id: "d1", revision: 1, data: { ...data, title: "Hijack" } }),
  );
  expect(update.status).toBe(403);
  expect((await body(update)).code).toBe("deck_not_owner");
  const takeover = await h.route.POST(post({ id: "d1", revision: 0, data }));
  expect(takeover.status).toBe(409);
  const removed = await h.route.DELETE(del("d1", 1));
  expect(removed.status).toBe(403);
  expect((await body(removed)).code).toBe("deck_not_owner");
  expect(h.row("d1")).toMatchObject({ owner_id: "owner", revision: 1 });
});

test("the owner may delete without source edit rights, but not a stale revision", async () => {
  const h = harness({ a: edit });
  expect(
    (await h.route.POST(post({ id: "d1", revision: 0, data: deckFor("a") })))
      .status,
  ).toBe(200);
  h.state.rights = {};
  const stale = await h.route.DELETE(del("d1", 7));
  expect(stale.status).toBe(409);
  expect((await body(stale)).code).toBe("deck_stale");
  const removed = await h.route.DELETE(del("d1", 1));
  expect(removed.status).toBe(200);
  expect(h.row("d1")).toBeUndefined();
});

test("cross-origin writes and failing rights lookups are refused", async () => {
  const h = harness({ a: edit });
  const data = deckFor("a");
  expect(
    (await h.route.POST(post({ revision: 0, data }, "https://evil.test")))
      .status,
  ).toBe(403);
  expect((await h.route.DELETE(del("d1", 1, "https://evil.test"))).status).toBe(
    403,
  );
  const failing = createDeckWriteRoute({
    authorize: async () => ({ access: { userId: "owner" } }),
    database: () => {
      throw Error("no database");
    },
    sourceRights: async () => {
      throw Error("rights lookup failed");
    },
  });
  expect((await failing.POST(post({ revision: 0, data }))).status).toBe(503);
  expect((await failing.DELETE(del("d1", 1))).status).toBe(503);
});

test("the decision fails closed without sources or with an unknown owner", async () => {
  const lookup = async (_: unknown, id: string) => (id === "a" ? edit : null);
  expect(
    await deckWriteDecision({
      op: "create",
      actorId: "u",
      projectIds: [],
      sourceRights: lookup,
      access: { userId: "u" },
    }),
  ).toMatchObject({ ok: false, code: "deck_source_unavailable" });
  expect(
    await deckWriteDecision({
      op: "update",
      actorId: "u",
      ownerId: null,
      projectIds: ["a"],
      sourceRights: lookup,
      access: { userId: "u" },
    }),
  ).toMatchObject({ ok: false, code: "deck_not_owner" });
  expect(
    await deckWriteDecision({
      op: "update",
      actorId: "u",
      ownerId: "u",
      projectIds: ["a"],
      sourceRights: lookup,
      access: { userId: "u" },
    }),
  ).toEqual({ ok: true });
});
