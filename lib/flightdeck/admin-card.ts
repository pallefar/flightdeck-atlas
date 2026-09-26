// The reserved built-in 'FlightDeck Admin' card in the Atlas app launcher
// (plan 2026-09-25 adm-60, D-039 item 1).
//
// ⛔ A VISIBILITY HEURISTIC, NOT AN ENTITLEMENT. Atlas shows the card to an
// Atlas superAdmin, or to a member whose Atlas role id is listed in
// ATLAS_FLIGHTDECK_ADMIN_ROLES. Atlas does not know who is a FlightDeck
// super_admin or workspace admin, and it does not ask: discovering OS
// entitlements is out of scope. The OS re-checks access when the admin
// arrives, so a card shown to the wrong person opens a refusal, never an
// admin surface.
//
// Pure: no Worker env here, so the rules are unit-testable. os-server.ts
// feeds the two env values in.
import { flightdeckApp, type AppEntry } from "@/lib/collaboration";

export const FLIGHTDECK_ADMIN_ID = "flightdeck-admin";
const RESERVED = new Set([FLIGHTDECK_ADMIN_ID]);

/** An id no catalog write may create or override. */
export function isReservedAppId(id: unknown) {
  return typeof id === "string" && RESERVED.has(id);
}

export type AdminCardConfig = { url: string; roles: string[] } | null;
export type AdminCardViewer = { superAdmin: boolean; roleId: string };
export type AdminCard = AppEntry & { reserved: true };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ROLE_RE = /^[a-zA-Z0-9_-]{1,80}$/;

/** The browser-facing admin url: https, or plain http only for a loopback
 * host (local development), never with credentials. Anything else is
 * refused, so the card is not shown — it fails closed. */
function browserUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return value;
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return value;
  return null;
}

/** Reads ATLAS_FLIGHTDECK_ADMIN_URL and ATLAS_FLIGHTDECK_ADMIN_ROLES (a
 * comma-separated list of Atlas role ids; malformed entries are ignored).
 * null — no card for anyone — when the url is unset or refused. */
export function adminCardConfig(env: {
  url?: string;
  roles?: string;
}): AdminCardConfig {
  const url = browserUrl(env.url);
  if (!url) return null;
  const roles = (env.roles ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => ROLE_RE.test(r));
  return { url, roles };
}

/** The card for this viewer, or null when they are not shown it. */
export function adminCardFor(
  viewer: AdminCardViewer,
  config: AdminCardConfig,
): AdminCard | null {
  if (!config) return null;
  if (!viewer.superAdmin && !config.roles.includes(viewer.roleId)) return null;
  return {
    ...flightdeckApp,
    id: FLIGHTDECK_ADMIN_ID,
    name: "FlightDeck Admin",
    description: "Admin settings and controls; FlightDeck checks your access",
    url: config.url,
    category: "Administration",
    featured: false,
    order: 1,
    audience: "selected",
    login: "flightdeck",
    newTab: true,
    reserved: true,
  };
}

/** The catalog with any stored row under a reserved id dropped (it can
 * never override the built-in or reach a viewer) and the built-in card
 * appended when this viewer is shown it. */
export function catalogWithAdminCard(
  catalog: AppEntry[],
  viewer: AdminCardViewer,
  config: AdminCardConfig,
): AppEntry[] {
  const kept = catalog.filter((x) => !isReservedAppId(x.id));
  const card = adminCardFor(viewer, config);
  return card ? [...kept, card] : kept;
}
