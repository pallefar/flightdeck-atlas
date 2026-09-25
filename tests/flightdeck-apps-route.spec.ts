import { test, expect } from "@playwright/test";
import {
  createContextClient,
  type ContextReader,
} from "../lib/flightdeck/context-client";
import {
  filterFlightdeckApps,
  osAppsResponseSchema,
} from "../lib/flightdeck/context";
import { createAppsRoute } from "../lib/flightdeck/apps-route";

// The 9-dot app menu's FlightDeck section: the real client parsing a stub
// OS's GET /api/inbound/v1/context/workspaces/:id/apps, and the real
// /api/flightdeck/apps handler over a fake reader. Nothing here contacts
// FlightDeck OS.
const at = "2026-09-25T08:00:00.000Z";
const OS = "http://127.0.0.1:4420";
const maps = {
  id: "maps",
  label: "Maps",
  icon: "🗺️",
  path: "/console/apps/maps",
  visibleToRoles: ["admin"],
};
const wsBody = {
  integrationId: "atlas",
  workspaces: [
    { id: "te-ops", label: "TE Operations", enabled: true, isDefault: true },
    { id: "hr-de", label: "HR Germany", enabled: true, isDefault: false },
  ],
  generatedAt: at,
};
const appsBody = (workspaceId = "te-ops", apps: (typeof maps)[] = [maps]) => ({
  workspaceId,
  projectId: "general",
  apps,
  generatedAt: at,
});
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test.describe("context client: apps()", () => {
  test("reads the OS apps route with the bearer credential and parses it strictly", async () => {
    const seen: string[] = [];
    const client = createContextClient(
      { baseUrl: OS, token: "t".repeat(32) },
      {
        fetch: async (url, init) => {
          seen.push(url);
          expect((init.headers as Record<string, string>).Authorization).toBe(
            `Bearer ${"t".repeat(32)}`,
          );
          return jsonResponse(appsBody());
        },
      },
    );
    const r = await client.apps!("te-ops");
    expect(seen).toEqual([
      `${OS}/api/inbound/v1/context/workspaces/te-ops/apps`,
    ]);
    expect(r).toEqual({ state: "ok", data: appsBody() });
  });

  test("an unknown key, another workspace's answer, 401 and a dead OS all fail closed", async () => {
    const run = async (answer: () => Promise<Response>) =>
      createContextClient(
        { baseUrl: OS, token: "t".repeat(32) },
        { fetch: answer },
      ).apps!("te-ops");
    expect(
      await run(async () =>
        jsonResponse(
          appsBody("te-ops", [{ ...maps, root: "/secret" } as typeof maps]),
        ),
      ),
    ).toEqual({ state: "invalid_response" });
    expect(await run(async () => jsonResponse(appsBody("hr-de")))).toEqual({
      state: "invalid_response",
    });
    expect(await run(async () => jsonResponse({}, 401))).toEqual({
      state: "unauthorized",
    });
    expect(
      await run(async () => {
        throw Error("ECONNREFUSED");
      }),
    ).toEqual({ state: "os_unreachable" });
  });

  test("the schema refuses a path outside /console/apps (never an arbitrary link)", () => {
    expect(
      osAppsResponseSchema.safeParse(
        appsBody("te-ops", [{ ...maps, path: "https://evil.example/x" }]),
      ).success,
    ).toBe(false);
  });
});

const reader = (over: Partial<ContextReader> = {}): ContextReader => ({
  async workspaces() {
    return { state: "ok", data: wsBody };
  },
  async projects() {
    return { state: "workspace_not_found" };
  },
  async apps(id) {
    return { state: "ok", data: appsBody(id) };
  },
  ...over,
});
const allowed = async () => ({
  access: { userId: "u1", superAdmin: false },
});

test.describe("/api/flightdeck/apps", () => {
  test("⭐ lists the default workspace's apps with absolute deep links into the OS", async () => {
    const route = createAppsRoute({
      authorize: allowed,
      reader: () => reader(),
      origin: () => OS,
      selection: async () => null,
    });
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: string;
      workspaceId: string;
      apps: unknown[];
    };
    expect(body.state).toBe("ok");
    expect(body.workspaceId).toBe("te-ops");
    expect(body.apps).toEqual([
      {
        id: "maps",
        label: "Maps",
        icon: "🗺️",
        url: `${OS}/console/apps/maps?fdWorkspace=te-ops&fdProject=general`,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("Bearer");
  });

  test("a saved FlightDeck workspace selection is the one read", async () => {
    const asked: string[] = [];
    const route = createAppsRoute({
      authorize: allowed,
      reader: () =>
        reader({
          async apps(id) {
            asked.push(id);
            return { state: "ok", data: appsBody(id) };
          },
        }),
      origin: () => OS,
      selection: async () => ({ osWorkspaceId: "hr-de", osProjectId: null }),
    });
    const body = (await (await route.GET()).json()) as { workspaceId: string };
    expect(asked).toEqual(["hr-de"]);
    expect(body.workspaceId).toBe("hr-de");
  });

  test("a saved selection that is disabled or no longer shared is reported, never swapped for another workspace", async () => {
    const asked: string[] = [];
    const withSaved = (osWorkspaceId: string, enabled: boolean) =>
      createAppsRoute({
        authorize: allowed,
        reader: () =>
          reader({
            async workspaces() {
              return {
                state: "ok",
                data: {
                  ...wsBody,
                  workspaces: wsBody.workspaces.map((w) =>
                    w.id === "hr-de" ? { ...w, enabled } : w,
                  ),
                },
              };
            },
            async apps(id) {
              asked.push(id);
              return { state: "ok", data: appsBody(id) };
            },
          }),
        origin: () => OS,
        selection: async () => ({ osWorkspaceId, osProjectId: null }),
      });
    expect(await (await withSaved("hr-de", false).GET()).json()).toMatchObject({
      state: "workspace_disabled",
      workspaceId: "hr-de",
      apps: [],
    });
    expect(await (await withSaved("gone", true).GET()).json()).toMatchObject({
      state: "workspace_not_found",
      apps: [],
    });
    expect(asked).toEqual([]);
  });

  test("not configured and unreachable are honest states with no apps", async () => {
    const off = createAppsRoute({
      authorize: allowed,
      reader: () => null,
      origin: () => "",
      selection: async () => null,
    });
    expect(await (await off.GET()).json()).toMatchObject({
      state: "not_configured",
      apps: [],
    });
    const dead = createAppsRoute({
      authorize: allowed,
      reader: () =>
        reader({
          async workspaces() {
            return { state: "os_unreachable" };
          },
        }),
      origin: () => OS,
      selection: async () => null,
    });
    expect(await (await dead.GET()).json()).toMatchObject({
      state: "os_unreachable",
      apps: [],
    });
  });

  test("an Atlas refusal passes straight through before any OS read", async () => {
    let read = false;
    const route = createAppsRoute({
      authorize: async () => ({
        error: Response.json(
          { error: "Sign in to continue." },
          { status: 401 },
        ),
      }),
      reader: () => {
        read = true;
        return reader();
      },
      origin: () => OS,
      selection: async () => null,
    });
    expect((await route.GET()).status).toBe(401);
    expect(read).toBe(false);
  });
});

test("the launcher search filters FlightDeck apps by label, case-insensitively", () => {
  const apps = [
    { id: "maps", label: "Maps", icon: "", url: `${OS}/console/apps/maps` },
    { id: "docusign", label: "Flightdeck Sign", icon: "", url: `${OS}/console/apps/docusign` },
  ];
  expect(filterFlightdeckApps(apps, "").map((a) => a.id)).toEqual(["maps", "docusign"]);
  expect(filterFlightdeckApps(apps, "  SIGN ").map((a) => a.id)).toEqual(["docusign"]);
  expect(filterFlightdeckApps(apps, "zzz")).toEqual([]);
});
