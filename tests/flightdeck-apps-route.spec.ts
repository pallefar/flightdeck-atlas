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

// deck-atlas-link (plan 2026-09-26 R1-J1): the project 'Slides' tool opens
// Presentation Studio on the OS project LINKED to that Atlas project, through
// the OS's validated ?projectId= (deck-host-launch-project), never on the
// workspace default. Nothing here contacts FlightDeck OS.
const studio = {
  id: "presentation-studio",
  label: "Presentation Studio",
  icon: "📽️",
  path: "/console/apps/presentation-studio",
  visibleToRoles: ["admin", "member"],
};
test.describe("context client: appsForProject()", () => {
  test("asks the OS apps route with ?projectId= and refuses an answer for another project", async () => {
    const seen: string[] = [];
    const client = (projectId: string) =>
      createContextClient(
        { baseUrl: OS, token: "t".repeat(32) },
        {
          fetch: async (url) => {
            seen.push(url);
            return jsonResponse({ ...appsBody("hr-de", [studio]), projectId });
          },
        },
      );
    expect(await client("q3-launch").appsForProject!("hr-de", "q3-launch")).toEqual({
      state: "ok",
      data: { ...appsBody("hr-de", [studio]), projectId: "q3-launch" },
    });
    expect(seen).toEqual([
      `${OS}/api/inbound/v1/context/workspaces/hr-de/apps?projectId=q3-launch`,
    ]);
    // The OS answering for its default project instead is never shown as
    // the linked project's list.
    expect(await client("general").appsForProject!("hr-de", "q3-launch")).toEqual({
      state: "invalid_response",
    });
  });

  test("the OS's 409 project_disabled and 404 are states, never a list", async () => {
    const run = (answer: Response) =>
      createContextClient(
        { baseUrl: OS, token: "t".repeat(32) },
        { fetch: async () => answer },
      ).appsForProject!("hr-de", "q3-launch");
    expect(
      await run(
        jsonResponse(
          { error: "project disabled", code: "project_disabled", projectId: "q3-launch" },
          409,
        ),
      ),
    ).toEqual({ state: "project_disabled" });
    expect(await run(jsonResponse({ error: "not found" }, 404))).toEqual({
      state: "workspace_not_found",
    });
  });
});

test.describe("/api/flightdeck/apps?project= (the Slides tool)", () => {
  const superAdmin = async () => ({
    access: { userId: "u1", superAdmin: true },
  });
  const OS_INSTANCE = "os-instance-a";
  const linked = {
    osInstanceId: OS_INSTANCE,
    workspaceId: "hr-de",
    osProjectId: "q3-launch",
  };
  const request = (project: string) =>
    new Request(
      `http://atlas.test/api/flightdeck/apps?project=${encodeURIComponent(project)}`,
    );
  const osWith = (
    asked: string[],
    answer: (ws: string, project: string) => Awaited<
      ReturnType<NonNullable<ContextReader["appsForProject"]>>
    > = (ws, project) => ({
      state: "ok",
      data: { ...appsBody(ws, [maps, studio]), projectId: project },
    }),
  ) =>
    reader({
      async workspaces() {
        return { state: "ok", data: { ...wsBody, instanceId: OS_INSTANCE } };
      },
      async appsForProject(ws, project) {
        asked.push(`${ws}/${project}`);
        return answer(ws, project);
      },
    });

  test("⭐ the deep link's fdProject is the LINKED OS project, not the workspace default", async () => {
    const asked: string[] = [];
    const route = createAppsRoute({
      authorize: superAdmin,
      reader: () => osWith(asked),
      origin: () => OS,
      selection: async () => null,
      linkOf: async (id) => (id === "atlas-1" ? linked : null),
    });
    const body = (await (await route.GET(request("atlas-1"))).json()) as {
      state: string;
      workspaceId: string;
      projectId: string;
      apps: { id: string; url: string }[];
    };
    expect(asked).toEqual(["hr-de/q3-launch"]);
    expect(body.state).toBe("ok");
    expect(body.workspaceId).toBe("hr-de");
    expect(body.projectId).toBe("q3-launch");
    const url = new URL(body.apps.find((a) => a.id === "presentation-studio")!.url);
    expect(url.origin + url.pathname).toBe(`${OS}/console/apps/presentation-studio`);
    expect(url.searchParams.get("fdWorkspace")).toBe("hr-de");
    expect(url.searchParams.get("fdProject")).toBe("q3-launch");
    expect(url.searchParams.get("fdProject")).not.toBe("general");
  });

  test("an Atlas project with no link answers not_linked and reads nothing from the OS", async () => {
    const asked: string[] = [];
    const route = createAppsRoute({
      authorize: superAdmin,
      reader: () => osWith(asked),
      origin: () => OS,
      selection: async () => null,
      linkOf: async () => null,
    });
    expect(await (await route.GET(request("atlas-2"))).json()).toMatchObject({
      state: "not_linked",
      apps: [],
    });
    expect(asked).toEqual([]);
  });

  test("a disabled linked project or an app turned off there gives no Presentation Studio link", async () => {
    const off = createAppsRoute({
      authorize: superAdmin,
      reader: () => osWith([], () => ({ state: "project_disabled" })),
      origin: () => OS,
      selection: async () => null,
      linkOf: async () => linked,
    });
    expect(await (await off.GET(request("atlas-1"))).json()).toMatchObject({
      state: "project_disabled",
      apps: [],
    });
    const appOff = createAppsRoute({
      authorize: superAdmin,
      reader: () =>
        osWith([], (ws, project) => ({
          state: "ok",
          data: { ...appsBody(ws, [maps]), projectId: project },
        })),
      origin: () => OS,
      selection: async () => null,
      linkOf: async () => linked,
    });
    const body = (await (await appOff.GET(request("atlas-1"))).json()) as {
      apps: { id: string }[];
    };
    expect(body.apps.map((a) => a.id)).toEqual(["maps"]);
  });

  test("fails closed: only the Super Admin gets a linked project's link (the editor projection withholds the link)", async () => {
    const asked: string[] = [];
    let looked = false;
    const route = createAppsRoute({
      authorize: allowed,
      reader: () => osWith(asked),
      origin: () => OS,
      selection: async () => null,
      linkOf: async () => {
        looked = true;
        return linked;
      },
    });
    const body = await (await route.GET(request("atlas-1"))).json();
    expect(body).toMatchObject({ state: "not_permitted", apps: [] });
    expect(JSON.stringify(body)).not.toContain("q3-launch");
    expect(looked).toBe(false);
    expect(asked).toEqual([]);
  });

  test("a malformed Atlas project id is not looked up", async () => {
    let looked = false;
    const route = createAppsRoute({
      authorize: superAdmin,
      reader: () => osWith([]),
      origin: () => OS,
      selection: async () => null,
      linkOf: async () => {
        looked = true;
        return linked;
      },
    });
    expect(
      await (await route.GET(request("x".repeat(200)))).json(),
    ).toMatchObject({ state: "not_linked", apps: [] });
    expect(looked).toBe(false);
  });
  test("fails closed: a link recorded on ANOTHER OS instance gives no link, even when the slugs match", async () => {
    // Atlas re-pointed at a different FlightDeck while keeping its database:
    // the same workspace/project slugs exist there, but they are not the
    // project this Atlas project was linked to.
    const asked: string[] = [];
    const route = createAppsRoute({
      authorize: superAdmin,
      reader: () => osWith(asked),
      origin: () => OS,
      selection: async () => null,
      linkOf: async () => ({ ...linked, osInstanceId: "os-instance-b" }),
    });
    const body = await (await route.GET(request("atlas-1"))).json();
    expect(body).toMatchObject({ state: "instance_mismatch", apps: [] });
    expect(JSON.stringify(body)).not.toContain("presentation-studio");
    expect(asked).toEqual([]);
  });

  test("fails closed: an OS that does not publish its instance id, or cannot be read, gives no link", async () => {
    const asked: string[] = [];
    const withWorkspaces = (
      workspaces: ContextReader["workspaces"],
    ) =>
      createAppsRoute({
        authorize: superAdmin,
        reader: () => ({ ...osWith(asked), workspaces }),
        origin: () => OS,
        selection: async () => null,
        linkOf: async () => linked,
      });
    expect(
      await (
        await withWorkspaces(async () => ({ state: "ok", data: wsBody })).GET(
          request("atlas-1"),
        )
      ).json(),
    ).toMatchObject({ state: "instance_unknown", apps: [] });
    expect(
      await (
        await withWorkspaces(async () => ({ state: "os_unreachable" })).GET(
          request("atlas-1"),
        )
      ).json(),
    ).toMatchObject({ state: "os_unreachable", apps: [] });
    expect(asked).toEqual([]);
  });
});
