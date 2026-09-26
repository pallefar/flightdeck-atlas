import { test, expect } from "@playwright/test";
import {
  FLIGHTDECK_ADMIN_ID,
  adminCardConfig,
  adminCardFor,
  catalogWithAdminCard,
  isReservedAppId,
} from "../lib/flightdeck/admin-card";
import { flightdeckApp, type AppEntry } from "../lib/collaboration";

// Unit checks only: no server, no OS. The reserved 'FlightDeck Admin' card is
// a VISIBILITY HEURISTIC (Atlas superAdmin or a role in
// ATLAS_FLIGHTDECK_ADMIN_ROLES), never an OS entitlement: the OS re-checks
// access when the admin arrives (D-039 item 1).
const member = { superAdmin: false, roleId: "owner" };
const superAdmin = { superAdmin: true, roleId: "admin" };
const url = "https://os.example.com/console/admin";

test("an ineligible user sees no card", () => {
  const config = adminCardConfig({ url, roles: "ops-lead" });
  expect(adminCardFor(member, config)).toBeNull();
  expect(
    catalogWithAdminCard([flightdeckApp], member, config).map((x) => x.id),
  ).toEqual(["flightdeck"]);
});

test("an Atlas superAdmin sees the reserved card, pointing at the admin url", () => {
  const card = adminCardFor(superAdmin, adminCardConfig({ url }));
  expect(card).toMatchObject({
    id: FLIGHTDECK_ADMIN_ID,
    name: "FlightDeck Admin",
    url,
    enabled: true,
    newTab: true,
    reserved: true,
  });
});

test("a role named in ATLAS_FLIGHTDECK_ADMIN_ROLES sees the card", () => {
  const config = adminCardConfig({ url, roles: " ops-lead , owner " });
  expect(adminCardFor(member, config)?.id).toBe(FLIGHTDECK_ADMIN_ID);
  expect(
    adminCardFor({ superAdmin: false, roleId: "viewer" }, config),
  ).toBeNull();
});

test("an unset or blank url gives no card, even to a superAdmin", () => {
  for (const raw of [undefined, "", "   "])
    expect(adminCardFor(superAdmin, adminCardConfig({ url: raw }))).toBeNull();
});

test("a non-https, non-loopback url is rejected (no card)", () => {
  for (const raw of [
    "http://os.example.com/console/admin",
    "http://10.0.0.5:4173/console/admin",
    "javascript:alert(1)",
    "ftp://os.example.com/",
    "https://user:secret@os.example.com/console/admin",
    "not a url",
  ])
    expect(
      adminCardFor(superAdmin, adminCardConfig({ url: raw })),
      raw,
    ).toBeNull();
  for (const raw of [
    "http://localhost:4173/console/admin",
    "http://127.0.0.1:4173/console/admin",
    "http://[::1]:4173/console/admin",
  ])
    expect(adminCardFor(superAdmin, adminCardConfig({ url: raw }))?.url).toBe(
      raw,
    );
});

test("the id 'flightdeck-admin' is reserved against catalog writes", () => {
  expect(isReservedAppId("flightdeck-admin")).toBe(true);
  expect(isReservedAppId("flightdeck")).toBe(false);
  expect(isReservedAppId("my-app")).toBe(false);
});

test("a stored catalog entry using the reserved id never overrides or shows", () => {
  const forged: AppEntry = {
    ...flightdeckApp,
    id: FLIGHTDECK_ADMIN_ID,
    name: "Forged Admin",
    url: "https://evil.example.com/",
    audience: "all",
    enabled: true,
  };
  // Unconfigured: the forged row is dropped for everyone.
  expect(
    catalogWithAdminCard(
      [flightdeckApp, forged],
      superAdmin,
      adminCardConfig({}),
    ),
  ).toEqual([flightdeckApp]);
  expect(
    catalogWithAdminCard([forged], member, adminCardConfig({ url })),
  ).toEqual([]);
  // Configured: the built-in wins over the stored row.
  const out = catalogWithAdminCard(
    [forged],
    superAdmin,
    adminCardConfig({ url }),
  );
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ name: "FlightDeck Admin", url });
});

// Against the running Atlas (the local sign-in is the Super Admin). The
// refusal holds whatever the environment; the card assertion follows the
// server's own ATLAS_FLIGHTDECK_ADMIN_URL.
test("the workspace route refuses a catalog write under the reserved id", async ({
  page,
}) => {
  await page.goto("/");
  const api = page.context().request;
  for (const revision of [0, 1]) {
    const res = await api.post("/api/workspace", {
      data: {
        action: "app",
        id: FLIGHTDECK_ADMIN_ID,
        revision,
        data: {
          ...flightdeckApp,
          name: "Forged Admin",
          url: "https://evil.example.com/",
          login: "external",
        },
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({
      error: "This app is built in and cannot be changed here.",
    });
  }
  const { apps } = (await (await api.get("/api/workspace")).json()) as {
    apps: AppEntry[];
  };
  const reserved = apps.filter((x) => x.id === FLIGHTDECK_ADMIN_ID);
  expect(reserved.length).toBeLessThanOrEqual(1);
  for (const card of reserved)
    expect(card).toMatchObject({ name: "FlightDeck Admin", newTab: true });
});
