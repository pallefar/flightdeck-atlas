import { test, expect, type Page, type Request } from "@playwright/test";
import {
  contextResponseSchema,
  projectOptionText,
  type OsContextEntry,
  type OsSelection,
} from "../lib/flightdeck/context";
import {
  chooseContext,
  createCachedReader,
  createContextClient,
  loadContext,
  readContextConfig,
  type ContextReader,
  type Fetcher,
} from "../lib/flightdeck/context-client";

// Neither the unit checks nor the browser checks below contact FlightDeck OS:
// the OS transport is a fake, and browser calls to /api/flightdeck/context are
// answered by page.route using the real selection logic. The last test uses
// the running Atlas route but asserts only what holds whatever the OS state.
const FAKE_CREDENTIAL = "fake-credential-for-tests-0123456789";
const config = { baseUrl: "http://127.0.0.1:4173", token: FAKE_CREDENTIAL };
const at = "2026-09-22T08:00:00.000Z";
const entry = (
  id: string,
  label: string,
  enabled = true,
  isDefault = false,
): OsContextEntry => ({ id, label, enabled, isDefault });
const fixture = () => ({
  workspaces: [
    entry("te-ops", "TE Operations", true, true),
    entry("archive", "Archive", false),
    entry("hr-de", "HR Germany"),
  ],
  projects: {
    "te-ops": [
      entry("general", "General", true, true),
      entry("legacy", "Legacy import", false),
      entry("rhineland", "Rhineland rollout"),
    ],
    "hr-de": [
      entry("general", "General", true, true),
      entry("payroll", "Payroll"),
    ],
  } as Record<string, OsContextEntry[]>,
});
function fakeOs(os = fixture()): ContextReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async workspaces() {
      calls.push("workspaces");
      return {
        state: "ok",
        data: {
          integrationId: "atlas",
          workspaces: os.workspaces,
          generatedAt: at,
        },
      };
    },
    async projects(id) {
      calls.push(`projects:${id}`);
      const w = os.workspaces.find((x) => x.id === id);
      if (!w) return { state: "workspace_not_found" };
      if (!w.enabled) return { state: "workspace_disabled" };
      return {
        state: "ok",
        data: { workspaceId: id, projects: os.projects[id], generatedAt: at },
      };
    },
  };
}
const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

test("context transport sends only the bearer credential and maps every OS outcome", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: () => Response | Promise<Response> = () =>
    jsonResponse(200, {
      integrationId: "atlas",
      workspaces: fixture().workspaces,
      generatedAt: at,
    });
  const send: Fetcher = async (url, init) => {
    seen.push({ url, init });
    return reply();
  };
  const client = createContextClient(config, { fetch: send, timeoutMs: 50 });
  const ok = await client.workspaces();
  expect(ok.state).toBe("ok");
  expect(seen[0].url).toBe(
    "http://127.0.0.1:4173/api/inbound/v1/context/workspaces",
  );
  expect(seen[0].init).toMatchObject({
    method: "GET",
    cache: "no-store",
    redirect: "manual",
  });
  expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  expect(seen[0].init.headers).toEqual({
    Authorization: `Bearer ${FAKE_CREDENTIAL}`,
    Accept: "application/json",
  });
  expect(Object.keys(seen[0].init)).not.toContain("credentials");

  const outcome = async (
    make: () => Response | Promise<Response>,
    call: "workspaces" | "projects" = "projects",
  ) => {
    reply = make;
    return call === "workspaces"
      ? client.workspaces()
      : client.projects("te-ops");
  };
  expect(await outcome(() => jsonResponse(401, {}))).toEqual({
    state: "unauthorized",
  });
  expect(
    await outcome(() =>
      jsonResponse(403, { error: "credential lacks scope", reason: "x" }),
    ),
  ).toEqual({ state: "unauthorized" });
  expect(
    await outcome(() =>
      jsonResponse(
        429,
        { error: "too many requests", retryAfterSeconds: 7 },
        { "Retry-After": "7" },
      ),
    ),
  ).toEqual({ state: "rate_limited", retryAfter: 7 });
  expect(
    await outcome(() => jsonResponse(404, { error: "not found" })),
  ).toEqual({ state: "workspace_not_found" });
  expect(
    await outcome(() =>
      jsonResponse(409, {
        error: "workspace disabled",
        code: "workspace_disabled",
      }),
    ),
  ).toEqual({ state: "workspace_disabled" });
  // A missing route (OS not updated yet) is not a "workspace not found".
  expect(
    await outcome(
      () => jsonResponse(404, { message: "Route not found", statusCode: 404 }),
      "workspaces",
    ),
  ).toEqual({ state: "invalid_response" });
  expect(await outcome(() => jsonResponse(500, {}))).toEqual({
    state: "invalid_response",
  });
  expect(
    await outcome(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example/" },
        }),
    ),
  ).toEqual({ state: "invalid_response" });
  // Strict DTOs: forbidden or unknown fields reject the whole response.
  expect(
    await outcome(
      () =>
        jsonResponse(200, {
          integrationId: "atlas",
          workspaces: [{ ...entry("te-ops", "TE", true, true), root: "/srv" }],
          generatedAt: at,
        }),
      "workspaces",
    ),
  ).toEqual({ state: "invalid_response" });
  expect(
    await outcome(() =>
      jsonResponse(200, {
        workspaceId: "hr-de",
        projects: [],
        generatedAt: at,
      }),
    ),
  ).toEqual({ state: "invalid_response" });
  expect(
    await outcome(() =>
      jsonResponse(200, {
        workspaceId: "te-ops",
        projects: [entry("general", "General"), entry("general", "Again")],
        generatedAt: at,
      }),
    ),
  ).toEqual({ state: "invalid_response" });
  expect(
    await outcome(() => {
      throw new TypeError("connect ECONNREFUSED");
    }),
  ).toEqual({ state: "os_unreachable" });
  // Honours the timeout: a hung OS becomes os_unreachable.
  const hung = createContextClient(config, {
    timeoutMs: 50,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      ),
  });
  expect(await hung.workspaces()).toEqual({ state: "os_unreachable" });
  expect(await client.projects("../admin")).toEqual({
    state: "workspace_not_found",
  });
});

test("context configuration fails closed unless the OS origin and credential are safe", () => {
  expect(readContextConfig({})).toBeNull();
  expect(readContextConfig({ url: "http://127.0.0.1:4173" })).toBeNull();
  expect(
    readContextConfig({
      url: "http://127.0.0.1:4173/",
      token: FAKE_CREDENTIAL,
    }),
  ).toEqual({ baseUrl: "http://127.0.0.1:4173", token: FAKE_CREDENTIAL });
  expect(
    readContextConfig({ url: "https://os.example/fd", token: FAKE_CREDENTIAL }),
  ).toEqual({ baseUrl: "https://os.example/fd", token: FAKE_CREDENTIAL });
  for (const url of [
    "http://os.example:4173",
    "https://user:pass@os.example",
    "https://os.example/?x=1",
    "ftp://127.0.0.1",
    "not a url",
  ])
    expect(readContextConfig({ url, token: FAKE_CREDENTIAL })).toBeNull();
  expect(
    readContextConfig({ url: "http://localhost:4173", token: "short" }),
  ).toBeNull();
  expect(
    readContextConfig({
      url: "http://localhost:4173",
      token: "has space in it 0123456789",
    }),
  ).toBeNull();
});

test("selection rules mirror the OS and never switch workspace on their own", async () => {
  const admin = { superAdmin: true },
    member = { superAdmin: false };
  const first = await loadContext(fakeOs(), null, admin);
  expect(first).toMatchObject({
    state: "ok",
    selected: { osWorkspaceId: "te-ops", osProjectId: "general" },
    projectFallback: false,
  });
  expect(first.workspaces.map((w) => w.id)).toEqual([
    "te-ops",
    "archive",
    "hr-de",
  ]);
  expect(first.projects.map((p) => p.id)).toContain("legacy");
  const plain = await loadContext(fakeOs(), null, member);
  expect(plain.projects.map((p) => p.id)).toEqual(["general", "rhineland"]);

  const saved = (osWorkspaceId: string, osProjectId: string | null) => ({
    osWorkspaceId,
    osProjectId,
  });
  expect(
    await loadContext(fakeOs(), saved("hr-de", "payroll"), admin),
  ).toMatchObject({
    state: "ok",
    selected: saved("hr-de", "payroll"),
    projectFallback: false,
  });
  // Unknown or disabled saved project: that workspace's default project.
  for (const project of ["deleted-project", "legacy"])
    expect(
      await loadContext(fakeOs(), saved("te-ops", project), admin),
    ).toMatchObject({
      state: "ok",
      selected: saved("te-ops", "general"),
      projectFallback: true,
    });
  // A saved workspace that is no longer readable is reported, not replaced.
  const gone = await loadContext(fakeOs(), saved("gone", "general"), admin);
  expect(gone).toMatchObject({
    state: "workspace_not_found",
    selected: null,
    projects: [],
  });
  expect(gone.workspaces).toHaveLength(3);
  const disabledOs = fakeOs();
  expect(
    await loadContext(disabledOs, saved("archive", "general"), admin),
  ).toMatchObject({
    state: "workspace_disabled",
    selected: saved("archive", null),
  });
  expect(disabledOs.calls).toEqual(["workspaces"]);

  expect(
    await chooseContext(
      fakeOs(),
      { osWorkspaceId: "hr-de", osProjectId: "nope" },
      admin,
    ),
  ).toMatchObject({
    state: "ok",
    selected: saved("hr-de", "general"),
    projectFallback: true,
  });
  expect(
    await chooseContext(fakeOs(), { osWorkspaceId: "hr-de" }, admin),
  ).toMatchObject({ selected: saved("hr-de", "general") });
  expect(
    await chooseContext(fakeOs(), { osWorkspaceId: "gone" }, admin),
  ).toMatchObject({ state: "workspace_not_found", selected: null });
  expect(
    await chooseContext(fakeOs(), { osWorkspaceId: "archive" }, admin),
  ).toMatchObject({ state: "workspace_disabled" });

  const general = entry("general", "Ignored", true, true);
  const twins = [
    general,
    entry("a", "Rhineland rollout"),
    entry("b", "Rhineland rollout"),
  ];
  expect(projectOptionText(twins, general)).toBe("General");
  expect(projectOptionText(twins, twins[1])).toBe("Rhineland rollout (a)");
  expect(projectOptionText([], entry("long", "x".repeat(60), false))).toBe(
    `${"x".repeat(39)}… (disabled)`,
  );
});

test("the context reader coalesces bursts and honours an OS rate limit", async () => {
  let clock = 0;
  const os = fakeOs();
  const cache = new Map();
  const reader = createCachedReader(os, cache, { now: () => clock });
  await reader.workspaces();
  await reader.workspaces();
  expect(os.calls).toEqual(["workspaces"]);
  await createCachedReader(os, cache, {
    fresh: true,
    now: () => clock,
  }).workspaces();
  expect(os.calls).toEqual(["workspaces", "workspaces"]);
  clock = 11_000;
  await reader.workspaces();
  expect(os.calls).toHaveLength(3);
  const limited: ContextReader = {
    workspaces: async () => ({ state: "rate_limited", retryAfter: 20 }),
    projects: async () => ({ state: "rate_limited", retryAfter: 20 }),
  };
  expect(
    await createCachedReader(limited, cache, { now: () => clock }).projects(
      "te-ops",
    ),
  ).toEqual({ state: "rate_limited", retryAfter: 20 });
  clock += 5_000;
  expect(await reader.workspaces()).toEqual({
    state: "rate_limited",
    retryAfter: 15,
  });
  expect(os.calls).toHaveLength(3);
  clock += 16_000;
  expect((await reader.workspaces()).state).toBe("ok");
});

/** Answers the browser's /api/flightdeck/context with the real selection
 * logic over a fake OS, keeping the saved selection in memory like D1. */
async function mockContext(page: Page, options: { saved?: OsSelection } = {}) {
  const state = {
    os: fixture(),
    saved: options.saved ?? null,
    override: null as null | { state: string; status?: number },
    puts: [] as unknown[],
  };
  await page.route("**/api/flightdeck/context", async (route) => {
    const request = route.request();
    const checkedAt = new Date().toISOString();
    if (state.override) {
      await route.fulfill({
        status: state.override.status ?? 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: state.override.state,
          workspaces: [],
          projects: [],
          selected: null,
          projectFallback: false,
          retryAfter: null,
          checkedAt,
        }),
      });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      state.puts.push(body);
      const view = await chooseContext(fakeOs(state.os), body, {
        superAdmin: true,
      });
      if (view.state === "ok") state.saved = view.selected;
      await route.fulfill({
        status: view.state === "ok" ? 200 : 409,
        contentType: "application/json",
        body: JSON.stringify(
          view.state === "ok"
            ? { ...view, checkedAt }
            : { error: "Refused by fake OS.", state: view.state },
        ),
      });
      return;
    }
    const view = await loadContext(fakeOs(state.os), state.saved, {
      superAdmin: true,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...view, checkedAt }),
    });
  });
  return state;
}
function watchOsRequests(page: Page) {
  const direct: string[] = [];
  page.on("request", (r: Request) => {
    const url = new URL(r.url());
    if (url.port === "4173" || url.pathname.startsWith("/api/inbound/"))
      direct.push(r.url());
  });
  return direct;
}
const refocus = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event("focus")));
const sidebar = (page: Page) => page.locator("aside.sidebar .fd-context");

test("sidebar lists mirror FlightDeck workspace and project rules", async ({
  page,
}) => {
  const direct = watchOsRequests(page);
  await mockContext(page);
  await page.goto("/");
  const context = sidebar(page);
  const workspace = context.getByLabel("FlightDeck workspace");
  const project = context.getByLabel("FlightDeck project");
  await expect(workspace).toHaveValue("te-ops");
  await expect(project).toHaveValue("general");
  await expect(workspace).toBeEnabled();
  await expect(project).toBeEnabled();
  await expect(context.getByRole("status")).toHaveText("Connected");
  // Disabled workspaces are shown, greyed and unselectable.
  await expect(workspace.locator("option")).toHaveText([
    "TE Operations",
    "Archive (disabled)",
    "HR Germany",
  ]);
  await expect(workspace.locator('option[value="archive"]')).toBeDisabled();
  // Disabled projects are visible (unselectable) for the Super Admin only.
  await expect(project.locator("option")).toHaveText([
    "General",
    "Legacy import (disabled)",
    "Rhineland rollout",
  ]);
  await expect(project.locator('option[value="legacy"]')).toBeDisabled();
  // Keyboard reachable.
  await workspace.focus();
  await page.keyboard.press("Tab");
  await expect(project).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("FlightDeck workspace")).toHaveValue("te-ops");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(direct).toEqual([]);
});

test("selection persists across reload and a workspace change picks its default project", async ({
  page,
}) => {
  const direct = watchOsRequests(page);
  const mock = await mockContext(page);
  await page.goto("/");
  const project = sidebar(page).getByLabel("FlightDeck project");
  await expect(project).toHaveValue("general");
  await project.selectOption("rhineland");
  await expect(project).toHaveValue("rhineland");
  expect(mock.puts).toEqual([
    { osWorkspaceId: "te-ops", osProjectId: "rhineland" },
  ]);
  await page.reload();
  await expect(sidebar(page).getByLabel("FlightDeck project")).toHaveValue(
    "rhineland",
  );
  await sidebar(page).getByLabel("FlightDeck workspace").selectOption("hr-de");
  await expect(sidebar(page).getByLabel("FlightDeck workspace")).toHaveValue(
    "hr-de",
  );
  await expect(sidebar(page).getByLabel("FlightDeck project")).toHaveValue(
    "general",
  );
  expect(mock.puts.at(-1)).toEqual({
    osWorkspaceId: "hr-de",
    osProjectId: null,
  });
  // A single-project workspace leaves nothing to switch to.
  mock.os.projects["hr-de"] = [entry("general", "General", true, true)];
  await refocus(page);
  await expect(sidebar(page).getByLabel("FlightDeck project")).toBeDisabled();
  expect(direct).toEqual([]);
});

test("an unknown saved project falls back inside the same workspace", async ({
  page,
}) => {
  const mock = await mockContext(page, {
    saved: { osWorkspaceId: "hr-de", osProjectId: "deleted-project" },
  });
  await page.goto("/");
  const context = sidebar(page);
  await expect(context.getByLabel("FlightDeck workspace")).toHaveValue("hr-de");
  await expect(context.getByLabel("FlightDeck project")).toHaveValue("general");
  await expect(context.getByRole("status")).toHaveText(
    "Saved project unavailable. Showing General.",
  );
  // A saved workspace that disappeared is never swapped for another one.
  mock.saved = { osWorkspaceId: "gone", osProjectId: "general" };
  await refocus(page);
  await expect(context.getByRole("status")).toHaveText(
    "Saved workspace is no longer available. Choose another.",
  );
  await expect(context.getByLabel("FlightDeck workspace")).toHaveValue("");
  await expect(context.getByLabel("FlightDeck project")).toBeDisabled();
  await context.getByLabel("FlightDeck workspace").selectOption("te-ops");
  await expect(context.getByLabel("FlightDeck project")).toHaveValue("general");
});

test("unreachable keeps the last good lists while refusal and missing configuration clear them", async ({
  page,
}) => {
  const mock = await mockContext(page);
  await page.goto("/");
  const context = sidebar(page);
  const workspace = context.getByLabel("FlightDeck workspace");
  await expect(workspace).toHaveValue("te-ops");
  mock.override = { state: "os_unreachable" };
  await refocus(page);
  await expect(context.getByRole("status")).toHaveText(
    "FlightDeck unreachable",
  );
  await expect(context.locator("small")).toContainText("last checked");
  await expect(workspace).toHaveValue("te-ops");
  await expect(workspace).toBeDisabled();
  mock.override = { state: "unauthorized" };
  await refocus(page);
  await expect(context.getByRole("status")).toHaveText(
    "FlightDeck refused Atlas's credential",
  );
  await expect(workspace.locator("option")).toHaveText(["No workspaces"]);
  mock.override = { state: "not_configured" };
  await refocus(page);
  await expect(context.getByRole("status")).toHaveText(
    "FlightDeck not configured",
  );
  await expect(context.getByLabel("FlightDeck project")).toBeDisabled();
  mock.override = null;
  await refocus(page);
  await expect(workspace).toHaveValue("te-ops");
});

test("the live context route stays same-origin, signed-in and free of the credential", async ({
  page,
  request,
}) => {
  const direct = watchOsRequests(page);
  const leaks = /token|bearer|ATLAS_FLIGHTDECK|INBOUND/i;
  const anonymous = await request.get("/api/flightdeck/context");
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.text()).not.toMatch(leaks);
  expect(
    (
      await request.put("/api/flightdeck/context", {
        data: { osWorkspaceId: "te-ops" },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/?view=connection");
  await expect(
    page.getByText("Workspace & project context:", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  const results = await page.evaluate(async () => {
    const get = await fetch("/api/flightdeck/context");
    const put = await fetch("/api/flightdeck/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ osWorkspaceId: "te-ops", osProjectId: null }),
    });
    const invalid = await fetch("/api/flightdeck/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "te-ops" }),
    });
    return {
      get: { status: get.status, body: await get.text() },
      put: { status: put.status, body: await put.text() },
      invalid: invalid.status,
    };
  });
  expect(results.get.status).toBe(200);
  const body = contextResponseSchema.parse(JSON.parse(results.get.body));
  expect(body.state).not.toBe("not_permitted");
  expect(results.get.body).not.toMatch(leaks);
  expect(results.put.body).not.toMatch(leaks);
  expect(results.invalid).toBe(400);
  const crossSite = await page.request.put("/api/flightdeck/context", {
    headers: { Origin: "https://attacker.example" },
    data: { osWorkspaceId: "te-ops" },
  });
  expect(crossSite.status()).toBe(403);
  expect(direct).toEqual([]);
});
