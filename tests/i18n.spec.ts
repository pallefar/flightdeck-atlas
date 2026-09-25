import { test, expect, type Browser } from "@playwright/test";
import {
  LOCALES,
  createTranslator,
  messages,
  resolveLocale,
  t,
  type MessageKey,
} from "../lib/i18n";
import { en } from "../lib/i18n/en";
import { de, DE_REVIEW_STATUS } from "../lib/i18n/de";
import { resolveRequestLocale } from "../lib/i18n/server";
import { onboardingSummaryLine } from "../lib/flightdeck/onboarding";
import { examples, type Project } from "../lib/projects";

// One Atlas i18n module (x-atlas-i18n): every lane (onboarding, apps, pages,
// CRM) adds keys under its own namespace; English and German must carry the
// same keys, and German is marked for native review until someone signs it.

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("en and de carry exactly the same keys, none empty, same placeholders", () => {
  expect(LOCALES).toEqual(["en", "de"]);
  const enKeys = Object.keys(en).sort();
  expect(Object.keys(de).sort()).toEqual(enKeys);
  expect(enKeys.length).toBeGreaterThan(0);
  for (const key of enKeys as MessageKey[]) {
    expect(key, key).toMatch(/^(onb|apps|pages|crm)\./);
    expect(en[key].trim(), key).not.toBe("");
    expect(de[key].trim(), key).not.toBe("");
    expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
  }
  expect(DE_REVIEW_STATUS).toBe("needs native review");
});

test("t returns German for de, English for en, and fills placeholders", () => {
  expect(t("onb.stage.submitted", "en")).toBe("Submitted");
  expect(t("onb.stage.submitted", "de")).toBe(de["onb.stage.submitted"]);
  expect(t("onb.stage.submitted", "de")).not.toBe("Submitted");
  expect(t("onb.check.last", "en", { when: "today" })).toBe(
    "Last checked with FlightDeck: today",
  );
  expect(t("onb.check.last", "de", { when: "heute" })).toContain("heute");
});

test("a missing key throws outside production and falls back to English in production", () => {
  const gap = { en: messages.en, de: { ...messages.de } };
  delete (gap.de as Partial<typeof messages.de>)["onb.stage.linked"];
  const strict = createTranslator(gap, { strict: true });
  expect(() => strict("onb.stage.linked", "de")).toThrow(/onb\.stage\.linked/);
  const lenient = createTranslator(gap, { strict: false });
  expect(lenient("onb.stage.linked", "de")).toBe("Linked");
  // The shared t is strict here: the test runner is not production.
  expect(() => t("onb.nope" as MessageKey, "de")).toThrow(/onb\.nope/);
});

test("resolveLocale: saved preference, then <html lang>, then Accept-Language, then en", () => {
  expect(resolveLocale({})).toBe("en");
  expect(resolveLocale({ acceptLanguage: "de-DE,de;q=0.9,en;q=0.8" })).toBe(
    "de",
  );
  expect(resolveLocale({ acceptLanguage: "fr-FR, en;q=0.5, de;q=0.9" })).toBe(
    "de",
  );
  expect(resolveLocale({ acceptLanguage: "fr, es" })).toBe("en");
  expect(
    resolveLocale({ htmlLang: "en", acceptLanguage: "de-DE" }),
  ).toBe("en");
  expect(resolveLocale({ htmlLang: "de-AT", acceptLanguage: "en" })).toBe(
    "de",
  );
  expect(resolveLocale({ htmlLang: "fr", acceptLanguage: "de" })).toBe("de");
  expect(
    resolveLocale({ preference: "de", htmlLang: "en", acceptLanguage: "en" }),
  ).toBe("de");
  expect(
    resolveLocale({ preference: "xx", htmlLang: "", acceptLanguage: "de" }),
  ).toBe("de");
  const request = new Request("http://atlas.test/", {
    headers: { "accept-language": "de-CH, en;q=0.1" },
  });
  expect(resolveRequestLocale(request)).toBe("de");
  expect(resolveRequestLocale(request, { preference: "en" })).toBe("en");
  expect(resolveRequestLocale(new Request("http://atlas.test/"))).toBe("en");
});

test("the onboarding summary line is unchanged in English and translated in German", () => {
  const stages = ["submitted", "needs-more-info", "not-sent"] as const;
  expect(onboardingSummaryLine(stages)).toBe(
    "Onboarding: 2 sent to FlightDeck, 0 linked, 1 need more info, 1 not sent.",
  );
  expect(onboardingSummaryLine(stages, "en")).toBe(
    onboardingSummaryLine(stages),
  );
  const german = onboardingSummaryLine(stages, "de");
  expect(german).not.toBe(onboardingSummaryLine(stages));
  expect(german).toContain("2");
  expect(onboardingSummaryLine([], "de")).toBe(de["onb.summary.none"]);
});

// In the browser: the root layout resolves the locale from Accept-Language
// (no profile language is stored yet), sets <html lang>, and the stage
// labels and the dashboard card follow it. English stays exactly as it was.
const QA_MARK = " QA-i18n ";
async function sweep(browser: Browser) {
  const page = await browser.newPage();
  try {
    await page.goto("/");
    await page.evaluate(async (mark) => {
      const body = (await (await fetch("/api/projects")).json()) as {
        projects: Project[];
      };
      for (const p of body.projects.filter((p) => p.name.includes(mark)))
        await fetch(`/api/projects/${p.id}?revision=${p.revision}`, {
          method: "DELETE",
        });
    }, QA_MARK);
  } finally {
    await page.close();
  }
}
test.describe("rendered", () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeAll(async ({ browser }) => sweep(browser));
  test.afterAll(async ({ browser }) => sweep(browser));

  // The browser's own language setting (which Chrome sends as
  // Accept-Language); the context also keeps the configured baseURL.
  for (const [locale, browserLocale] of [
    ["de", "de-DE"],
    ["en", "en-US"],
  ] as const)
    test(`stage labels and the dashboard card render in ${locale} for a ${browserLocale} browser`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({
        baseURL,
        locale: browserLocale,
      });
      const page = await context.newPage();
      try {
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const project = await page.evaluate(
          async (body) => {
            const r = await fetch("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            return ((await r.json()) as { project: Project }).project;
          },
          {
            ...examples[0],
            tasks: [],
            name: `Stage${QA_MARK}${locale}-${Date.now().toString(36)}`,
          },
        );
        await page.route(/\/api\/flightdeck\/onboard(\?.*)?$/, (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              stages: { [project.id]: "linked" },
              checked: { [project.id]: null },
              retryAfter: null,
            }),
          }),
        );
        await page.goto("/?view=dashboard");
        await expect(page.locator(".flightdeck-promo p")).toHaveText(
          onboardingSummaryLine(["linked"], locale),
        );
        await page.goto("/?view=connection");
        const tab = page.getByRole("button", { name: /To FlightDeck/ });
        await expect(async () => {
          await tab.click();
          await expect(tab).toHaveAttribute("aria-pressed", "true", {
            timeout: 1_000,
          });
        }).toPass({ timeout: 15_000 });
        const row = page.locator("article.bridge-project", {
          hasText: project.name,
        });
        await expect(row.locator(".bridge-row > span.status")).toHaveText(
          t("onb.stage.linked", locale),
        );
        await expect(row.locator(".fd-hint")).toHaveText(
          t("onb.check.never", locale),
        );
        if (locale === "en")
          await expect(row.locator(".bridge-row > span.status")).toHaveText(
            "Linked",
          );
        else
          await expect(row.locator(".bridge-row > span.status")).toHaveText(
            "Verknüpft",
          );
      } finally {
        await context.close();
      }
    });
});
