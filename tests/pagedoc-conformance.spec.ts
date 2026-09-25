import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { goldenAdapters, normalizeGoldenHtml } from "../lib/pagedoc/fixtures/golden.js";
import { DOC_FIXTURES } from "../lib/pagedoc/fixtures/index.js";
import { PageDocRenderer } from "../lib/pagedoc/render/index.js";
import { parsePageDoc, type PageDocV2 } from "../lib/pagedoc/schema/index.js";
import {
  PAGEDOC_FIXTURE_ROUTE,
  pagedocFixtureMediaUrl,
  pagedocFixturesEnabled,
} from "../lib/pagedoc-fixtures";

// ATLAS RENDERER CONFORMANCE (pages-atlas-conformance, plan 2026-09-25 Lane C).
//
// Golden parity alone passes a defect the renderer and its goldens share, so
// beside the goldens this runs, under Atlas's own React and browser:
//   1. SSR output equals the OS goldens (lib/pagedoc/fixtures/*.html);
//   2. the OS render test's semantic assertions (flightdeck/tests/
//      pagedocRender.test.tsx: root lang, section/column order, no h1, no
//      h4-h6, no landmark, role=img only on deferred media, alt on every img,
//      pd-* classes only, no inline style, rel on every link, DOM order is
//      reading order), made on the DOM, independently of the goldens;
//   3. the dev-only fixture route (app/%5F%5Fpagedoc-fixtures, served at
//      /__pagedoc-fixtures/<name>) hydrates every fixture with stub adapters
//      and zero hydration warnings; tabs follow the arrows, an FAQ opens with
//      Enter, and a video fetches nothing before Play;
//   4. computed contrast >= 4.5:1 for every pd text on every section emphasis,
//      for every theme preset, in Atlas light and dark;
//   5. forced-colors mode keeps the tab and CTA focus outlines;
//   6. the landing fixture at 1200 and 390 wide, light and dark: no horizontal
//      scroll and a non-blank screenshot. PNGs go to test-results/pagedoc-shots
//      (or $PAGEDOC_SHOTS_DIR) as review evidence.
// Parts 3 to 6 need an Atlas dev server (ATLAS_BASE_URL, e.g. a checkout's own
// `npm run dev -- --port 4808`); parts 1 and 2 need none.

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_DIR = path.join(root, "lib", "pagedoc", "fixtures");
const ACCEPTED = DOC_FIXTURES.filter((f) => f.expect === "ok");
const LOCALES = ["en", "de"] as const;

function parsed(doc: unknown): PageDocV2 {
  const r = parsePageDoc(doc);
  if (!r.ok) throw new Error(`fixture does not parse: ${JSON.stringify(r.issues)}`);
  return r.doc;
}

const ssr = (doc: PageDocV2, locale: "en" | "de") =>
  renderToStaticMarkup(createElement(PageDocRenderer, { doc, locale, adapters: goldenAdapters() }));

test.describe("1. SSR equals the OS goldens", () => {
  test("every accepted fixture, both locales", () => {
    expect(ACCEPTED.length).toBeGreaterThan(20);
    for (const f of ACCEPTED) {
      for (const locale of LOCALES) {
        const golden = readFileSync(path.join(FIXTURE_DIR, `${f.name}.${locale}.html`), "utf8");
        expect(normalizeGoldenHtml(ssr(parsed(f.doc), locale)), `${f.name}.${locale}`).toBe(golden);
      }
    }
  });
});

test.describe("2. semantic assertions, independent of the goldens", () => {
  test("every accepted fixture, both locales, in Atlas's browser", async ({ page }) => {
    const cases = ACCEPTED.flatMap((f) =>
      LOCALES.map((locale) => {
        const doc = parsed(f.doc);
        return {
          key: `${f.name}.${locale}`,
          locale,
          html: ssr(doc, locale),
          sections: doc.sections.map((s) => ({ id: s.id, columns: s.columns.map((c) => c.id) })),
          blocks: doc.sections.flatMap((s) => s.columns.flatMap((c) => c.blocks.map((b) => b.id))),
        };
      }),
    );
    // the markup is the renderer's own output, parsed by the browser
    await page.setContent(
      `<!doctype html><html><body>${cases
        .map((c) => `<div data-case="${c.key}">${c.html}</div>`)
        .join("")}</body></html>`,
    );
    const failures = await page.evaluate((all) => {
      const out: string[] = [];
      // No landmark and no ARIA role, except the three the WAI-ARIA tabs
      // pattern needs and role=img on a deferred media placeholder.
      const LANDMARKS =
        "main, nav, header, footer, aside, section, form, [role]:not([role=tablist], [role=tab], [role=tabpanel], [role=img])";
      for (const c of all) {
        const fail = (m: string) => out.push(`${c.key}: ${m}`);
        const host = document.querySelector(`[data-case="${c.key}"]`)!;
        const roots = host.querySelectorAll(":scope > .pd-root");
        if (roots.length !== 1) {
          fail(`expected one .pd-root, got ${roots.length}`);
          continue;
        }
        const root = roots[0] as HTMLElement;
        for (const el of host.children)
          if (el !== root && !el.outerHTML.startsWith('<link rel="preload" as="image"'))
            fail(`stray <${el.tagName}> beside the root`);
        if (root.getAttribute("lang") !== c.locale) fail(`root lang ${root.getAttribute("lang")}`);
        if (root.querySelectorAll(".pd-block-error").length) fail("a block failed to render");
        const sections = [...root.querySelectorAll(":scope > .pd-section")];
        const got = sections.map((s) => ({
          id: s.getAttribute("data-pd-id"),
          columns: [...s.querySelectorAll(":scope > .pd-columns > .pd-column")].map((x) => x.getAttribute("data-pd-id")),
        }));
        if (JSON.stringify(got) !== JSON.stringify(c.sections)) fail(`sections/columns ${JSON.stringify(got)}`);
        const order = [...root.querySelectorAll(".pd-section > .pd-columns > .pd-column > .pd-block")].map((b) =>
          b.getAttribute("data-pd-id"),
        );
        if (JSON.stringify(order) !== JSON.stringify(c.blocks)) fail(`reading order ${JSON.stringify(order)}`);
        if (root.querySelector("h1")) fail("an h1 (the page title is the host's)");
        for (const hx of root.querySelectorAll("h4, h5, h6")) fail(`unexpected ${hx.tagName}`);
        for (const l of root.querySelectorAll(LANDMARKS)) fail(`landmark <${l.tagName} role=${l.getAttribute("role")}>`);
        for (const el of root.querySelectorAll("[role=img]")) {
          if (!el.classList.contains("pd-media-deferred")) fail("role=img outside a deferred placeholder");
          if (!el.getAttribute("aria-label")) fail("role=img without a name");
        }
        for (const img of root.querySelectorAll("img")) if (!img.hasAttribute("alt")) fail("img without alt");
        for (const el of [root, ...root.querySelectorAll("*")]) {
          for (const cls of el.classList) if (!cls.startsWith("pd-")) fail(`class ${cls} on <${el.tagName}>`);
          if (el.hasAttribute("style")) fail(`inline style on <${el.tagName}>`);
        }
        for (const a of root.querySelectorAll("a"))
          if (a.getAttribute("rel") !== "noopener noreferrer") fail(`link rel ${a.getAttribute("rel")}`);
      }
      return out;
    }, cases.map((c) => ({ key: c.key, locale: c.locale, sections: c.sections, blocks: c.blocks })));
    expect(cases.length).toBe(ACCEPTED.length * 2);
    expect(failures).toEqual([]);
  });

  test("fallback text carries the lang it is written in (de-partial in German)", async ({ page }) => {
    const doc = parsed(DOC_FIXTURES.find((f) => f.name === "de-partial")!.doc);
    await page.setContent(`<!doctype html><html><body>${ssr(doc, "de")}</body></html>`);
    const sub = page.locator(".pd-hero-subheading");
    await expect(sub).toHaveAttribute("lang", "en");
    await expect(sub).toHaveAttribute("data-missing-translation", "de");
    await expect(page.locator(".pd-hero h2")).not.toHaveAttribute("lang", /./);
  });
});

test.describe("the fixture route is dev-only and fails closed", () => {
  test("enabled only in development", () => {
    expect(pagedocFixturesEnabled("development")).toBe(true);
    expect(pagedocFixturesEnabled("production")).toBe(false);
    expect(pagedocFixturesEnabled("test")).toBe(false);
    expect(pagedocFixturesEnabled(undefined)).toBe(false);
    expect(pagedocFixturesEnabled("")).toBe(false);
    expect(PAGEDOC_FIXTURE_ROUTE).toBe("/__pagedoc-fixtures");
    expect(pagedocFixtureMediaUrl("abc")).toBe("/__pagedoc-fixtures/media/abc");
  });

  test("the route folder decodes to /__pagedoc-fixtures (an _ folder would be private)", () => {
    const page = readFileSync(path.join(root, "app", "%5F%5Fpagedoc-fixtures", "[name]", "page.tsx"), "utf8");
    expect(page).toContain("pagedocFixturesEnabled(process.env.NODE_ENV)");
    expect(page).toContain("notFound()");
    const media = readFileSync(path.join(root, "app", "%5F%5Fpagedoc-fixtures", "media", "[id]", "route.ts"), "utf8");
    expect(media).toContain("pagedocFixturesEnabled(process.env.NODE_ENV)");
  });
});

// ---- parts 3 to 6: the fixture route on an Atlas dev server ----

type Probe = { media: string[]; navigated: string[] };

function fixtureUrl(name: string, q: Record<string, string> = {}) {
  const s = new URLSearchParams(q).toString();
  return `${PAGEDOC_FIXTURE_ROUTE}/${name}${s ? `?${s}` : ""}`;
}

/** Console messages that signal a hydration problem, or any error at all. */
function watchConsole(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" || /hydrat|did not match|server rendered/i.test(text)) bad.push(`${m.type()}: ${text}`);
  });
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  return bad;
}

async function openFixture(page: Page, name: string, q: Record<string, string> = {}) {
  const res = await page.goto(fixtureUrl(name, q));
  expect(res?.status(), `${name} status`).toBe(200);
  await expect(page.locator("[data-pagedoc-fixture-view][data-hydrated='true']")).toBeAttached({ timeout: 30_000 }); // a blank doc has no size
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __pagedocFixture: Probe }).__pagedocFixture);

async function setAtlasTheme(page: Page, mode: "light" | "dark") {
  await page.addInitScript((m) => {
    try {
      localStorage.setItem("atlas-theme", m);
    } catch {
      /* private window */
    }
  }, mode);
}

test.describe("3. hydration and interaction on the fixture route", () => {
  test.describe.configure({ timeout: 240_000 });

  test("every accepted fixture hydrates in both locales with zero hydration warnings", async ({ page }) => {
    const bad = watchConsole(page);
    for (const f of ACCEPTED) {
      for (const locale of LOCALES) {
        await openFixture(page, f.name, { locale });
        await expect(page.locator(".pd-root"), `${f.name}.${locale}`).toHaveAttribute("lang", locale);
        await expect(page.locator(".pd-block-error"), `${f.name}.${locale}`).toHaveCount(0);
        expect(bad, `${f.name}.${locale}`).toEqual([]);
      }
    }
  });

  test("the host owns the landmarks and the one h1", async ({ page }) => {
    await openFixture(page, "template-landing");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main .pd-root")).toHaveCount(1);
  });

  test("an unknown fixture is a 404", async ({ page }) => {
    const res = await page.goto(fixtureUrl("no-such-fixture"));
    expect(res?.status()).toBe(404);
  });

  test("tabs move with the arrow keys, Home and End (roving tabindex)", async ({ page }) => {
    const bad = watchConsole(page);
    await openFixture(page, "block-tabs");
    const tabs = page.getByRole("tab");
    const n = await tabs.count();
    expect(n).toBeGreaterThan(1);
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(tabs.first()).toHaveAttribute("tabindex", "-1");
    const panel = page.locator(`#${await tabs.nth(1).getAttribute("aria-controls")}`);
    await expect(panel).toBeVisible();
    await expect(page.locator(`#${await tabs.first().getAttribute("aria-controls")}`)).toBeHidden();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // wraps
    await expect(tabs.nth(n - 1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.nth(n - 1)).toBeFocused();
    expect(bad).toEqual([]);
  });

  test("an FAQ question opens with Enter", async ({ page }) => {
    await openFixture(page, "block-faq");
    const item = page.locator("details.pd-faq-item").first();
    await expect(item).not.toHaveAttribute("open", /.*/);
    await item.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("open", "");
    await expect(item.locator(".pd-faq-a")).toBeVisible();
  });

  test("a video fetches nothing but its poster before Play", async ({ page }) => {
    const doc = parsed(DOC_FIXTURES.find((f) => f.name === "media-video")!.doc);
    const block = doc.sections[0]!.columns[0]!.blocks[0]!;
    if (block.type !== "media" || block.kind !== "video") throw new Error("fixture changed");
    const videoId = block.mediaRef.mediaId;
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    await openFixture(page, "media-video");
    await page.locator(".pd-video").scrollIntoViewIfNeeded();
    await expect(page.locator(".pd-video-play")).toBeVisible();
    await page.waitForTimeout(300); // let the observer and any fetch settle
    expect((await probe(page)).media).not.toContain(videoId);
    expect(requested).not.toContain(pagedocFixtureMediaUrl(videoId));
    await page.locator(".pd-video-play").click();
    await expect(page.locator("video.pd-video-el")).toHaveCount(1);
    expect((await probe(page)).media).toContain(videoId);
  });
});

test.describe("4. contrast >= 4.5:1 for pd text on every emphasis, light and dark", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const theme of ["default", "calm", "accent"] as const) {
      test(`${theme} theme, Atlas ${mode}`, async ({ page }) => {
        await setAtlasTheme(page, mode);
        // template-landing has a strong, a plain and a subtle section;
        // three-column a subtle one with rich text; de-only and de-partial links
        const seen = new Set<string>();
        const failures: string[] = [];
        for (const name of ["template-landing", "three-column", "de-only", "de-partial", "block-cta", "block-tabs", "block-faq"]) {
          await openFixture(page, name, { theme });
          await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
          const r = await page.evaluate(contrastProbe);
          r.emphases.forEach((e) => seen.add(e));
          failures.push(...r.failures.map((x) => `${name}: ${x}`));
          expect(r.checked, name).toBeGreaterThan(0);
        }
        expect([...seen].sort()).toEqual(["none", "strong", "subtle"]);
        expect(failures).toEqual([]);
      });
    }
  }
});

test.describe("5. forced-colors mode keeps the focus outlines", () => {
  test("tab and CTA", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const outline = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        return { cls: el.className, style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
    await openFixture(page, "block-tabs");
    await page.locator("h1").click();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.getAttribute("role") === "tab")) break;
    }
    const tab = await outline();
    expect(tab.cls).toContain("pd-tab");
    expect(tab.style).not.toBe("none");
    expect(tab.width).toBeGreaterThanOrEqual(1);
    // the selected tab keeps its indicator border
    const sel = await page.locator(".pd-tab[aria-selected='true']").evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.borderBottomStyle, width: parseFloat(s.borderBottomWidth) };
    });
    expect(sel.style).toBe("solid");
    expect(sel.width).toBeGreaterThanOrEqual(2);

    await openFixture(page, "block-cta");
    await page.locator("h1").click();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.classList.contains("pd-button") ?? false)) break;
    }
    const cta = await outline();
    expect(cta.cls).toContain("pd-button");
    expect(cta.style).not.toBe("none");
    expect(cta.width).toBeGreaterThanOrEqual(1);
  });
});

test.describe("6. landing fixture screenshots", () => {
  const dir = process.env.PAGEDOC_SHOTS_DIR ?? path.join(root, "test-results", "pagedoc-shots");
  for (const width of [1200, 390]) {
    for (const mode of ["light", "dark"] as const) {
      test(`template-landing at ${width}, ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await setAtlasTheme(page, mode);
        await openFixture(page, "template-landing");
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(scroll, "horizontal scroll").toBeLessThanOrEqual(0);
        const png = await page.screenshot({ fullPage: true });
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `template-landing-${width}-${mode}.png`), png);
        // non-blank: the rendered page shows more than one colour
        const colours = await page.evaluate(async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          const set = new Set<number>();
          for (let i = 0; i < d.length && set.size < 50; i += 4 * 97) set.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
          return set.size;
        }, png.toString("base64"));
        expect(colours).toBeGreaterThan(5);
      });
    }
  }
});

/** Runs in the page: WCAG contrast of every visible text-bearing element in
 * .pd-root against its effective background. Colours are resolved through a
 * canvas, so any CSS colour syntax (oklch included) is measured in sRGB. */
function contrastProbe() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const rgba = (css: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const over = (top: number[], bottom: number[]) => {
    const a = top[3]!;
    return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1);
  };
  const bgOf = (el: Element | null): number[] => {
    const layers: number[][] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let out = [255, 255, 255, 1];
    for (const l of layers.reverse()) out = over(l, out);
    return out;
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const failures: string[] = [];
  const emphases = new Set<string>();
  let checked = 0;
  for (const el of document.querySelectorAll(".pd-root *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!own) continue;
    const box = (el as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) continue;
    if (el.closest(".pd-button-disabled, [aria-disabled='true'], :disabled")) continue; // WCAG 1.4.3 exempts inactive controls
    const section = el.closest(".pd-section");
    const emphasis = section ? [...section.classList].find((c) => c.startsWith("pd-emphasis-"))?.slice(12) : undefined;
    if (emphasis) emphases.add(emphasis);
    const bg = bgOf(el);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const r = ratio(fg, bg);
    checked++;
    if (r < 4.5)
      failures.push(
        `<${el.tagName.toLowerCase()} class="${el.className}"> on emphasis ${emphasis}: ${r.toFixed(2)} (fg ${fg
          .slice(0, 3)
          .map(Math.round)} bg ${bg.slice(0, 3).map(Math.round)})`,
      );
  }
  return { failures, emphases: [...emphases], checked };
}
