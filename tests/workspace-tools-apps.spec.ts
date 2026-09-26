import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppCard } from "../components/AppCard";
import { FlightdeckAppsSection } from "../components/flightdeck-apps-section";
import { OsAppAboutView } from "../components/os-app-about";
import {
  appBridgeHref,
  appCardModel,
  fdPrefId,
  flightdeckSection,
  type SectionInput,
} from "../lib/flightdeck/app-card";
import type { DirectoryApp } from "../lib/flightdeck/apps-directory-route";
import { I18nProvider } from "../lib/i18n/react";
import { en } from "../lib/i18n/en";
import { de } from "../lib/i18n/de";
import type { Locale } from "../lib/i18n";

// apps-33 (plan 2026-09-25 Lane B, "One card specification for OS and
// Atlas"; D-037): the 9-dot menu's FlightDeck OS section renders the apps
// directory (apps-32) as cards.
//   enabled: 'Open in FlightDeck OS' (new tab, noopener, carrying fdWorkspace
//            and fdProject), a sibling 'See more' link to /apps/os/<id>, and
//            the visible 'Access is checked when you open it';
//   locked:  ONE stretched link to /apps/os/<id>, the visible reason attached
//            with aria-describedby, no Open, no opacity on text.

const ORIGIN = "http://atlas.test";
const OPEN_URL =
  "https://os.example.test/console/apps/maps?fdWorkspace=te-ops&fdProject=rhineland-rollout";
const app = (over: Partial<DirectoryApp> = {}): DirectoryApp => ({
  id: "maps",
  label: "Maps",
  icon: "🗺️",
  version: "0.2.2",
  category: "analytics",
  availability: "available",
  workspaceStatus: "enabled",
  url: OPEN_URL,
  accessCheckedOnOpen: true,
  requestAccessEnabled: false,
  tagline: "Plan sites on a map",
  releaseRevision: 1,
  ...over,
});
const locked = (over: Partial<DirectoryApp> = {}) =>
  app({
    id: "knowledge-guardian",
    label: "Knowledge Guardian",
    icon: "🛡️",
    workspaceStatus: "not-enabled",
    url: null,
    tagline: "Keeps knowledge current",
    ...over,
  });

const inLocale = (locale: Locale, el: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      I18nProvider as (p: { locale: Locale; children?: ReactNode }) => ReactNode,
      { locale },
      el,
    ),
  );
const card = (a: DirectoryApp, locale: Locale = "en", extra = {}) =>
  inLocale(locale, createElement(AppCard, { app: a, ...extra }));
const unescape = (html: string) =>
  html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const anchors = (html: string) =>
  [...unescape(html).matchAll(/<a\b([^>]*)>/g)].map((m) => m[1]);

const selected = { osWorkspaceId: "te-ops", osProjectId: "rhineland-rollout" };
const base: SectionInput = {
  contextEnabled: true,
  context: { loaded: true, state: "ok", selected },
  directory: { loading: false, state: "ok", data: null },
  query: "",
  favourites: [],
};
const withApps = (apps: DirectoryApp[]): SectionInput => ({
  ...base,
  directory: {
    loading: false,
    state: "ok",
    data: {
      state: "ok",
      workspaceId: "te-ops",
      projectId: "rhineland-rollout",
      locale: "en",
      apps,
      retryAfter: null,
    },
  },
});
const section = (input: SectionInput, locale: Locale = "en", extra = {}) =>
  inLocale(
    locale,
    createElement(FlightdeckAppsSection, {
      view: flightdeckSection(input),
      favourites: input.favourites,
      recent: [],
      busy: false,
      onPin: () => {},
      onOpened: () => {},
      onRetry: () => {},
      ...extra,
    }),
  );

test.describe("AppCard, enabled", () => {
  test("Open in FlightDeck OS (new tab, noopener, fdWorkspace + fdProject), See more, and the access note", () => {
    const html = card(app());
    const [open, more, ...rest] = anchors(html);
    expect(rest).toEqual([]);
    expect(open).toContain(`href="${OPEN_URL}"`);
    expect(open).toContain('target="_blank"');
    expect(open).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(open).toContain("fdWorkspace=te-ops");
    expect(open).toContain("fdProject=rhineland-rollout");
    expect(more).toContain('href="/apps/os/maps"');
    expect(more).not.toContain("target=");
    expect(unescape(html)).toContain(`>${en["apps.card.open"]}<`);
    expect(unescape(html)).toContain(`>${en["apps.card.seeMore"]}<`);
    expect(unescape(html)).toContain(en["apps.card.accessNote"]);
    expect(en["apps.card.open"]).toBe("Open in FlightDeck OS");
    expect(en["apps.card.accessNote"]).toBe("Access is checked when you open it");
    // Each link's accessible name contains its visible text and the app.
    expect(open).toContain('aria-label="Open in FlightDeck OS: Maps"');
    expect(more).toContain('aria-label="See more about Maps"');
    expect(html).toContain('data-openable="true"');
  });

  test("an app marked enabled without a link is shown locked (fail closed), never a dead Open", () => {
    for (const url of [null, "javascript:alert(1)", "/relative"]) {
      const html = card(app({ url }));
      expect(html).toContain('data-openable="false"');
      expect(anchors(html)).toHaveLength(1);
      expect(unescape(html)).not.toContain(en["apps.card.open"]);
    }
  });

  test("the pin is a sibling button, shown only for enabled apps, and Recently opened is kept", () => {
    const html = card(app(), "en", {
      pinned: true,
      recent: true,
      onPin: () => {},
      onOpen: () => {},
    });
    expect(html).toMatch(/<button[^>]*aria-label="Unpin Maps"/);
    expect(unescape(html)).toContain(en["apps.card.recent"]);
    const off = card(locked(), "en", {
      pinned: true,
      recent: true,
      onPin: () => {},
      onOpen: () => {},
    });
    expect(off).not.toContain("<button");
    expect(unescape(off)).not.toContain(en["apps.card.recent"]);
  });
});

test.describe("AppCard, locked", () => {
  test("one stretched link to /apps/os/<id>, described by the visible reason, and no Open", () => {
    const html = card(locked());
    const links = anchors(html);
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('href="/apps/os/knowledge-guardian"');
    expect(links[0]).toContain('class="app-card-stretch"');
    expect(links[0]).toContain('aria-label="Knowledge Guardian, see more"');
    expect(links[0]).not.toContain("target=");
    const described = links[0].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeTruthy();
    const reason = unescape(html)
      .match(new RegExp(`<p[^>]*id="${described}"[^>]*>(.*?)</p>`))?.[1]
      ?.replace(/<[^>]+>/g, "");
    expect(reason).toBe(
      `${en["apps.card.reason.not-enabled"]} ${en["apps.card.party.workspace-admin"]}`,
    );
    expect(unescape(html)).not.toContain(en["apps.card.open"]);
    expect(html).toContain('data-openable="false"');
    expect(html).not.toContain("<button");
  });

  test("every OS lock reason has its own words and responsible party; an unknown one falls back", () => {
    const reasons: Record<string, string | null> = {
      "operator-off": "operator",
      "workspace-disabled": "operator",
      "project-archived": "workspace-admin",
      "schema-missing": "operator",
      "app-schema-behind": "workspace-admin",
      "app-schema-ahead": "operator",
      "coming-soon": "publisher",
      "no-identity": null,
      role: "workspace-admin",
      "needs-owner-approval": "owner",
      "needs-function-enable": "workspace-admin",
      "not-enabled": "workspace-admin",
    };
    for (const [status, party] of Object.entries(reasons)) {
      const m = appCardModel(locked({ workspaceStatus: status }));
      expect(m.openable, status).toBe(false);
      expect(m.reasonKey, status).toBe(`apps.card.reason.${status}`);
      expect(m.partyKey, status).toBe(party ? `apps.card.party.${party}` : null);
    }
    const unknown = appCardModel(locked({ workspaceStatus: "something-new" }));
    expect(unknown.reasonKey).toBe("apps.card.reason.locked");
    expect(unknown.partyKey).toBeNull();
    expect(appBridgeHref("a-b")).toBe("/apps/os/a-b");
  });

  test("the locked style keeps full-contrast text: no opacity in the card rules", () => {
    const css = readFileSync(new URL("../app/suite.css", import.meta.url), "utf8");
    const rules = [...css.matchAll(/([^{}]*\.app-card[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules)
      expect(body, selector.trim()).not.toMatch(/opacity|filter\s*:/);
  });
});

test.describe("FlightdeckAppsSection states", () => {
  const cases: [string, SectionInput, keyof typeof en, boolean][] = [
    [
      "not_configured",
      { ...base, directory: { loading: false, state: "not_configured", data: null } },
      "apps.fd.state.not_configured",
      false,
    ],
    [
      "os_unreachable",
      { ...base, directory: { loading: false, state: "os_unreachable", data: null } },
      "apps.fd.state.os_unreachable",
      true,
    ],
    [
      "directory_unavailable",
      { ...base, directory: { loading: false, state: "directory_unavailable", data: null } },
      "apps.fd.state.directory_unavailable",
      false,
    ],
    [
      "rate_limited",
      { ...base, directory: { loading: false, state: "rate_limited", data: null } },
      "apps.fd.state.rate_limited",
      true,
    ],
    ["empty", withApps([]), "apps.fd.empty", false],
    [
      "error",
      { ...base, directory: { loading: false, state: "error", data: null } },
      "apps.fd.state.error",
      true,
    ],
    [
      "no project selected (not a super admin)",
      { ...base, contextEnabled: false, context: { loaded: false, state: null, selected: null } },
      "apps.fd.state.no_project_selected",
      false,
    ],
    [
      "context says not configured before any selection",
      { ...base, context: { loaded: true, state: "not_configured", selected: null } },
      "apps.fd.state.not_configured",
      false,
    ],
  ];
  for (const locale of ["en", "de"] as const)
    for (const [name, input, key, retry] of cases)
      test(`${name} renders its own words (${locale})${retry ? " with Retry" : ""}`, () => {
        const html = unescape(section(input, locale));
        const words = (locale === "en" ? en : de)[key];
        expect(html).toContain(words);
        expect(html).toMatch(/role="status"/);
        const retryText = (locale === "en" ? en : de)["apps.fd.retry"];
        if (retry) expect(html).toMatch(new RegExp(`<button[^>]*>${retryText}</button>`));
        else expect(html).not.toContain("<button");
        expect(html).not.toContain("<a ");
      });

  test("the directory_unavailable words are the plan's, never a fallback to the old list", () => {
    expect(en["apps.fd.state.directory_unavailable"]).toBe(
      "App directory unavailable: FlightDeck OS needs an update",
    );
  });

  test("loading, then a search with no match", () => {
    const loading = flightdeckSection({
      ...base,
      directory: { loading: true, state: null, data: null },
    });
    expect(loading.kind).toBe("loading");
    const none = flightdeckSection({ ...withApps([app()]), query: "zzz" });
    expect(none).toMatchObject({ kind: "message", key: "apps.fd.noMatch" });
    const hit = flightdeckSection({ ...withApps([app(), locked()]), query: "guard" });
    expect(hit.kind === "cards" && hit.apps.map((a) => a.id)).toEqual([
      "knowledge-guardian",
    ]);
  });

  test("cards: pinned enabled first, then enabled, then locked", () => {
    const v = flightdeckSection({
      ...withApps([
        locked(),
        app({ id: "a", label: "Alpha" }),
        app({ id: "b", label: "Beta" }),
      ]),
      favourites: [fdPrefId("b"), fdPrefId("knowledge-guardian")],
    });
    expect(v.kind === "cards" && v.apps.map((a) => a.id)).toEqual([
      "b",
      "a",
      "knowledge-guardian",
    ]);
  });

  test("DE renders the cards in German", () => {
    const html = unescape(section(withApps([app(), locked()]), "de"));
    expect(html).toContain(`>${de["apps.card.open"]}<`);
    expect(html).toContain(`>${de["apps.card.seeMore"]}<`);
    expect(html).toContain(de["apps.card.accessNote"]);
    expect(html).toContain(de["apps.card.reason.not-enabled"]);
    expect(html).toContain(de["apps.fd.heading"]);
    expect(de["apps.card.open"]).not.toBe(en["apps.card.open"]);
  });
});

// The link target exists (no dead end): a minimal /apps/os/<id> page that
// apps-34 replaces with the published release.
test.describe("/apps/os/<id> (minimal until apps-34)", () => {
  const about = (id: string, input: SectionInput, locale: Locale = "en") =>
    unescape(
      inLocale(
        locale,
        createElement(OsAppAboutView, { id, view: flightdeckSection(input) }),
      ),
    );
  test("the route file exists", () => {
    expect(
      readFileSync(new URL("../app/apps/os/[id]/page.tsx", import.meta.url), "utf8"),
    ).toContain("OsAppAbout");
  });
  test("a locked app: its name, tagline, reason and version; no Open", () => {
    const html = about("knowledge-guardian", withApps([app(), locked()]));
    expect(html).toContain("<h1>About Knowledge Guardian</h1>");
    expect(html).toContain("Keeps knowledge current");
    expect(html).toContain(en["apps.card.reason.not-enabled"]);
    expect(html).toContain("Version 0.2.2");
    expect(html).not.toContain(en["apps.card.open"]);
    expect(anchors(html).map((a) => a.match(/href="([^"]+)"/)?.[1])).toEqual(["/"]);
  });
  test("an enabled app: Open in FlightDeck OS in a new tab, with the access note", () => {
    const html = about("maps", withApps([app(), locked()]), "de");
    expect(html).toContain(`<h1>Über Maps</h1>`);
    expect(html).toContain(de["apps.card.accessNote"]);
    const open = anchors(html).find((a) => a.includes(OPEN_URL));
    expect(open).toContain('target="_blank"');
    expect(open).toMatch(/rel="[^"]*noopener/);
  });
  test("an unlisted app and a failed directory say so honestly", () => {
    expect(about("nope", withApps([app()]))).toContain(en["apps.about.notListed"]);
    expect(
      about("maps", { ...base, directory: { loading: false, state: "os_unreachable", data: null } }),
    ).toContain(en["apps.fd.state.os_unreachable"]);
  });
});

// The rendered cards in a real browser: stretched-link click, no nesting.
async function mount(page: Page, html: string) {
  const css = ["../app/te-theme.css", "../app/suite.css"]
    .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"))
    .join("\n");
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().endsWith("/")
        ? `<!doctype html><html><head><style>${css}</style></head><body><div class="apps-dialog" style="width:560px">${html}</div></body></html>`
        : `<!doctype html><title>bridge</title><h1>${new URL(route.request().url()).pathname}</h1>`,
    }),
  );
  await page.goto(`${ORIGIN}/`);
}

test.describe("cards in the browser", () => {
  test("no interactive element is nested in another", async ({ page }) => {
    await mount(page, section(withApps([app(), locked()]), "en", {}));
    const nested = await page.evaluate(
      () =>
        document.querySelectorAll(
          "a a, a button, button a, button button, a input, button input",
        ).length,
    );
    expect(nested).toBe(0);
  });

  test("a click on the locked card's body opens its bridge page", async ({ page }) => {
    await mount(page, section(withApps([app(), locked()]), "en", {}));
    const lockedCard = page.locator('[data-app-id="knowledge-guardian"]');
    await expect(
      page.getByRole("link", { name: "Knowledge Guardian, see more" }),
    ).toHaveAccessibleDescription(
      `${en["apps.card.reason.not-enabled"]} ${en["apps.card.party.workspace-admin"]}`,
    );
    const box = (await lockedCard.boundingBox())!;
    // The bottom-right corner: body, not the title link's own text.
    await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
    await expect(page).toHaveURL(`${ORIGIN}/apps/os/knowledge-guardian`);
  });

  test("the locked card's reason text keeps full opacity", async ({ page }) => {
    await mount(page, section(withApps([locked()]), "en", {}));
    const opacity = await page
      .locator(".app-card-reason")
      .evaluate((el) => {
        let o = 1;
        for (let n: Element | null = el; n; n = n.parentElement)
          o *= Number(getComputedStyle(n).opacity);
        return o;
      });
    expect(opacity).toBe(1);
  });
});

// Screenshot baselines of the OPEN 9-dot menu, EN and DE at 390 and 1280.
// Only against an isolated Atlas (ATLAS_BASE_URL on a non-live port): the
// default :5173 serves the owner's live checkout, and :4173 is the live OS.
const baseUrl = process.env.ATLAS_BASE_URL ?? "";
const isolated = /^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(baseUrl) &&
  !/:(4173|5173)\b/.test(baseUrl);
test.describe("the open menu (screenshots)", () => {
  test.skip(!isolated, "needs ATLAS_BASE_URL on an isolated, non-live port");
  for (const locale of ["en", "de"] as const)
    for (const width of [390, 1280])
      test(`${locale} at ${width}`, async ({ browser }) => {
        const context = await browser.newContext({
          baseURL: baseUrl,
          locale: locale === "de" ? "de-DE" : "en-US",
          extraHTTPHeaders: { "Accept-Language": locale === "de" ? "de-DE,de" : "en-US,en" },
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        await page.route("**/api/flightdeck/context", (r) =>
          r.fulfill({
            json: {
              state: "ok",
              workspaces: [],
              projects: [],
              selected,
              projectFallback: false,
              retryAfter: null,
              checkedAt: "2026-09-26T08:00:00.000Z",
            },
          }),
        );
        await page.route("**/api/flightdeck/apps/directory", (r) =>
          r.fulfill({
            json: {
              ...withApps([app(), locked(), locked({ id: "sign", label: "Sign", icon: "✍️", workspaceStatus: "role", tagline: null })]).directory.data,
              locale,
              checkedAt: "2026-09-26T08:00:00.000Z",
            },
          }),
        );
        // A fresh Atlas has no project storage; the menu needs only the
        // Super Admin profile the project list carries.
        await page.route("**/api/projects", (r) =>
          r.request().method() === "GET"
            ? r.fulfill({
                json: {
                  access: {
                    userId: "local_seedy",
                    email: "seedy@sites.test",
                    name: "QA",
                    roleId: "superadmin",
                    roleName: "Super Admin",
                    superAdmin: true,
                    permissions: ["projects.read"],
                  },
                  projects: [],
                  requesterRequests: false,
                },
              })
            : r.continue(),
        );
        await page.route("**/api/workspace", (r) =>
          r.request().method() === "GET"
            ? r.fulfill({
                json: {
                  email: "qa@example.test",
                  capacity: [],
                  apps: [],
                  teams: [],
                  teamOptions: [],
                  people: [],
                  roles: [],
                  notifications: [],
                  preferences: { digest: "all", favourites: [], recent: [] },
                  preferenceRevision: 0,
                },
              })
            : r.continue(),
        );
        await page.goto("/");
        await page.getByRole("button", { name: "Open apps", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Your apps" });
        await expect(dialog.locator('[data-app-id="maps"]')).toBeVisible();
        await expect(dialog).toHaveScreenshot(`apps-menu-${locale}-${width}.png`, {
          animations: "disabled",
          maxDiffPixelRatio: 0.01,
        });
        await context.close();
      });
});
