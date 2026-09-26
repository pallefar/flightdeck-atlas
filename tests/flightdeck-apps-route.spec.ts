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

// ── onb-atlas-apps-discovery-route: ?mode=discovery ───────────────────────
// The apps a requester can ASK for before the destination project exists,
// read from the OS allowlisted app catalog (OS onb-inbound-apps-discovery,
// GET /api/inbound/v1/context/app-catalog). Instance-level for editors;
// workspace-level (with that workspace's consent) for the Super Admin only.
const catalogEntry = (
  id: string,
  state: "available" | "unavailable" | "awaiting-workspace-consent",
) => ({
  id,
  label: id === "maps" ? "Maps" : "Flightdeck Sign",
  icon: "🗺️",
  version: "0.2.0",
  category: "analytics",
  availability: "available" as const,
  tagline: "See where your people and sites are.",
  releaseRevision: 2,
  state,
  bridgePath: `/console/app-info/${id}`,
});
const instanceCatalog = (locale: "en" | "de" = "en") => ({
  scope: "instance" as const,
  contract: 1 as const,
  locale,
  apps: [catalogEntry("maps", "available"), catalogEntry("docusign", "unavailable")],
});
const workspaceCatalog = (workspaceId = "te-ops") => ({
  scope: "workspace" as const,
  workspaceId,
  contract: 1 as const,
  locale: "en" as const,
  apps: [
    catalogEntry("maps", "available"),
    catalogEntry("docusign", "awaiting-workspace-consent"),
  ],
});

test.describe("context client: appCatalog()", () => {
  const client = (answer: (url: string) => Response | Promise<Response>) =>
    createContextClient(
      { baseUrl: OS, token: "t".repeat(32) },
      { fetch: async (url) => answer(url) },
    );

  test("asks the OS catalog instance-level without a workspace, and with ?workspaceId= only when given one", async () => {
    const seen: string[] = [];
    const r1 = await client((url) => {
      seen.push(url);
      return jsonResponse(instanceCatalog());
    }).appCatalog!(null, "en");
    expect(r1).toEqual({ state: "ok", data: instanceCatalog() });
    const r2 = await client((url) => {
      seen.push(url);
      return jsonResponse(workspaceCatalog());
    }).appCatalog!("te-ops", "en");
    expect(r2).toEqual({ state: "ok", data: workspaceCatalog() });
    expect(seen).toEqual([
      `${OS}/api/inbound/v1/context/app-catalog?locale=en`,
      `${OS}/api/inbound/v1/context/app-catalog?workspaceId=te-ops&locale=en`,
    ]);
  });

  test("fails closed: an unknown key, a wrong echo, a foreign bridgePath, 401 and a 404 are never a list", async () => {
    const bad = [
      { ...instanceCatalog(), apps: [{ ...catalogEntry("maps", "available"), config: {} }] },
      { ...instanceCatalog(), apps: [{ ...catalogEntry("maps", "available"), bridgePath: "/console/app-info/docusign" }] },
      { ...instanceCatalog(), apps: [{ ...catalogEntry("maps", "available"), bridgePath: "https://evil.example/x" }] },
      { ...instanceCatalog(), apps: [{ ...catalogEntry("maps", "available"), state: "launchable" }] },
      instanceCatalog("de"),
      workspaceCatalog(),
    ];
    for (const body of bad)
      expect(await client(() => jsonResponse(body)).appCatalog!(null, "en")).toEqual({
        state: "invalid_response",
      });
    // An answer for another workspace, or an instance answer to a workspace ask.
    expect(
      await client(() => jsonResponse(workspaceCatalog("hr-de"))).appCatalog!("te-ops", "en"),
    ).toEqual({ state: "invalid_response" });
    expect(
      await client(() => jsonResponse(instanceCatalog())).appCatalog!("te-ops", "en"),
    ).toEqual({ state: "invalid_response" });
    expect(
      await client(() => jsonResponse({}, 401)).appCatalog!(null, "en"),
    ).toEqual({ state: "unauthorized" });
    // Instance-level, the OS's uniform 404 means the feature is off for this
    // credential; with a workspace it may also be a workspace not allowlisted.
    expect(
      await client(() => jsonResponse({ error: "not found" }, 404)).appCatalog!(null, "en"),
    ).toEqual({ state: "feature_off" });
    expect(
      await client(() => jsonResponse({ error: "not found" }, 404)).appCatalog!("te-ops", "en"),
    ).toEqual({ state: "workspace_not_found" });
    expect(
      await client(() =>
        jsonResponse({ error: "workspace disabled", code: "workspace_disabled" }, 409),
      ).appCatalog!("te-ops", "en"),
    ).toEqual({ state: "workspace_disabled" });
  });
});

test.describe("/api/flightdeck/apps?mode=discovery", () => {
  const whoamiWith = (appDiscovery: boolean) => async () =>
    ({
      state: "ok" as const,
      body: {
        integrationId: "atlas",
        features: { appDiscovery },
      },
    });
  const editor = async () => ({ access: { userId: "u1", superAdmin: false } });
  const superAdmin = async () => ({ access: { userId: "sa", superAdmin: true } });
  const discovery = (over: {
    authorize?: typeof editor;
    whoami?: () => Promise<
      | { state: "ok"; body: unknown }
      | { state: "unauthorized" | "os_unreachable" | "rate_limited" | "invalid_response" }
    >;
    appCatalog?: ContextReader["appCatalog"];
    asked?: (string | null)[];
  } = {}) =>
    createAppsRoute({
      authorize: over.authorize ?? editor,
      reader: () =>
        reader({
          async workspaces() {
            throw Error("discovery must not read the workspace list");
          },
          async apps() {
            throw Error("discovery must not read the legacy apps list");
          },
          appCatalog:
            over.appCatalog ??
            (async (ws, locale) => {
              over.asked?.push(ws);
              return {
                state: "ok",
                data: ws ? workspaceCatalog(ws) : instanceCatalog(locale),
              };
            }),
        }),
      origin: () => OS,
      selection: async () => null,
      whoami: () => over.whoami ?? whoamiWith(true),
    });
  const get = (qs: string) =>
    new Request(`https://atlas.example/api/flightdeck/apps?${qs}`, {
      headers: { "accept-language": "en" },
    });

  test("⭐ an editor gets the instance-level DTO list with details links into the OS", async () => {
    const asked: (string | null)[] = [];
    const res = await discovery({ asked }).GET(get("mode=discovery"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { apps: unknown[] };
    expect(asked).toEqual([null]);
    expect(body).toMatchObject({
      mode: "discovery",
      available: true,
      state: "ok",
      scope: "instance",
      workspaceId: null,
      locale: "en",
    });
    expect(body.apps).toEqual([
      {
        id: "maps",
        label: "Maps",
        icon: "🗺️",
        version: "0.2.0",
        category: "analytics",
        availability: "available",
        tagline: "See where your people and sites are.",
        releaseRevision: 2,
        state: "available",
        detailsUrl: `${OS}/console/app-info/maps`,
      },
      {
        id: "docusign",
        label: "Flightdeck Sign",
        icon: "🗺️",
        version: "0.2.0",
        category: "analytics",
        availability: "available",
        tagline: "See where your people and sites are.",
        releaseRevision: 2,
        state: "unavailable",
        detailsUrl: `${OS}/console/app-info/docusign`,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("Bearer");
  });

  test("fails closed: an editor passing &workspaceId= gets 403 before any OS read", async () => {
    const asked: (string | null)[] = [];
    let whoamiRead = false;
    const res = await discovery({
      asked,
      whoami: async () => {
        whoamiRead = true;
        return { state: "ok", body: { integrationId: "atlas", features: { appDiscovery: true } } };
      },
    }).GET(get("mode=discovery&workspaceId=te-ops"));
    expect(res.status).toBe(403);
    expect(asked).toEqual([]);
    expect(whoamiRead).toBe(false);
  });

  test("the Super Admin may pass &workspaceId= and gets that workspace's consent states", async () => {
    const asked: (string | null)[] = [];
    const body = (await (
      await discovery({ asked, authorize: superAdmin }).GET(
        get("mode=discovery&workspaceId=te-ops"),
      )
    ).json()) as { apps: { state: string }[] };
    expect(asked).toEqual(["te-ops"]);
    expect(body).toMatchObject({
      mode: "discovery",
      available: true,
      scope: "workspace",
      workspaceId: "te-ops",
    });
    expect(body.apps.map((a) => a.state)).toEqual([
      "available",
      "awaiting-workspace-consent",
    ]);
  });

  test("without features.appDiscovery it answers {available:false, reason:'os-version'} and never asks for the catalog", async () => {
    const asked: (string | null)[] = [];
    const body = await (
      await discovery({ asked, whoami: whoamiWith(false) }).GET(get("mode=discovery"))
    ).json();
    expect(asked).toEqual([]);
    expect(body).toMatchObject({
      mode: "discovery",
      available: false,
      reason: "os-version",
      apps: [],
    });
    // An older OS whose whoami carries no features at all is the same.
    const older = await (
      await discovery({
        asked,
        whoami: async () => ({ state: "ok", body: { integrationId: "atlas" } }),
      }).GET(get("mode=discovery"))
    ).json();
    expect(older).toMatchObject({ available: false, reason: "os-version" });
    expect(asked).toEqual([]);
  });

  test("a 401 is 'not connected', never an empty list presented as success", async () => {
    const onWhoami = await (
      await discovery({ whoami: async () => ({ state: "unauthorized" }) }).GET(
        get("mode=discovery"),
      )
    ).json();
    expect(onWhoami).toMatchObject({
      mode: "discovery",
      available: false,
      reason: "not-connected",
      state: "unauthorized",
      apps: [],
    });
    const onCatalog = await (
      await discovery({ appCatalog: async () => ({ state: "unauthorized" }) }).GET(
        get("mode=discovery"),
      )
    ).json();
    expect(onCatalog).toMatchObject({
      available: false,
      reason: "not-connected",
      apps: [],
    });
    // The OS switching the feature off between whoami and the read is the
    // OS version answer, not an empty catalog.
    const raced = await (
      await discovery({ appCatalog: async () => ({ state: "feature_off" }) }).GET(
        get("mode=discovery"),
      )
    ).json();
    expect(raced).toMatchObject({ available: false, reason: "os-version", apps: [] });
  });

  test("not configured and an unreachable OS are honest, unavailable states", async () => {
    const off = createAppsRoute({
      authorize: editor,
      reader: () => null,
      origin: () => "",
      selection: async () => null,
      whoami: () => null,
    });
    expect(await (await off.GET(get("mode=discovery"))).json()).toMatchObject({
      available: false,
      reason: "not-configured",
      apps: [],
    });
    expect(
      await (
        await discovery({ whoami: async () => ({ state: "os_unreachable" }) }).GET(
          get("mode=discovery"),
        )
      ).json(),
    ).toMatchObject({ available: false, reason: "os-unreachable", apps: [] });
  });

  test("the existing mode is unchanged, and an unknown mode is refused", async () => {
    const route = createAppsRoute({
      authorize: editor,
      reader: () => reader(),
      origin: () => OS,
      selection: async () => null,
      whoami: () => whoamiWith(true),
    });
    const plain = await (await route.GET(get(""))).json();
    expect(plain).toMatchObject({ state: "ok", workspaceId: "te-ops" });
    expect(plain).not.toHaveProperty("mode");
    expect(plain).not.toHaveProperty("available");
    expect((await route.GET(get("mode=everything"))).status).toBe(400);
  });

  test("an Atlas refusal passes straight through before any OS read", async () => {
    let read = false;
    const route = createAppsRoute({
      authorize: async () => ({
        error: Response.json({ error: "Sign in to continue." }, { status: 401 }),
      }),
      reader: () => {
        read = true;
        return reader();
      },
      origin: () => OS,
      selection: async () => null,
      whoami: () => {
        read = true;
        return whoamiWith(true);
      },
    });
    expect((await route.GET(get("mode=discovery"))).status).toBe(401);
    expect(read).toBe(false);
  });
});
