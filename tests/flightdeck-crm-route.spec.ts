import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCrmClient,
  type ContextReader,
  type WhoamiRead,
} from "../lib/flightdeck/context-client";
import {
  CRM_PROJECTION_FIXTURE_SHA256,
  crmProjectionV1Schema,
} from "../lib/flightdeck/crm-contract";
import {
  createCrmRoute,
  type CrmOs,
  type StoredLink,
} from "../lib/flightdeck/crm-route";
import { createOsWiring } from "../lib/flightdeck/os-wiring";

// crm-40: Atlas's authorised server route for ONE project's CRM projection
// (GET /api/flightdeck/crm?project=<atlasId> and .../crm/revision). The OS
// side is crm-37 (GET /api/inbound/v1/context/workspaces/:ws/projects/:id/crm
// and .../crm/revision); the written contract is the OS's
// docs/CRM-ATLAS-SYNC-CONTRACT.md. The OS body here is the SHARED fixture,
// vendored byte for byte with the contract's sha256 pin. Nothing here
// contacts FlightDeck OS: a fake fetch or a fake reader plays the OS.
const fixtureText = readFileSync(
  new URL("./fixtures/crm-projection-v1.json", import.meta.url),
  "utf8",
);
const fixturePin = readFileSync(
  new URL("./fixtures/crm-projection-v1.sha256", import.meta.url),
  "utf8",
).trim();
const fixture = () =>
  JSON.parse(fixtureText) as Record<string, unknown> & { projectId: string };
const bad = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/crm-projection-v1.bad-${name}.json`, import.meta.url),
      "utf8",
    ),
  );
/** The pin written in the OS's docs/CRM-ATLAS-SYNC-CONTRACT.md §Fixtures. */
const OS_CONTRACT_PIN =
  "4b408bbded4c8a4309d4289fc5da77174f002d016383b5343e8d21f0a2de7f6b";

// A synthetic credential: it must never appear in anything Atlas answers.
const TOKEN = "fdtest_SYNTHETIC_0123";
const OS = "http://127.0.0.1:4420";
const ATLAS = "http://atlas.test";
const INSTALL = "atlas-local";
const OS_INSTANCE = "os-instance-a";
const WS = "hr-de";
const OS_PROJECT = fixture().projectId; // nordwind-rollout
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test.describe("the vendored CRM projection fixture (DTO v1)", () => {
  test("is byte-identical to the OS fixture: the checked-in sha256 equals the contract's pin", () => {
    const digest = createHash("sha256").update(fixtureText).digest("hex");
    expect(digest).toBe(fixturePin);
    expect(fixturePin).toBe(OS_CONTRACT_PIN);
    expect(CRM_PROJECTION_FIXTURE_SHA256).toBe(OS_CONTRACT_PIN);
  });

  test("parses unchanged with Atlas's strict copy of v1", () => {
    const parsed = crmProjectionV1Schema.safeParse(fixture());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(fixture());
  });

  test("the strict copy refuses every negative fixture (email, phone, full name, amount, extra key)", () => {
    for (const name of ["email", "phone", "fullname", "amount", "extra-key"])
      expect(crmProjectionV1Schema.safeParse(bad(name)).success, name).toBe(
        false,
      );
    // An unknown schema version is refused, never read as v1.
    expect(
      crmProjectionV1Schema.safeParse({ ...fixture(), schemaVersion: 2 })
        .success,
    ).toBe(false);
  });
});

test.describe("context client: the CRM reads", () => {
  test("asks for exactly the ids it is given, with the bearer credential, and parses strictly", async () => {
    const seen: string[] = [];
    const client = createCrmClient(
      { baseUrl: OS, token: TOKEN },
      {
        fetch: async (url, init) => {
          seen.push(url);
          expect((init.headers as Record<string, string>).Authorization).toBe(
            `Bearer ${TOKEN}`,
          );
          return url.endsWith("/revision")
            ? jsonResponse({ projectId: OS_PROJECT, revision: 17 })
            : jsonResponse(fixture());
        },
      },
    );
    expect(await client.projection(WS, OS_PROJECT)).toEqual({
      state: "ok",
      data: fixture(),
    });
    expect(await client.revision(WS, OS_PROJECT)).toEqual({
      state: "ok",
      data: { projectId: OS_PROJECT, revision: 17 },
    });
    expect(seen).toEqual([
      `${OS}/api/inbound/v1/context/workspaces/${WS}/projects/${OS_PROJECT}/crm`,
      `${OS}/api/inbound/v1/context/workspaces/${WS}/projects/${OS_PROJECT}/crm/revision`,
    ]);
  });

  test("another project's answer, an unknown key and every OS refusal fail closed", async () => {
    const run = (answer: () => Promise<Response>) =>
      createCrmClient({ baseUrl: OS, token: TOKEN }, { fetch: answer });
    expect(
      await run(async () =>
        jsonResponse({ ...fixture(), projectId: "another" }),
      ).projection(WS, OS_PROJECT),
    ).toEqual({ state: "invalid_response" });
    expect(
      await run(async () =>
        jsonResponse({ ...fixture(), email: "a@b.example" }),
      ).projection(WS, OS_PROJECT),
    ).toEqual({ state: "invalid_response" });
    expect(
      await run(async () =>
        jsonResponse({ projectId: "another", revision: 3 }),
      ).revision(WS, OS_PROJECT),
    ).toEqual({ state: "invalid_response" });
    const states = [];
    for (const [status, body] of [
      [401, { error: "unauthorized" }],
      [403, { error: "credential lacks the read:crm scope", reason: "scope-missing" }],
      [404, { error: "not found" }],
      [409, { error: "workspace disabled", code: "workspace_disabled" }],
      [503, { error: "x", code: "crm_projection_invalid" }],
      [503, { error: "x", code: "crm_not_ready" }],
      [500, { error: "boom" }],
    ] as const)
      states.push(
        (await run(async () => jsonResponse(body, status)).projection(WS, OS_PROJECT))
          .state,
      );
    expect(states).toEqual([
      "unauthorized",
      "refused",
      "not_found",
      "workspace_disabled",
      "crm_projection_invalid",
      "crm_not_ready",
      "invalid_response",
    ]);
    expect(
      await run(async () => {
        throw new Error("down");
      }).projection(WS, OS_PROJECT),
    ).toEqual({ state: "os_unreachable" });
  });

  test("a malformed id is never joined into a path", async () => {
    let asked = false;
    const client = createCrmClient(
      { baseUrl: OS, token: TOKEN },
      {
        fetch: async () => {
          asked = true;
          return jsonResponse(fixture());
        },
      },
    );
    expect(await client.projection("../admin", OS_PROJECT)).toEqual({
      state: "not_found",
    });
    expect(await client.revision(WS, "a/b")).toEqual({ state: "not_found" });
    expect(asked).toBe(false);
  });
});

// ── The route ────────────────────────────────────────────────────────────

type Access = { userId: string; superAdmin: boolean };
const member = async () => ({
  access: { userId: "u-member", superAdmin: false } as Access,
});
const link: StoredLink = {
  installationId: INSTALL,
  osInstanceId: OS_INSTANCE,
  workspaceId: WS,
  osProjectId: OS_PROJECT,
  accessState: "active",
};
const wsBody = {
  integrationId: "atlas",
  instanceId: OS_INSTANCE,
  workspaces: [
    { id: "te-ops", label: "TE Operations", enabled: true, isDefault: true },
    { id: WS, label: "HR Germany", enabled: true, isDefault: false },
  ],
  generatedAt: "2026-09-26T08:00:00.000Z",
};
const whoamiOk = (scopes = ["read:context", "read:crm"]): WhoamiRead => ({
  state: "ok",
  body: { integrationId: "atlas", scopes },
});

type Setup = {
  authorize?: () => Promise<
    { access: Access; error?: never } | { access?: never; error: Response }
  >;
  projectFor?: (access: Access, id: string) => Promise<unknown>;
  links?: StoredLink[];
  installationId?: string | null;
  workspaces?: ContextReader["workspaces"];
  whoami?: WhoamiRead;
  crm?: Partial<CrmOs>;
  superAdminOnly?: boolean;
};
function harness(setup: Setup = {}) {
  const asked: string[] = [];
  const logged: { event: string; reason: string; detail?: string }[] = [];
  const looked: string[] = [];
  let authorized = 0;
  const route = createCrmRoute({
    authorize: async () => {
      authorized++;
      return (setup.authorize ?? member)();
    },
    projectFor: async (access, id) =>
      setup.projectFor
        ? setup.projectFor(access as Access, id)
        : id === "atlas-1"
          ? { id }
          : null,
    links: async (id) => {
      looked.push(id);
      return setup.links ?? [link];
    },
    installationId: () =>
      setup.installationId === undefined ? INSTALL : setup.installationId,
    reader: () => ({
      workspaces:
        setup.workspaces ?? (async () => ({ state: "ok", data: wsBody })),
      projects: async () => ({ state: "invalid_response" }),
    }),
    whoami: () => async () => setup.whoami ?? whoamiOk(),
    crm: () => ({
      async projection(ws, project) {
        asked.push(`projection ${ws}/${project}`);
        return setup.crm?.projection
          ? setup.crm.projection(ws, project)
          : { state: "ok", data: fixture() as never };
      },
      async revision(ws, project) {
        asked.push(`revision ${ws}/${project}`);
        return setup.crm?.revision
          ? setup.crm.revision(ws, project)
          : { state: "ok", data: { projectId: project, revision: 17 } };
      },
    }),
    origin: () => OS,
    log: (entry) => logged.push(entry),
    superAdminOnly: setup.superAdminOnly,
  });
  return {
    route,
    asked,
    logged,
    looked,
    get authorized() {
      return authorized;
    },
  };
}
const get = (query: string, headers: Record<string, string> = {}) =>
  new Request(`${ATLAS}/api/flightdeck/crm?${query}`, { headers });
const getRevision = (query: string, headers: Record<string, string> = {}) =>
  new Request(`${ATLAS}/api/flightdeck/crm/revision?${query}`, { headers });

test.describe("/api/flightdeck/crm: authorisation", () => {
  test("⭐ a project member with read access gets the validated projection and a deep link on the configured OS origin", async () => {
    const h = harness();
    const res = await h.route.GET(get("project=atlas-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      state: "ok",
      projection: fixture(),
      openUrl: `${OS}/console/crm?fdWorkspace=${WS}&fdProject=${OS_PROJECT}`,
    });
    expect(h.asked).toEqual([`projection ${WS}/${OS_PROJECT}`]);
  });

  test("no session, no project read right, an unknown or a malformed project: 404 and nothing read", async () => {
    const noSession = harness({
      authorize: async () => ({
        error: Response.json({ error: "Sign in to continue." }, { status: 401 }),
      }),
    });
    expect((await noSession.route.GET(get("project=atlas-1"))).status).toBe(404);
    expect(noSession.looked).toEqual([]);
    expect(noSession.asked).toEqual([]);

    const noRight = harness({ projectFor: async () => null });
    expect((await noRight.route.GET(get("project=atlas-1"))).status).toBe(404);
    expect(noRight.looked).toEqual([]);

    const unknown = harness();
    expect((await unknown.route.GET(get("project=atlas-9"))).status).toBe(404);
    expect((await unknown.route.GET(get(""))).status).toBe(404);
    expect(
      (await unknown.route.GET(get(`project=${"x".repeat(200)}`))).status,
    ).toBe(404);
    expect(unknown.looked).toEqual([]);
    expect(unknown.asked).toEqual([]);
  });

  test("the one-line Super-Admin-only gate, when set, refuses members with the same 404", async () => {
    const h = harness({ superAdminOnly: true });
    expect((await h.route.GET(get("project=atlas-1"))).status).toBe(404);
    expect(h.asked).toEqual([]);
    const admin = harness({
      superAdminOnly: true,
      authorize: async () => ({ access: { userId: "sa", superAdmin: true } }),
    });
    expect((await admin.route.GET(get("project=atlas-1"))).status).toBe(200);
  });

  test("⭐ forged browser ids are ignored: the OS ids come ONLY from the stored link row", async () => {
    const h = harness();
    const res = await h.route.GET(
      get(
        "project=atlas-1&workspace=te-ops&workspaceId=te-ops&osProjectId=payroll&fdWorkspace=te-ops&fdProject=payroll&projectId=payroll",
      ),
    );
    expect(res.status).toBe(200);
    expect(h.asked).toEqual([`projection ${WS}/${OS_PROJECT}`]);
    expect(h.looked).toEqual(["atlas-1"]);
  });

  test("a foreign Origin or a cross-site / same-site Sec-Fetch-Site is refused before anything else", async () => {
    for (const headers of [
      { origin: "https://evil.example" } as Record<string, string>,
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ]) {
      const h = harness();
      const res = await h.route.GET(get("project=atlas-1", headers));
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(h.authorized).toBe(0);
      expect(h.asked).toEqual([]);
      const rev = await h.route.revision(getRevision("project=atlas-1", headers));
      expect(rev.status).toBe(403);
    }
    const same = harness();
    const ok = await same.route.GET(
      get("project=atlas-1", {
        origin: ATLAS,
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(ok.status).toBe(200);
  });
});

test.describe("/api/flightdeck/crm: full-link identity check", () => {
  const mismatch = async (setup: Setup, detail: string) => {
    const h = harness(setup);
    const res = await h.route.GET(get("project=atlas-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "unavailable",
      reason: "link_mismatch",
    });
    // No CRM request is made on a mismatch.
    expect(h.asked).toEqual([]);
    // The reason code is logged for admins (no OS ids, no credential).
    expect(h.logged).toEqual([
      { event: "flightdeck.crm.link_mismatch", reason: "link_mismatch", detail },
    ]);
    const rev = await h.route.revision(getRevision("project=atlas-1"));
    expect(await rev.json()).toEqual({
      state: "unavailable",
      reason: "link_mismatch",
    });
    expect(h.asked).toEqual([]);
  };

  test("a link whose accessState is not active", () =>
    mismatch({ links: [{ ...link, accessState: "disabled" }] }, "access_state"));

  test("a link recorded by another Atlas installation", () =>
    mismatch(
      { links: [{ ...link, installationId: "atlas-other" }] },
      "installation",
    ));

  test("a link recorded on another OS instance, even with matching slugs", () =>
    mismatch({ links: [{ ...link, osInstanceId: "os-instance-b" }] }, "instance"));

  test("an OS that does not publish its instance id", () =>
    mismatch(
      {
        workspaces: async () => ({
          state: "ok",
          data: { ...wsBody, instanceId: undefined },
        }),
      },
      "instance_unknown",
    ));

  test("a link whose workspace is not among the credential's configured workspaces", () =>
    mismatch(
      {
        workspaces: async () => ({
          state: "ok",
          data: { ...wsBody, workspaces: [wsBody.workspaces[0]!] },
        }),
      },
      "workspace",
    ));

  test("an Atlas project with no link, or no configured installation, reads nothing from the OS", async () => {
    const none = harness({ links: [] });
    expect(await (await none.route.GET(get("project=atlas-1"))).json()).toEqual({
      state: "unavailable",
      reason: "not_linked",
    });
    expect(none.asked).toEqual([]);
    const noInstall = harness({ installationId: null });
    expect(
      await (await noInstall.route.GET(get("project=atlas-1"))).json(),
    ).toEqual({ state: "unavailable", reason: "not_configured" });
    expect(noInstall.asked).toEqual([]);
  });

  test("a credential without read:crm makes no CRM request (the page stays as it was)", async () => {
    const h = harness({ whoami: whoamiOk(["read:context"]) });
    expect(await (await h.route.GET(get("project=atlas-1"))).json()).toEqual({
      state: "unavailable",
      reason: "not_enabled",
    });
    expect(h.asked).toEqual([]);
    const down = harness({ whoami: { state: "os_unreachable" } });
    expect(await (await down.route.GET(get("project=atlas-1"))).json()).toEqual({
      state: "unavailable",
      reason: "os_unreachable",
    });
    expect(down.asked).toEqual([]);
  });

  test("a disabled linked workspace is unavailable, never swapped for another", async () => {
    const h = harness({
      workspaces: async () => ({
        state: "ok",
        data: {
          ...wsBody,
          workspaces: [
            wsBody.workspaces[0]!,
            { ...wsBody.workspaces[1]!, enabled: false },
          ],
        },
      }),
    });
    expect(await (await h.route.GET(get("project=atlas-1"))).json()).toEqual({
      state: "unavailable",
      reason: "workspace_disabled",
    });
    expect(h.asked).toEqual([]);
  });
});

test.describe("/api/flightdeck/crm: the OS answer", () => {
  test("a body that fails the strict v1 parse, or is for another project, is unavailable with no data", async () => {
    for (const data of [
      { ...fixture(), email: "anna@example.test" },
      { ...fixture(), projectId: "payroll" },
      { ...fixture(), schemaVersion: 2 },
    ]) {
      const h = harness({
        crm: { projection: async () => ({ state: "ok", data: data as never }) },
      });
      const body = await (await h.route.GET(get("project=atlas-1"))).json();
      expect(body).toEqual({ state: "unavailable", reason: "invalid_response" });
    }
  });

  test("every OS refusal is unavailable with no data", async () => {
    for (const state of [
      "unauthorized",
      "refused",
      "not_found",
      "workspace_disabled",
      "rate_limited",
      "os_unreachable",
      "invalid_response",
      "crm_not_ready",
      "crm_projection_invalid",
    ] as const) {
      const h = harness({
        crm: {
          projection: async () => ({ state }),
          revision: async () => ({ state }),
        },
      });
      const res = await h.route.GET(get("project=atlas-1"));
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ state: "unavailable", reason: state });
      expect(text).not.toContain("Nordwind");
      const rev = await h.route.revision(getRevision("project=atlas-1"));
      expect(await rev.json()).toEqual({ state: "unavailable", reason: state });
    }
    const ctxDown = harness({
      workspaces: async () => ({ state: "os_unreachable" }),
    });
    expect(
      await (await ctxDown.route.GET(get("project=atlas-1"))).json(),
    ).toEqual({ state: "unavailable", reason: "os_unreachable" });
    expect(ctxDown.asked).toEqual([]);
  });

  test("the revision sub-route answers the linked project's revision only", async () => {
    const h = harness();
    const res = await h.route.revision(
      getRevision("project=atlas-1&osProjectId=payroll&workspace=te-ops"),
    );
    expect(await res.json()).toEqual({ state: "ok", revision: 17 });
    expect(h.asked).toEqual([`revision ${WS}/${OS_PROJECT}`]);
    const other = harness({
      crm: {
        revision: async () => ({
          state: "ok",
          data: { projectId: "payroll", revision: 3 },
        }),
      },
    });
    expect(
      await (await other.route.revision(getRevision("project=atlas-1"))).json(),
    ).toEqual({ state: "unavailable", reason: "invalid_response" });
    const anon = harness({
      authorize: async () => ({
        error: Response.json({ error: "Sign in." }, { status: 401 }),
      }),
    });
    expect(
      (await anon.route.revision(getRevision("project=atlas-1"))).status,
    ).toBe(404);
  });

  test("every answer carries Cache-Control: private, no-store", async () => {
    const cases: [ReturnType<typeof harness>, Request, "GET" | "revision"][] = [
      [harness(), get("project=atlas-1"), "GET"],
      [harness(), getRevision("project=atlas-1"), "revision"],
      [harness(), get("project=atlas-9"), "GET"],
      [harness({ links: [] }), get("project=atlas-1"), "GET"],
      [
        harness({ links: [{ ...link, accessState: "disabled" }] }),
        get("project=atlas-1"),
        "GET",
      ],
      [harness(), get("project=atlas-1", { origin: "https://evil.example" }), "GET"],
      [
        harness({
          authorize: async () => ({
            error: Response.json({ error: "x" }, { status: 401 }),
          }),
        }),
        getRevision("project=atlas-1"),
        "revision",
      ],
    ];
    for (const [h, req, kind] of cases) {
      const res = await (kind === "GET" ? h.route.GET(req) : h.route.revision(req));
      expect(res.headers.get("cache-control"), req.url).toBe("private, no-store");
    }
  });
});

test.describe("the synthetic credential never leaves the server", () => {
  test("⭐ absent from every response of the real wiring over a fake OS", async () => {
    const wiring = createOsWiring({
      cache: new Map(),
      fetch: async (url) => {
        if (url.endsWith("/whoami"))
          return jsonResponse({
            integrationId: "atlas",
            scopes: ["read:context", "read:crm"],
          });
        if (url.endsWith("/context/workspaces")) return jsonResponse(wsBody);
        if (url.endsWith("/crm/revision"))
          return jsonResponse({ projectId: OS_PROJECT, revision: 17 });
        if (url.endsWith("/crm")) return jsonResponse(fixture());
        return jsonResponse({ error: "not found" }, 404);
      },
    });
    const config = { baseUrl: OS, token: TOKEN };
    const route = createCrmRoute({
      authorize: member,
      projectFor: async (_a, id) => (id === "atlas-1" ? { id } : null),
      links: async () => [link],
      installationId: () => INSTALL,
      reader: () => wiring.reader(config, false),
      whoami: () => wiring.whoami(config, false),
      crm: () => wiring.crm(config),
      origin: () => OS,
      log: () => {},
    });
    const answers: Response[] = [
      await route.GET(get("project=atlas-1")),
      await route.revision(getRevision("project=atlas-1")),
      await route.GET(get("project=atlas-9")),
      await route.GET(get("project=atlas-1", { origin: "https://evil.example" })),
    ];
    const ok = (await answers[0]!.clone().json()) as { state: string };
    expect(ok.state).toBe("ok");
    for (const res of answers) {
      const text = await res.text();
      expect(text).not.toContain(TOKEN);
      for (const [, value] of res.headers) expect(value).not.toContain(TOKEN);
    }
  });

  test("a 401 on a CRM read revokes the credential-wide cache, and a recorded 429 is honoured without asking the OS", async () => {
    let calls = 0;
    let status = 401;
    const cache = new Map();
    const wiring = createOsWiring({
      cache,
      fetch: async () => {
        calls++;
        return jsonResponse({ error: "x", retryAfterSeconds: 30 }, status);
      },
    });
    const crm = wiring.crm({ baseUrl: OS, token: TOKEN });
    cache.set("some-list", { until: Date.now() + 60_000 });
    expect(await crm.projection(WS, OS_PROJECT)).toEqual({ state: "unauthorized" });
    expect(cache.has("some-list")).toBe(false);
    status = 429;
    expect((await crm.revision(WS, OS_PROJECT)).state).toBe("rate_limited");
    const before = calls;
    expect((await crm.projection(WS, OS_PROJECT)).state).toBe("rate_limited");
    expect(calls).toBe(before);
  });

  test("absent from the built client output (when a build is present)", () => {
    // Build with the synthetic credential in the environment to check this:
    //   ATLAS_FLIGHTDECK_INBOUND_TOKEN=fdtest_SYNTHETIC_0123 npm run build
    const dir = fileURLToPath(new URL("../dist/client", import.meta.url));
    test.skip(!existsSync(dir), "no dist/client build in this checkout");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files)
      expect(readFileSync(file).includes(TOKEN), file).toBe(false);
  });

  test("the browser-importable contract module pulls in no server transport", () => {
    const src = readFileSync(
      new URL("../lib/flightdeck/crm-contract.ts", import.meta.url),
      "utf8",
    );
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["zod"]);
  });
});
