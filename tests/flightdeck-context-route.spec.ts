import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { defaultPreferences } from "../lib/collaboration";
import {
  contextResponseSchema,
  type OsContextEntry,
} from "../lib/flightdeck/context";
import type {
  ContextFailure,
  ContextReader,
} from "../lib/flightdeck/context-client";
import {
  createContextRoute,
  keptSelection,
  preferenceSelectionStore,
  type ContextAuth,
  type PreferenceDb,
} from "../lib/flightdeck/context-route";

// Runs the real /api/flightdeck/context handlers (the same functions the
// route file exports) over a fake OS reader and a SQLite database built from
// the real atlas_preferences migration. Nothing here contacts FlightDeck OS.
const ORIGIN = "http://localhost:5173";
const URL_PATH = `${ORIGIN}/api/flightdeck/context`;
const at = "2026-09-22T08:00:00.000Z";
const entry = (
  id: string,
  label: string,
  enabled = true,
  isDefault = false,
): OsContextEntry => ({ id, label, enabled, isDefault });
const workspaces = [
  entry("te-ops", "TE Operations", true, true),
  entry("archive", "Archive", false),
  entry("hr-de", "HR Germany"),
];
const projects: Record<string, OsContextEntry[]> = {
  "te-ops": [
    entry("general", "General", true, true),
    entry("rhineland", "Rhineland rollout"),
  ],
  "hr-de": [
    entry("general", "General", true, true),
    entry("payroll", "Payroll"),
  ],
};
const fakeOs = (failure?: ContextFailure): ContextReader => ({
  async workspaces() {
    if (failure) return failure;
    return {
      state: "ok",
      data: { integrationId: "atlas", workspaces, generatedAt: at },
    };
  },
  async projects(id) {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return { state: "workspace_not_found" };
    if (!w.enabled) return { state: "workspace_disabled" };
    return {
      state: "ok",
      data: { workspaceId: id, projects: projects[id], generatedAt: at },
    };
  },
});

/** A D1-shaped adapter over node:sqlite with the real migration's table.
 * `beforeRun` lets a test write "concurrently" just before a statement runs. */
function preferencesDb() {
  const migration = readFileSync(
    new URL("../drizzle/0002_lowly_thing.sql", import.meta.url),
    "utf8",
  );
  const table = migration.match(/CREATE TABLE `atlas_preferences` \([^;]*\);/);
  if (!table) throw Error("atlas_preferences migration not found");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(table[0]);
  const hooks: { beforeRun: (sql: string) => void } = { beforeRun: () => {} };
  const db: PreferenceDb = {
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
              hooks.beforeRun(sql);
              return {
                meta: { changes: Number(statement.run(...args).changes) },
              };
            },
          };
        },
      };
    },
  };
  const row = () =>
    sqlite
      .prepare("SELECT data,revision FROM atlas_preferences WHERE user_id=?")
      .get("user-1") as { data: string; revision: number } | undefined;
  const write = (data: object, revision = 1) =>
    sqlite
      .prepare(
        "INSERT OR REPLACE INTO atlas_preferences(user_id,data,revision) VALUES (?,?,?)",
      )
      .run("user-1", JSON.stringify(data), revision);
  return { db, hooks, row, write };
}

function harness(
  options: {
    superAdmin?: boolean;
    os?: ContextReader | null;
    authError?: Response;
  } = {},
) {
  const store = preferencesDb();
  const calls = { authorize: 0, reader: [] as boolean[] };
  const route = createContextRoute({
    async authorize(): Promise<ContextAuth> {
      calls.authorize++;
      if (options.authError) return { error: options.authError };
      return {
        access: { userId: "user-1", superAdmin: options.superAdmin ?? true },
      };
    },
    reader(fresh) {
      calls.reader.push(fresh);
      return options.os === undefined ? fakeOs() : options.os;
    },
    store: preferenceSelectionStore(() => store.db),
  });
  return { route, store, calls };
}
const put = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_PATH, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
  });

test("a non-admin member gets no OS lists and never triggers an OS read", async () => {
  const { route, calls, store } = harness({ superAdmin: false });
  const get = await route.GET();
  expect(get.status).toBe(200);
  const body = contextResponseSchema.parse(await get.json());
  expect(body).toMatchObject({
    state: "not_permitted",
    workspaces: [],
    projects: [],
    selected: null,
  });
  const refused = await route.PUT(put({ osWorkspaceId: "te-ops" }));
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ state: "not_permitted" });
  expect(calls.reader).toEqual([]);
  expect(store.row()).toBeUndefined();
  // A signed-out or unauthorised caller gets the authorisation response as is.
  const signedOut = harness({
    authError: Response.json(
      { error: "Sign in to continue." },
      { status: 401 },
    ),
  });
  expect((await signedOut.route.GET()).status).toBe(401);
  expect(
    (await signedOut.route.PUT(put({ osWorkspaceId: "te-ops" }))).status,
  ).toBe(401);
  expect(signedOut.calls.reader).toEqual([]);
});

test("the route refuses cross-site writes before it authorises or reads", async () => {
  const { route, calls } = harness();
  const attempts: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    { Origin: "http://localhost:3000" },
    { Origin: "", "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of attempts) {
    const response = await route.PUT(put({ osWorkspaceId: "te-ops" }, headers));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Request origin is not allowed.",
    });
  }
  expect(calls.authorize).toBe(0);
  expect(calls.reader).toEqual([]);
});

test("a saved selection is validated against fresh lists, persisted and read back", async () => {
  const { route, store, calls } = harness();
  const first = contextResponseSchema.parse(await (await route.GET()).json());
  expect(first).toMatchObject({
    state: "ok",
    selected: { osWorkspaceId: "te-ops", osProjectId: "general" },
  });
  // Reading never writes a selection.
  expect(store.row()).toBeUndefined();

  const saved = await route.PUT(
    put({ osWorkspaceId: "hr-de", osProjectId: "payroll" }),
  );
  expect(saved.status).toBe(200);
  expect(contextResponseSchema.parse(await saved.json())).toMatchObject({
    state: "ok",
    selected: { osWorkspaceId: "hr-de", osProjectId: "payroll" },
  });
  const row = store.row()!;
  expect(row.revision).toBe(1);
  expect(JSON.parse(row.data)).toEqual({
    ...defaultPreferences,
    flightdeckContext: { osWorkspaceId: "hr-de", osProjectId: "payroll" },
  });
  expect(
    contextResponseSchema.parse(await (await route.GET()).json()).selected,
  ).toEqual({ osWorkspaceId: "hr-de", osProjectId: "payroll" });
  // GET may use cached lists; a save always reads fresh ones.
  expect(calls.reader).toEqual([false, true, false]);

  // An unknown project falls back to that workspace's default project.
  const fallback = await route.PUT(
    put({ osWorkspaceId: "hr-de", osProjectId: "gone" }),
  );
  expect(await fallback.json()).toMatchObject({
    selected: { osWorkspaceId: "hr-de", osProjectId: "general" },
    projectFallback: true,
  });
  expect(JSON.parse(store.row()!.data).flightdeckContext).toEqual({
    osWorkspaceId: "hr-de",
    osProjectId: "general",
  });
  expect(store.row()!.revision).toBe(2);
});

test("saving merges into other preferences and retries a concurrent write", async () => {
  const { route, store } = harness();
  const other = { ...defaultPreferences, weeklyHours: 32, favourites: ["a"] };
  store.write(other);
  // Another preference save lands between our read and our update.
  let raced = false;
  store.hooks.beforeRun = (sql) => {
    if (raced || !sql.startsWith("UPDATE")) return;
    raced = true;
    store.write({ ...other, digest: "weekly" }, 2);
  };
  const response = await route.PUT(put({ osWorkspaceId: "te-ops" }));
  expect(response.status).toBe(200);
  expect(raced).toBe(true);
  const row = store.row()!;
  expect(row.revision).toBe(3);
  expect(JSON.parse(row.data)).toEqual({
    ...other,
    digest: "weekly",
    flightdeckContext: { osWorkspaceId: "te-ops", osProjectId: "general" },
  });

  // A first save that races another first save updates the row it lost to.
  const fresh = harness();
  let inserted = false;
  fresh.store.hooks.beforeRun = (sql) => {
    if (inserted || !sql.startsWith("INSERT")) return;
    inserted = true;
    fresh.store.write({ ...defaultPreferences, weeklyHours: 20 });
  };
  expect((await fresh.route.PUT(put({ osWorkspaceId: "hr-de" }))).status).toBe(
    200,
  );
  expect(fresh.store.row()!.revision).toBe(2);
  expect(JSON.parse(fresh.store.row()!.data)).toMatchObject({
    weeklyHours: 20,
    flightdeckContext: { osWorkspaceId: "hr-de", osProjectId: "general" },
  });

  // Writers that keep winning: give up after three attempts, change nothing.
  const busy = harness();
  let revision = 1;
  busy.store.write(defaultPreferences);
  busy.store.hooks.beforeRun = () =>
    void busy.store.write(defaultPreferences, ++revision);
  const conflict = await busy.route.PUT(put({ osWorkspaceId: "te-ops" }));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({
    error: "Preferences changed at the same time. Try again.",
  });
  expect(JSON.parse(busy.store.row()!.data).flightdeckContext).toBeNull();
});

test("every OS refusal maps to its status, keeps the saved selection and never leaks detail", async () => {
  const saved = { osWorkspaceId: "te-ops", osProjectId: "rhineland" };
  const cases: {
    os: ContextReader | null;
    body: unknown;
    status: number;
    state: string;
    retryAfter?: string;
  }[] = [
    {
      os: null,
      body: { osWorkspaceId: "te-ops" },
      status: 503,
      state: "not_configured",
    },
    {
      os: fakeOs({ state: "os_unreachable" }),
      body: { osWorkspaceId: "te-ops" },
      status: 503,
      state: "os_unreachable",
    },
    {
      os: fakeOs({ state: "unauthorized" }),
      body: { osWorkspaceId: "te-ops" },
      status: 502,
      state: "unauthorized",
    },
    {
      os: fakeOs({ state: "rate_limited", retryAfter: 7 }),
      body: { osWorkspaceId: "te-ops" },
      status: 429,
      state: "rate_limited",
      retryAfter: "7",
    },
    {
      os: fakeOs({ state: "invalid_response" }),
      body: { osWorkspaceId: "te-ops" },
      status: 502,
      state: "invalid_response",
    },
    {
      os: fakeOs(),
      body: { osWorkspaceId: "gone" },
      status: 404,
      state: "workspace_not_found",
    },
    {
      os: fakeOs(),
      body: { osWorkspaceId: "archive" },
      status: 409,
      state: "workspace_disabled",
    },
  ];
  for (const c of cases) {
    const { route, store } = harness({ os: c.os });
    store.write({ ...defaultPreferences, flightdeckContext: saved });
    const response = await route.PUT(put(c.body));
    expect(response.status, c.state).toBe(c.status);
    expect(response.headers.get("retry-after"), c.state).toBe(
      c.retryAfter ?? null,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort(), c.state).toEqual([
      "error",
      "retryAfter",
      "state",
    ]);
    expect(body.state).toBe(c.state);
    expect(body.retryAfter).toBe(c.retryAfter ? Number(c.retryAfter) : null);
    const row = store.row()!;
    expect(row.revision, c.state).toBe(1);
    expect(JSON.parse(row.data).flightdeckContext).toEqual(saved);
  }
  // Malformed or oversized selections are rejected before the OS is read.
  const { route, calls } = harness();
  expect((await route.PUT(put({ workspaceId: "te-ops" }))).status).toBe(400);
  expect(
    (await route.PUT(put({ osWorkspaceId: "../etc", osProjectId: null })))
      .status,
  ).toBe(400);
  expect(
    (
      await route.PUT(
        new Request(URL_PATH, {
          method: "PUT",
          headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
          body: "te-ops",
        }),
      )
    ).status,
  ).toBe(415);
  expect(calls.reader).toEqual([]);
});

test("storage failures answer 503 without an OS write", async () => {
  const route = createContextRoute({
    authorize: async () => ({ access: { userId: "u", superAdmin: true } }),
    reader: () => fakeOs(),
    store: preferenceSelectionStore(() => {
      throw Error("Project storage is unavailable.");
    }),
  });
  const get = await route.GET();
  expect(get.status).toBe(503);
  expect(await get.json()).toEqual({
    error: "Your saved FlightDeck context is unavailable.",
  });
  const saved = await route.PUT(put({ osWorkspaceId: "te-ops" }));
  expect(saved.status).toBe(503);
  expect(await saved.json()).toEqual({
    error: "Your FlightDeck context could not be saved. Try again.",
  });
});

test("other preference saves keep the stored FlightDeck selection", () => {
  const selection = { osWorkspaceId: "hr-de", osProjectId: "payroll" };
  expect(
    keptSelection(
      JSON.stringify({ ...defaultPreferences, flightdeckContext: selection }),
    ),
  ).toEqual(selection);
  expect(keptSelection(null)).toBeNull();
  expect(keptSelection(JSON.stringify(defaultPreferences))).toBeNull();
  expect(
    keptSelection(
      JSON.stringify({
        flightdeckContext: { osWorkspaceId: "../x", osProjectId: null },
      }),
    ),
  ).toBeNull();
});
