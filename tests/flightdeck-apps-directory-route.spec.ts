import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createContextClient,
  type ContextResult,
} from "../lib/flightdeck/context-client";
import { osAppsDirectorySchema } from "../lib/flightdeck/context";
import {
  bridgeMediaUrl,
  clearCredential,
  createAppsDirectoryRoute,
  createDirectoryOs,
  credentialFingerprint,
  DIRECTORY_MAX_AGE_MS,
} from "../lib/flightdeck/apps-directory-route";
import {
  createDirectoryLoader,
  useAppsDirectory,
} from "../lib/flightdeck/apps-directory-client";
import { createOsWiring } from "../lib/flightdeck/os-wiring";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// apps-32: Atlas's consumer of the OS apps DIRECTORY (OS apps-29,
// GET /api/inbound/v1/context/workspaces/:ws/apps/directory?projectId&locale).
// The OS body used here is the OS-GENERATED fixture, vendored byte for byte
// with a sha256 pin (the OS side re-checks the same pin). Nothing here
// contacts FlightDeck OS: a fake fetch plays the OS.
const fixtureUrl = new URL(
  "./fixtures/inbound-apps-directory.v1.json",
  import.meta.url,
);
const fixtureText = readFileSync(fixtureUrl, "utf8");
const fixturePin = readFileSync(
  new URL("./fixtures/inbound-apps-directory.v1.sha256", import.meta.url),
  "utf8",
).trim();
const fixture = JSON.parse(fixtureText) as {
  workspaceId: string;
  projectId: string;
  locale: string;
  apps: Record<string, unknown>[];
};
const WS = fixture.workspaceId; // te-ops
const PROJECT = fixture.projectId; // rhineland-rollout
const OS = "http://127.0.0.1:4420";
const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);
const whoamiBody = (contracts?: unknown) => ({
  integrationId: "atlas",
  scopes: ["read:context"],
  ...(contracts === undefined ? {} : { contracts }),
});
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const DIR_PATH = `/api/inbound/v1/context/workspaces/${WS}/apps/directory`;

type Cache = Map<string, { until: number; value?: ContextResult<unknown> }>;
/** A fake OS: whoami plus the directory, recording every URL it is asked. */
function fakeOs(
  opts: {
    contracts?: unknown;
    directory?: (url: URL) => Response;
    whoamiStatus?: number;
  } = {},
) {
  const seen: string[] = [];
  const fetch = async (url: string) => {
    seen.push(url);
    const u = new URL(url);
    if (u.pathname === "/api/inbound/v1/whoami")
      return opts.whoamiStatus
        ? jsonResponse({ error: "no" }, opts.whoamiStatus)
        : jsonResponse(whoamiBody(opts.contracts ?? { "apps-directory": 1 }));
    if (u.pathname.endsWith("/apps/directory"))
      return opts.directory
        ? opts.directory(u)
        : jsonResponse({
            ...fixture,
            workspaceId: u.pathname.split("/")[6],
            projectId: u.searchParams.get("projectId"),
            locale: u.searchParams.get("locale"),
          });
    return jsonResponse({ error: "legacy route must not be used" }, 500);
  };
  return { seen, fetch };
}
const allowed = async () => ({ access: { userId: "u1", superAdmin: false } });
const saved = async () => ({ osWorkspaceId: WS, osProjectId: PROJECT });
const request = (lang = "de") =>
  new Request("http://atlas.test/api/flightdeck/apps/directory", {
    headers: { "accept-language": lang },
  });
function route(
  os: ReturnType<typeof fakeOs>,
  over: {
    cache?: Cache;
    token?: string;
    now?: () => number;
    selection?: () => Promise<{
      osWorkspaceId: string;
      osProjectId: string | null;
    } | null>;
    ttlMs?: number;
  } = {},
) {
  const cache = over.cache ?? new Map();
  return createAppsDirectoryRoute({
    authorize: allowed,
    os: () =>
      createDirectoryOs({
        config: { baseUrl: OS, token: over.token ?? TOKEN_A },
        cache,
        fetch: os.fetch,
        now: over.now,
        ttlMs: over.ttlMs,
      }),
    origin: () => OS,
    selection: over.selection ?? saved,
  });
}
type View = {
  state: string;
  workspaceId: string | null;
  projectId: string | null;
  apps: {
    id: string;
    workspaceStatus: string;
    url: string | null;
    tagline: string | null;
  }[];
};
const body = async (res: Response) => (await res.json()) as View;

test.describe("the vendored OS fixture", () => {
  test("is pinned by sha256 and parses with Atlas's strict directory schema", () => {
    expect(createHash("sha256").update(fixtureText).digest("hex")).toBe(
      fixturePin,
    );
    const parsed = osAppsDirectorySchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    // An undeclared key (e.g. consent internals) fails the whole answer.
    expect(
      osAppsDirectorySchema.safeParse({
        ...fixture,
        apps: [{ ...fixture.apps[0], visibleToRoles: ["admin"] }],
      }).success,
    ).toBe(false);
  });
});

test.describe("context client: appsDirectory()", () => {
  test("asks for the SELECTED project and locale, and rejects an answer for anything else", async () => {
    const seen: string[] = [];
    const run = (answer: unknown, status = 200) =>
      createContextClient(
        { baseUrl: OS, token: TOKEN_A },
        {
          fetch: async (url) => {
            seen.push(url);
            return jsonResponse(answer, status);
          },
        },
      ).appsDirectory!(WS, PROJECT, "de");
    expect((await run(fixture)).state).toBe("ok");
    expect(seen[0]).toBe(
      `${OS}${DIR_PATH}?projectId=${PROJECT}&locale=de`,
    );
    for (const lie of [
      { workspaceId: "hr-de" },
      { projectId: "general" },
      { locale: "en" },
      { contract: 2 },
    ])
      expect(await run({ ...fixture, ...lie })).toEqual({
        state: "invalid_response",
      });
    expect(await run({}, 401)).toEqual({ state: "unauthorized" });
    expect(await run({}, 403)).toEqual({ state: "unauthorized" });
  });
});

test.describe("/api/flightdeck/apps/directory", () => {
  test("⭐ lists the saved project's directory; a link only for an enabled app", async () => {
    const os = fakeOs();
    const res = await route(os).GET(request("de"));
    expect(res.status).toBe(200);
    const v = await body(res);
    expect(v.state).toBe("ok");
    expect(v.workspaceId).toBe(WS);
    expect(v.projectId).toBe(PROJECT);
    expect(os.seen).toContain(
      `${OS}${DIR_PATH}?projectId=${PROJECT}&locale=de`,
    );
    const maps = v.apps.find((a) => a.id === "maps")!;
    expect(maps.url).toBe(
      `${OS}/console/apps/maps?fdWorkspace=${WS}&fdProject=${PROJECT}`,
    );
    const kg = v.apps.find((a) => a.id === "knowledge-guardian")!;
    expect(kg.workspaceStatus).toBe("needs-function-enable");
    expect(kg.url).toBeNull();
    expect(kg.tagline).toBe(fixture.apps[1].tagline);
    expect(JSON.stringify(v)).not.toContain(TOKEN_A);
  });

  test("a path on a locked app is never turned into a link", async () => {
    const os = fakeOs({
      directory: (u) =>
        jsonResponse({
          ...fixture,
          locale: u.searchParams.get("locale"),
          apps: [
            {
              ...fixture.apps[1],
              path: "/console/apps/knowledge-guardian",
            },
          ],
        }),
    });
    const v = await body(await route(os).GET(request("de")));
    expect(v.state).toBe("ok");
    expect(v.apps[0].url).toBeNull();
  });

  test("without contracts['apps-directory'] === 1 it is directory_unavailable and never falls back to /apps", async () => {
    for (const contracts of [{}, { "apps-directory": 2 }, "nope"]) {
      const os = fakeOs({ contracts });
      const v = await body(await route(os).GET(request()));
      expect(v).toMatchObject({ state: "directory_unavailable", apps: [] });
      expect(os.seen.some((u) => /\/apps(\?|$|\/directory)/.test(u))).toBe(
        false,
      );
    }
  });

  test("no saved project is reported, never answered with the default project's apps", async () => {
    const os = fakeOs();
    for (const selection of [
      async () => null,
      async () => ({ osWorkspaceId: WS, osProjectId: null }),
    ]) {
      const v = await body(await route(os, { selection }).GET(request()));
      expect(v).toMatchObject({ state: "no_project_selected", apps: [] });
    }
    expect(os.seen.filter((u) => u.includes("/apps"))).toEqual([]);
  });

  test("a 404 for the project is 'project_not_available', a 409 is workspace_disabled", async () => {
    const notFound = fakeOs({
      directory: () => jsonResponse({ error: "not found" }, 404),
    });
    expect(await body(await route(notFound).GET(request()))).toMatchObject({
      state: "project_not_available",
      apps: [],
    });
    const disabled = fakeOs({
      directory: () =>
        jsonResponse(
          { error: "workspace disabled", code: "workspace_disabled" },
          409,
        ),
    });
    expect(await body(await route(disabled).GET(request()))).toMatchObject({
      state: "workspace_disabled",
      apps: [],
    });
  });

  test("cache keys are (origin, credential fingerprint, workspace, project, locale) and never hold the secret", async () => {
    const cache: Cache = new Map();
    const os = fakeOs();
    await route(os, { cache }).GET(request("de"));
    await route(os, { cache }).GET(request("de"));
    const dirCalls = () => os.seen.filter((u) => u.includes("/directory"));
    expect(dirCalls()).toHaveLength(1); // cached
    await route(os, { cache }).GET(request("en"));
    expect(dirCalls()).toHaveLength(2); // another locale
    await route(os, {
      cache,
      selection: async () => ({ osWorkspaceId: WS, osProjectId: "other" }),
    }).GET(request("de"));
    expect(dirCalls()).toHaveLength(3); // another project
    await route(os, { cache, token: TOKEN_B }).GET(request("de"));
    expect(dirCalls()).toHaveLength(4); // another credential
    const fpA = await credentialFingerprint(TOKEN_A);
    expect(fpA).toMatch(/^[0-9a-f]{16,64}$/);
    expect(fpA).not.toBe(await credentialFingerprint(TOKEN_B));
    for (const key of cache.keys()) {
      expect(key).not.toContain(TOKEN_A);
      expect(key).not.toContain(TOKEN_B);
    }
    expect(
      [...cache.keys()].some(
        (k) =>
          k.startsWith(`${OS}|${fpA}|`) &&
          k.includes(`/workspaces/${WS}/apps/directory?projectId=${PROJECT}&locale=de`),
      ),
    ).toBe(true);
  });

  test("a 401/403 deletes EVERY cached key for that credential, and only that credential's", async () => {
    for (const status of [401, 403]) {
      const cache: Cache = new Map();
      let revoked = false;
      const os = fakeOs({
        directory: (u) =>
          revoked
            ? jsonResponse({ error: "revoked" }, status)
            : jsonResponse({
                ...fixture,
                projectId: u.searchParams.get("projectId"),
                locale: u.searchParams.get("locale"),
              }),
      });
      const other = fakeOs();
      const otherProject = async () => ({
        osWorkspaceId: WS,
        osProjectId: "other",
      });
      await route(os, { cache }).GET(request("de"));
      await route(os, { cache, selection: otherProject }).GET(request("de"));
      await route(other, { cache, token: TOKEN_B }).GET(request("de"));
      const fpA = await credentialFingerprint(TOKEN_A);
      const fpB = await credentialFingerprint(TOKEN_B);
      const count = (fp: string) =>
        [...cache.keys()].filter((k) => k.startsWith(`${OS}|${fp}|`)).length;
      expect(count(fpA)).toBeGreaterThanOrEqual(3); // whoami + 2 directories
      revoked = true;
      const v = await body(
        await route(os, { cache }).GET(
          new Request("http://atlas.test/x", {
            headers: { "accept-language": "en" },
          }),
        ),
      );
      expect(v).toMatchObject({ state: "unauthorized", apps: [] });
      expect(count(fpA)).toBe(0);
      expect(count(fpB)).toBeGreaterThanOrEqual(2);
      // The other project's list is not served from the cache any more.
      const after = await body(
        await route(os, { cache, selection: otherProject }).GET(request("de")),
      );
      expect(after.state).toBe("unauthorized");
    }
  });

  test("a revoked credential at whoami clears the credential's keys too", async () => {
    const cache: Cache = new Map();
    await route(fakeOs(), { cache }).GET(request("de"));
    const fpA = await credentialFingerprint(TOKEN_A);
    expect([...cache.keys()].some((k) => k.startsWith(`${OS}|${fpA}|`))).toBe(
      true,
    );
    // whoami is cached, so drop only its key to force a re-read that is refused.
    for (const k of [...cache.keys()])
      if (k.endsWith("/api/inbound/v1/whoami")) cache.delete(k);
    const v = await body(
      await route(fakeOs({ whoamiStatus: 401 }), { cache }).GET(request("de")),
    );
    expect(v.state).toBe("unauthorized");
    expect([...cache.keys()].some((k) => k.startsWith(`${OS}|${fpA}|`))).toBe(
      false,
    );
  });

  test("nothing older than five minutes is served, whatever TTL is asked for", async () => {
    const cache: Cache = new Map();
    let t = 1_000_000;
    const os = fakeOs();
    const r = () =>
      route(os, { cache, now: () => t, ttlMs: 60 * 60_000 }).GET(request());
    await r();
    t += DIRECTORY_MAX_AGE_MS - 1;
    await r();
    const dirCalls = () => os.seen.filter((u) => u.includes("/directory"));
    const whoamiCalls = () => os.seen.filter((u) => u.includes("/whoami"));
    expect(dirCalls()).toHaveLength(1);
    t += 2;
    await r();
    expect(dirCalls()).toHaveLength(2);
    expect(whoamiCalls()).toHaveLength(2);
    expect(DIRECTORY_MAX_AGE_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  test("an Atlas refusal passes straight through before any OS read", async () => {
    let read = false;
    const r = createAppsDirectoryRoute({
      authorize: async () => ({
        error: Response.json({ error: "Sign in to continue." }, { status: 401 }),
      }),
      os: () => {
        read = true;
        return null;
      },
      origin: () => OS,
      selection: saved,
    });
    expect((await r.GET(request())).status).toBe(401);
    expect(read).toBe(false);
  });

  test("not configured is an honest state", async () => {
    const r = createAppsDirectoryRoute({
      authorize: allowed,
      os: () => null,
      origin: () => "",
      selection: saved,
    });
    expect(await body(await r.GET(request()))).toMatchObject({
      state: "not_configured",
      apps: [],
    });
  });
});

test("bridge media URLs survive only on the OS origin under /console/bridge-media/", () => {
  expect(bridgeMediaUrl(`${OS}/console/bridge-media/maps/poster.webp`, OS)).toBe(
    `${OS}/console/bridge-media/maps/poster.webp`,
  );
  for (const bad of [
    "https://evil.example/console/bridge-media/maps/x.webp",
    `${OS}/console/apps/maps`,
    `${OS}/console/bridge-media/../secret`,
    `${OS}/console/bridge-media/%2e%2e/secret`,
    "http://127.0.0.1:4421/console/bridge-media/maps/x.webp",
    "javascript:alert(1)",
    "/console/bridge-media/maps/x.webp",
    `${OS.replace("http://", "http://user:pw@")}/console/bridge-media/maps/x.webp`,
    42,
  ])
    expect(bridgeMediaUrl(bad, OS)).toBeNull();
  expect(bridgeMediaUrl(`${OS}/console/bridge-media/maps/x.webp`, "")).toBeNull();
});

test("clearCredential removes exactly the keys under one prefix", () => {
  const cache: Cache = new Map([
    ["o|fa|x", { until: 1 }],
    ["o|fa|y", { until: 1 }],
    ["o|fb|x", { until: 1 }],
    ["rate-limit", { until: 1 }],
  ]);
  expect(clearCredential(cache, "o|fa|")).toBe(2);
  expect([...cache.keys()]).toEqual(["o|fb|x", "rate-limit"]);
});

test.describe("the client loader", () => {
  const ok = (ws: string, project: string) =>
    jsonResponse({ state: "ok", workspaceId: ws, projectId: project, apps: [{ id: "maps" }] });

  test("clears its data on any failed fetch", async () => {
    let answer: () => Promise<Response> = async () => ok(WS, PROJECT);
    const loader = createDirectoryLoader({ fetch: () => answer() });
    await loader.load({ osWorkspaceId: WS, osProjectId: PROJECT });
    expect(loader.snapshot().data?.apps).toHaveLength(1);
    for (const fail of [
      async () => {
        throw Error("offline");
      },
      async () => jsonResponse({ error: "no" }, 500),
      async () => jsonResponse({ state: "os_unreachable", apps: [] }),
      async () => new Response("<html>", { status: 200 }),
    ]) {
      answer = async () => ok(WS, PROJECT);
      await loader.load({ osWorkspaceId: WS, osProjectId: PROJECT });
      expect(loader.snapshot().data).not.toBeNull();
      answer = fail;
      await loader.load({ osWorkspaceId: WS, osProjectId: PROJECT });
      expect(loader.snapshot().data).toBeNull();
    }
  });

  test("rapid workspace switching never shows another workspace's list", async () => {
    const pending: Record<string, (r: Response) => void> = {};
    const loader = createDirectoryLoader({
      fetch: () =>
        new Promise<Response>((resolve) => {
          pending[Object.keys(pending).length] = resolve;
        }),
    });
    const first = loader.load({ osWorkspaceId: "te-ops", osProjectId: "p1" });
    // The switch clears the old list at once, before any answer.
    const second = loader.load({ osWorkspaceId: "hr-de", osProjectId: "p2" });
    expect(loader.snapshot().data).toBeNull();
    pending[1](ok("hr-de", "p2"));
    await second;
    expect(loader.snapshot().data?.workspaceId).toBe("hr-de");
    // The slow answer for the old workspace arrives last and is dropped.
    pending[0](ok("te-ops", "p1"));
    await first;
    expect(loader.snapshot().data?.workspaceId).toBe("hr-de");
  });

  test("an answer that is not for the selection it was asked for is dropped", async () => {
    const loader = createDirectoryLoader({ fetch: async () => ok("hr-de", "p2") });
    await loader.load({ osWorkspaceId: "te-ops", osProjectId: "p1" });
    expect(loader.snapshot().data).toBeNull();
  });
});

// Review round 2: ONE refusal of the credential, seen by ANY reader of the
// isolate (context lists, whoami, directory, submissions), must stop every
// other reader from serving what it cached for that credential.
test.describe("credential-wide revocation across every reader of the isolate", () => {
  const config = { baseUrl: OS, token: TOKEN_A };
  const WORKSPACES = {
    integrationId: "atlas",
    workspaces: [{ id: WS, label: "TE Ops", enabled: true, isDefault: true }],
    generatedAt: "2026-09-26T08:00:00.000Z",
  };
  /** A fake OS that answers everything until `revoke(status)`, then refuses
   * every call with that status. */
  function revocableOs() {
    let refusal = 0;
    const seen: string[] = [];
    const inner = fakeOs();
    const fetch = async (url: string, init?: RequestInit) => {
      seen.push(url);
      if (refusal) return jsonResponse({ error: "revoked" }, refusal);
      const u = new URL(url);
      if (u.pathname === "/api/inbound/v1/context/workspaces")
        return jsonResponse(WORKSPACES);
      if (u.pathname === "/api/inbound/v1/submissions")
        return jsonResponse({ error: "bad" }, 400);
      void init;
      return inner.fetch(url);
    };
    return { fetch, seen, revoke: (status: number) => (refusal = status) };
  }
  const directoryRoute = (wiring: ReturnType<typeof createOsWiring>) =>
    createAppsDirectoryRoute({
      authorize: allowed,
      os: () => wiring.directory(config),
      origin: () => OS,
      selection: saved,
    });
  const warm = async (wiring: ReturnType<typeof createOsWiring>) => {
    const first = await body(await directoryRoute(wiring).GET(request("de")));
    expect(first.state).toBe("ok");
    expect(first.apps.length).toBeGreaterThan(0);
  };

  for (const status of [401, 403])
    test(`a ${status} on the CONTEXT reader stops the cached directory being served`, async () => {
      const os = revocableOs();
      const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
      await warm(wiring);
      os.revoke(status);
      expect((await wiring.reader(config, true).workspaces()).state).toBe(
        "unauthorized",
      );
      const after = await body(await directoryRoute(wiring).GET(request("de")));
      expect(after.state).not.toBe("ok");
      expect(after.apps).toEqual([]);
    });

  for (const status of [401, 403])
    test(`a ${status} at the Connections whoami stops the cached directory being served`, async () => {
      const os = revocableOs();
      const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
      await warm(wiring);
      os.revoke(status);
      expect((await wiring.whoami(config, true)()).state).not.toBe("ok");
      const after = await body(await directoryRoute(wiring).GET(request("de")));
      expect(after.state).not.toBe("ok");
      expect(after.apps).toEqual([]);
    });

  test("a 401 on the features read (before a send) stops the cached directory being served", async () => {
    const os = revocableOs();
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    await warm(wiring);
    os.revoke(401);
    await wiring.features(config);
    const after = await body(await directoryRoute(wiring).GET(request("de")));
    expect(after.state).not.toBe("ok");
  });

  test("a refused submission stops the cached directory being served", async () => {
    const os = revocableOs();
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    await warm(wiring);
    os.revoke(401);
    const sent = await wiring
      .submissions(config)
      .readSubmission("0123456789abcdef01234567");
    expect(sent.state).toBe("unauthorized");
    const after = await body(await directoryRoute(wiring).GET(request("de")));
    expect(after.state).not.toBe("ok");
  });

  test("a refusal at the directory clears the context lists and the kept Connections whoami", async () => {
    const os = revocableOs();
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    expect((await wiring.reader(config, false).workspaces()).state).toBe("ok");
    expect((await wiring.whoami(config, true)()).state).toBe("ok");
    await warm(wiring);
    os.revoke(401);
    // The directory is cached, so read another project to reach the OS.
    const other = await body(
      await createAppsDirectoryRoute({
        authorize: allowed,
        os: () => wiring.directory(config),
        origin: () => OS,
        selection: async () => ({ osWorkspaceId: WS, osProjectId: "other" }),
      }).GET(request("de")),
    );
    expect(other.state).toBe("unauthorized");
    expect((await wiring.reader(config, false).workspaces()).state).toBe(
      "unauthorized",
    );
    expect((await wiring.whoami(config, false)()).state).toBe("unauthorized");
  });

  test("the credential-wide rate-limit block survives a revocation", async () => {
    const cache: Cache = new Map();
    const os = revocableOs();
    const wiring = createOsWiring({ cache, fetch: os.fetch });
    await warm(wiring);
    cache.set("rate-limit", { until: Date.now() + 60_000 });
    os.revoke(401);
    await wiring.reader(config, true).projects(WS).catch(() => undefined);
    await wiring.whoami(config, true)();
    expect(cache.has("rate-limit")).toBe(true);
  });
});

// Review round 3: a read that STARTED before the revocation and succeeds
// AFTER it (the OS answered before refusing) must not be returned as ok, and
// must not repopulate any cache or kept answer.
test.describe("in-flight reads that straddle a revocation are discarded", () => {
  const config = { baseUrl: OS, token: TOKEN_A };
  const WORKSPACES = {
    integrationId: "atlas",
    workspaces: [{ id: WS, label: "TE Ops", enabled: true, isDefault: true }],
    generatedAt: "2026-09-26T08:00:00.000Z",
  };
  /** A fake OS whose answer is decided when a call ARRIVES (before or after
   * `revoke`), but whose calls matching `hold` are only delivered on
   * `release()`. */
  function straddlingOs(hold: (u: URL) => boolean) {
    let refusal = 0;
    let calls = 0;
    const held: (() => void)[] = [];
    const inner = fakeOs();
    const fetch = async (url: string) => {
      calls++;
      const u = new URL(url);
      const answer = refusal
        ? jsonResponse({ error: "revoked" }, refusal)
        : u.pathname === "/api/inbound/v1/context/workspaces"
          ? jsonResponse(WORKSPACES)
          : u.pathname === "/api/inbound/v1/whoami"
            ? jsonResponse({
                ...whoamiBody({ "apps-directory": 1 }),
                features: { decisionNote: true },
              })
            : await inner.fetch(url);
      if (!refusal && hold(u))
        await new Promise<void>((resolve) => held.push(resolve));
      return answer;
    };
    const flush = () => new Promise((r) => setTimeout(r, 5));
    return {
      fetch,
      calls: () => calls,
      revoke: (status: number) => (refusal = status),
      /** Waits (at most a second) until a matching call is being held. */
      held: async () => {
        for (let i = 0; i < 200 && !held.length; i++) await flush();
        return held.length;
      },
      release: async () => {
        held.splice(0).forEach((r) => r());
        await flush();
      },
      flush,
    };
  }
  const isWhoami = (u: URL) => u.pathname === "/api/inbound/v1/whoami";
  const directoryRoute = (wiring: ReturnType<typeof createOsWiring>) =>
    createAppsDirectoryRoute({
      authorize: allowed,
      os: () => wiring.directory(config),
      origin: () => OS,
      selection: saved,
    });
  /** The refusal another request sees while the held read is in flight. */
  const refuseElsewhere = async (
    os: ReturnType<typeof straddlingOs>,
    wiring: ReturnType<typeof createOsWiring>,
  ) => {
    os.revoke(401);
    expect((await wiring.reader(config, true).workspaces()).state).toBe(
      "unauthorized",
    );
  };

  test("a late directory capability is not served or cached", async () => {
    const os = straddlingOs(isWhoami);
    const cache: Cache = new Map();
    const wiring = createOsWiring({ cache, fetch: os.fetch });
    const late = wiring.directory(config).capability();
    expect(await os.held()).toBe(1);
    await refuseElsewhere(os, wiring);
    await os.release();
    expect((await late).state).not.toBe("ok");
    const before = os.calls();
    const next = await wiring.directory(config).capability();
    expect(next.state).not.toBe("ok");
    expect(os.calls()).toBeGreaterThan(before); // it asked the OS again
    expect([...cache.keys()].filter((k) => k !== "rate-limit")).toEqual([]);
  });

  test("a late directory list is not served or cached", async () => {
    const os = straddlingOs((u) => u.pathname.endsWith("/apps/directory"));
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    const late = directoryRoute(wiring).GET(request("de"));
    expect(await os.held()).toBe(1);
    await refuseElsewhere(os, wiring);
    await os.release();
    const lateView = await body(await late);
    expect(lateView.state).not.toBe("ok");
    expect(lateView.apps).toEqual([]);
    const next = await body(await directoryRoute(wiring).GET(request("de")));
    expect(next.state).not.toBe("ok");
  });

  test("a late context list is not served or cached", async () => {
    const os = straddlingOs(
      (u) => u.pathname === "/api/inbound/v1/context/workspaces",
    );
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    const late = wiring.reader(config, false).workspaces();
    expect(await os.held()).toBe(1);
    os.revoke(401);
    expect((await wiring.whoami(config, true)()).state).toBe("unauthorized");
    await os.release();
    expect((await late).state).not.toBe("ok");
    expect((await wiring.reader(config, false).workspaces()).state).toBe(
      "unauthorized",
    );
  });

  test("a late Connections whoami is not returned ok or kept", async () => {
    const os = straddlingOs(isWhoami);
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    const late = wiring.whoami(config, true)();
    expect(await os.held()).toBe(1);
    await refuseElsewhere(os, wiring);
    await os.release();
    expect((await late).state).not.toBe("ok");
    expect((await wiring.whoami(config, false)()).state).toBe("unauthorized");
  });

  test("a late features read answers no features and is not kept", async () => {
    const os = straddlingOs(isWhoami);
    const wiring = createOsWiring({ cache: new Map(), fetch: os.fetch });
    const late = wiring.features(config);
    expect(await os.held()).toBe(1);
    await refuseElsewhere(os, wiring);
    await os.release();
    expect(Object.values(await late).some(Boolean)).toBe(false);
    const before = os.calls();
    await wiring.features(config);
    expect(os.calls()).toBeGreaterThan(before);
  });
});

// Review round 2: the hook must mask, DURING RENDER, a snapshot that belongs
// to another selection; the passive effect that clears it runs only after
// that render has committed.
test.describe("useAppsDirectory masks another selection's list during render", () => {
  const ok = (ws: string, project: string) =>
    jsonResponse({
      state: "ok",
      workspaceId: ws,
      projectId: project,
      locale: "en",
      apps: [{ id: "maps", label: "Maps" }],
      retryAfter: null,
    });
  function Probe(props: {
    selection: { osWorkspaceId: string; osProjectId: string | null } | null;
    loader: ReturnType<typeof createDirectoryLoader>;
  }) {
    const d = useAppsDirectory(props.selection, props.loader);
    return createElement(
      "pre",
      null,
      JSON.stringify({ data: d.data, loading: d.loading, state: d.state }),
    );
  }
  const render = (
    selection: { osWorkspaceId: string; osProjectId: string | null } | null,
    loader: ReturnType<typeof createDirectoryLoader>,
  ) =>
    JSON.parse(
      renderToStaticMarkup(createElement(Probe, { selection, loader }))
        .replace(/^<pre>/, "")
        .replace(/<\/pre>$/, "")
        .replace(/&quot;/g, '"'),
    ) as { data: { workspaceId: string } | null; loading: boolean; state: string | null };

  test("the selection's own list is shown", async () => {
    const loader = createDirectoryLoader({ fetch: async () => ok("te-ops", "p1") });
    await loader.load({ osWorkspaceId: "te-ops", osProjectId: "p1" });
    expect(
      render({ osWorkspaceId: "te-ops", osProjectId: "p1" }, loader).data
        ?.workspaceId,
    ).toBe("te-ops");
  });

  for (const [label, next] of [
    ["another project", { osWorkspaceId: "te-ops", osProjectId: "p2" }],
    ["another workspace", { osWorkspaceId: "hr-de", osProjectId: "p1" }],
    ["no project", { osWorkspaceId: "te-ops", osProjectId: null }],
    ["a cleared selection", null],
  ] as const)
    test(`switching to ${label} never renders the old list, not even once`, async () => {
      const loader = createDirectoryLoader({
        fetch: async () => ok("te-ops", "p1"),
      });
      await loader.load({ osWorkspaceId: "te-ops", osProjectId: "p1" });
      const v = render(next, loader);
      expect(v.data).toBeNull();
      expect(v.state).toBeNull();
    });
});
