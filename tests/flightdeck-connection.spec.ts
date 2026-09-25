import { test, expect } from "@playwright/test";
import { createWhoamiReader } from "../lib/flightdeck/context-client";
import {
  connectionFromWhoami,
  connectionLine,
  connectionViewSchema,
  workWaitingForFlightDeck,
  type ConnectionView,
} from "../lib/flightdeck/connection";
import { createConnectionRoute } from "../lib/flightdeck/connection-route";
import { de } from "../lib/i18n/de";
import type { Project } from "../lib/projects";

// onb-atlas-connection-clarity: the Connections page shows ONE connection
// line, derived from the credential's whoami, and opens on To FlightDeck when
// work waits there. Nothing here contacts FlightDeck OS.
const OS = "http://127.0.0.1:4420";
const TOKEN = "t".repeat(32);
const whoami = (scopes: unknown) => ({
  integrationId: "atlas",
  scopes,
  expiresAt: "2026-10-22T09:30:00.000Z",
  limits: { maxPayloadBytes: 65536, requestsPerMinute: 30 },
  features: {
    decisionNote: false,
    supersedes: false,
    appDiscovery: false,
    requestedSubapps: false,
    aiAgents: false,
  },
  bridgeMediaCrossOrigin: false,
});
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const reader = (respond: () => Response | Promise<Response>) =>
  createWhoamiReader(
    { baseUrl: OS, token: TOKEN },
    new Map(),
    { fetch: async () => respond() },
  );

test.describe("connectionLine: one line per credential shape", () => {
  const line = (v: ConnectionView | null) => connectionLine(v, "en");
  test("read and submit scopes", () => {
    expect(
      line(
        connectionFromWhoami({
          state: "ok",
          body: whoami(["submit:proposal", "read:context"]),
        }),
      ),
    ).toBe("Connected: can read context and send onboarding requests");
  });
  test("read scope only", () => {
    expect(
      line(
        connectionFromWhoami({ state: "ok", body: whoami(["read:context"]) }),
      ),
    ).toBe("Connected: read only");
  });
  test("submit scope only", () => {
    expect(
      line(
        connectionFromWhoami({
          state: "ok",
          body: whoami(["submit:proposal"]),
        }),
      ),
    ).toBe("Connected: can send onboarding requests, cannot read context");
  });
  test("no known scope is not a connection", () => {
    expect(
      line(connectionFromWhoami({ state: "ok", body: whoami([]) })),
    ).toBe("Not connected (the credential carries no Atlas scope)");
    expect(
      line(
        connectionFromWhoami({ state: "ok", body: whoami(["admin:all"]) }),
      ),
    ).toBe("Not connected (the credential carries no Atlas scope)");
  });
  test("a body that is not a whoami answer fails closed", () => {
    for (const body of [null, "ok", {}, whoami("read:context")])
      expect(line(connectionFromWhoami({ state: "ok", body }))).toBe(
        "Not connected (FlightDeck sent an unexpected answer)",
      );
  });
  test("every failure is Not connected with its reason", () => {
    expect(line(connectionFromWhoami({ state: "not_configured" }))).toBe(
      "Not connected (FlightDeck is not configured in Atlas)",
    );
    expect(line(connectionFromWhoami({ state: "unauthorized" }))).toBe(
      "Not connected (FlightDeck refused Atlas's credential)",
    );
    expect(line(connectionFromWhoami({ state: "os_unreachable" }))).toBe(
      "Not connected (FlightDeck could not be reached)",
    );
    expect(line(connectionFromWhoami({ state: "rate_limited" }))).toBe(
      "Not connected (FlightDeck asked Atlas to wait; try again shortly)",
    );
    expect(line(connectionFromWhoami({ state: "invalid_response" }))).toBe(
      "Not connected (FlightDeck sent an unexpected answer)",
    );
    expect(line({ state: "check_failed" })).toBe(
      "Not connected (Atlas could not check the connection)",
    );
  });
  test("before the first answer the line says it is checking", () => {
    expect(line(null)).toBe("Checking the FlightDeck connection…");
  });
  test("German has its own line for every shape", () => {
    const view: ConnectionView = {
      state: "ok",
      scopes: ["read:context", "submit:proposal"],
    };
    expect(connectionLine(view, "de")).toBe(de["onb.conn.readSubmit"]);
    expect(connectionLine(view, "de")).not.toBe(connectionLine(view, "en"));
  });
});

test.describe("whoami reader", () => {
  test("keeps the reason a whoami read failed", async () => {
    expect(await reader(() => jsonResponse(whoami(["read:context"])))()).toEqual({
      state: "ok",
      body: whoami(["read:context"]),
    });
    expect(
      (await reader(() => jsonResponse({ error: "x" }, 401))()).state,
    ).toBe("unauthorized");
    expect(
      (await reader(() => jsonResponse({ error: "x" }, 429))()).state,
    ).toBe("rate_limited");
    expect((await reader(() => jsonResponse({}, 500))()).state).toBe(
      "invalid_response",
    );
    expect(
      (
        await reader(() => {
          throw Error("down");
        })()
      ).state,
    ).toBe("os_unreachable");
  });
});

test.describe("/api/flightdeck/connection", () => {
  const signedIn = async () => ({
    access: { userId: "u@example.com", superAdmin: false },
  });
  test("answers only the derived state and scopes, never the credential or its details", async () => {
    const route = createConnectionRoute({
      authorize: signedIn,
      whoami: () => async () => ({
        state: "ok",
        body: whoami(["read:context", "submit:proposal"]),
      }),
    });
    const response = await route.GET(new Request(`${OS}/x`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    const body = connectionViewSchema.parse(JSON.parse(text));
    expect(body).toEqual({
      state: "ok",
      scopes: ["read:context", "submit:proposal"],
    });
    expect(text).not.toMatch(/expiresAt|integrationId|limits|features|t{32}/);
  });
  test("not configured without a whoami reader; a thrown read is check_failed", async () => {
    const off = createConnectionRoute({ authorize: signedIn, whoami: () => null });
    expect(await (await off.GET(new Request(`${OS}/x`))).json()).toEqual({
      state: "not_configured",
    });
    const broken = createConnectionRoute({
      authorize: signedIn,
      whoami: () => async () => {
        throw Error("boom");
      },
    });
    expect(await (await broken.GET(new Request(`${OS}/x`))).json()).toEqual({
      state: "check_failed",
    });
  });
  test("an unauthorised viewer gets the auth error and no read happens", async () => {
    let read = false;
    const route = createConnectionRoute({
      authorize: async () => ({
        error: new Response("no", { status: 401 }),
      }),
      whoami: () => async () => {
        read = true;
        return { state: "ok", body: whoami(["read:context"]) };
      },
    });
    expect((await route.GET(new Request(`${OS}/x`))).status).toBe(401);
    expect(read).toBe(false);
  });
  test("?refresh=1 asks for a fresh read", async () => {
    const seen: boolean[] = [];
    const route = createConnectionRoute({
      authorize: signedIn,
      whoami: (fresh) => {
        seen.push(fresh);
        return async () => ({ state: "ok", body: whoami(["read:context"]) });
      },
    });
    await route.GET(new Request(`${OS}/x`));
    await route.GET(new Request(`${OS}/x?refresh=1`));
    expect(seen).toEqual([false, true]);
  });
});

test.describe("the Connections page's first tab", () => {
  const base = {
    archived: false,
    source: "atlas",
    flightdeckDraft: null,
  } as unknown as Project;
  const p = (id: string, extra: Partial<Project> = {}) =>
    ({ ...base, id, ...extra }) as Project;
  const draft = { label: "Pilot", workspaceHint: "" };
  const ask = {
    revision: 3,
    by: "a@example.com",
    at: "2026-09-25T08:00:00.000Z",
  };
  test("nothing prepared: From FlightDeck", () => {
    expect(workWaitingForFlightDeck([p("a")], {})).toBe(false);
    expect(workWaitingForFlightDeck([], null)).toBe(false);
  });
  test("an unsent draft waits", () => {
    expect(
      workWaitingForFlightDeck([p("a", { flightdeckDraft: draft })], {}),
    ).toBe(true);
    // Before the stages are known a draft may be unsent: it waits.
    expect(
      workWaitingForFlightDeck([p("a", { flightdeckDraft: draft })], null),
    ).toBe(true);
  });
  test("a draft FlightDeck already holds does not wait", () => {
    expect(
      workWaitingForFlightDeck([p("a", { flightdeckDraft: draft })], {
        a: "submitted",
      }),
    ).toBe(false);
  });
  test("an open ask waits; a withdrawn one does not", () => {
    expect(
      workWaitingForFlightDeck(
        [p("a", { onboarding: { sendRequest: ask } as Project["onboarding"] })],
        {},
      ),
    ).toBe(true);
    expect(
      workWaitingForFlightDeck(
        [
          p("a", {
            onboarding: {
              sendRequest: { ...ask, withdrawnAt: ask.at },
            } as Project["onboarding"],
          }),
        ],
        {},
      ),
    ).toBe(false);
  });
  test("archived and OS-sourced projects never count", () => {
    expect(
      workWaitingForFlightDeck(
        [
          p("a", { flightdeckDraft: draft, archived: true }),
          p("b", { flightdeckDraft: draft, source: "flightdeck" } as Partial<Project>),
        ],
        {},
      ),
    ).toBe(false);
  });
});
