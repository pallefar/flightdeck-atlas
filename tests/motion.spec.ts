import { test as base, expect, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Atlas and the shared motion layer (lib/motion). Atlas is the reference
// design, and it uses no JS motion from the layer yet: the two helpers it
// once called went when the OS matched Atlas. The OS dropped its count-up
// (d2107c6a: "draw the KPI band in place and drop the count-up, as Atlas
// does") and its sidebar unfold and glide (0bccb879: "sidebar groups snap
// open and shut; only the chevron turns, as in Atlas"). So these tests pin
// Atlas's own behaviour with motion ON (a browser not under automation, where
// the layer would run): the stat numbers are drawn in place, never an
// in-between number on screen or in the accessibility tree, and the sidebar
// groups snap with only the chevron's CSS turn. The last tests pin Atlas's
// CSS motion as it is.

type Write = { label: string; text: string };

const test = base.extend<{ motionPage: Page }>({
  // The layer switches itself off under automation (navigator.webdriver), so
  // "with motion" means a Chrome launched without that flag.
  // launchOptions cannot change inside a describe (it is per worker).
  motionPage: async ({ playwright, baseURL, viewport, channel }, provide) => {
    const browser = await playwright.chromium.launch({
      channel,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({ baseURL, viewport });
    const page = await context.newPage();
    await provide(page);
    await browser.close();
  },
});

/** Records every write to the text of a dashboard stat number, by tile: a
 * text node's data changing, or the <strong>'s children being replaced. A
 * tile that mounts with its number is not a write, and nor is the HTML parser
 * filling in the server-rendered tiles: recording starts when parsing ends,
 * before the app's scripts run. */
async function recordNumberWrites(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: Write[] };
    w.__writes = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const strong =
          r.type === "childList"
            ? (r.target as Element)
            : r.target.parentElement;
        if (!strong?.matches?.(".metrics .metric > strong")) continue;
        w.__writes.push({
          label:
            strong.parentElement
              ?.querySelector(".metric-label")
              ?.textContent?.trim() ?? "",
          text: strong.textContent ?? "",
        });
      }
    });
    const start = () =>
      observer.observe(document, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    if (document.readyState !== "loading") start();
    else document.addEventListener("readystatechange", start, { once: true });
  });
}

const writes = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: Write[] }).__writes.slice(),
  );

type Nums = Record<string, string>;

/** Samples what the stat numbers SHOW on every frame, from the first frame
 * on, keeping each change ({} while no tiles are mounted). */
async function sampleNumbers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: Nums[] };
    w.__frames = [];
    const tick = () => {
      const nums: Nums = {};
      for (const tile of document.querySelectorAll(".metrics .metric"))
        nums[tile.querySelector(".metric-label")?.textContent?.trim() ?? ""] =
          tile.querySelector("strong")?.textContent ?? "";
      if (JSON.stringify(w.__frames.at(-1)) !== JSON.stringify(nums))
        w.__frames.push(nums);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const numberFrames = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __frames: Nums[] }).__frames.slice(),
  );

const shownNumbers = (page: Page): Promise<Nums> =>
  page
    .locator(".metrics .metric")
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => [
          el.querySelector(".metric-label")?.textContent?.trim() ?? "",
          el.querySelector("strong")?.textContent ?? "",
        ]),
      ),
    );

/** The stat numbers' markup, byte for byte: Atlas renders `<strong>8</strong>`
 * and `<strong>05</strong>`, with no style attribute and no extra node. */
const numberMarkup = (page: Page) =>
  page
    .locator(".metrics .metric > strong")
    .evaluateAll((els) => els.map((el) => el.outerHTML));

/** A workspace project, varied so each stat tile shows its own number. Every
 * fourth one is archived, so the Archived filter has numbers of its own. */
const project = (i: number) => ({
  id: `motion-${i}`,
  name: `Motion project ${i}`,
  description: "A workspace project.",
  status: i % 2 ? "In progress" : "Planning",
  category: "Platform",
  location: "Copenhagen, Denmark",
  latitude: i % 3 ? 55.6 + i / 100 : null,
  longitude: i % 3 ? 12.5 : null,
  dueDate: "2026-12-01",
  color: "orange",
  tasks: [
    { id: "a", title: "One", done: true },
    { id: "b", title: "Two", done: i % 2 === 0 },
  ],
  source: "atlas",
  updatedAt: "2026-09-20",
  revision: 1,
  canEdit: true,
  ownedByMe: true,
  ...(i % 4 === 0 ? { archived: true } : {}),
});

/** The numbers Atlas must show for `n` generated projects, for the default
 * filter and for Archived. */
function expected(n: number, archived = false): Nums {
  const data = Array.from({ length: n }, (_, i) => project(i + 1)).filter(
    (p) => !!p.archived === archived,
  );
  const pad = (x: number) => String(x).padStart(2, "0");
  return {
    "TOTAL PROJECTS": String(data.length),
    "IN PROGRESS": pad(data.filter((p) => p.status === "In progress").length),
    "TASKS COMPLETE": pad(
      data.reduce((s, p) => s + p.tasks.filter((t) => t.done).length, 0),
    ),
    "ON THE MAP": pad(data.filter((p) => p.latitude !== null).length),
  };
}

/** Answers GET /api/projects, for every page of the context, with the real
 * response carrying `n` generated projects instead of the workspace's own, so
 * a test sees the same data whatever the local D1 holds. 0 is the demo
 * workspace: Atlas then shows its example projects. */
async function serveProjects(page: Page, n: number) {
  await page.context().route("**/api/projects", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    body.projects = Array.from({ length: n }, (_, i) => project(i + 1));
    await route.fulfill({ response, json: body });
  });
}

/** Every write is a tile's final number: the load or the filter putting the
 * new data in, never a number on the way to it. At most one per tile. */
function expectOnlyFinalWrites(seen: Write[], final: Nums) {
  for (const w of seen)
    expect(w.text, `${w.label} written`).toBe(final[w.label]);
  for (const label of Object.keys(final))
    expect(seen.filter((w) => w.label === label).length).toBeLessThanOrEqual(1);
}

/** Each sampled frame showed either the numbers before (`from`) or the final
 * ones, switching once, never anything in between. */
function expectStraightSwap(frames: Nums[], from: Nums | null, final: Nums) {
  const shown = frames.filter((f) => Object.keys(f).length);
  const trail = shown.map((f) => Object.values(f).join("|")).join(" > ");
  const at = shown.findIndex(
    (f) => JSON.stringify(f) === JSON.stringify(final),
  );
  expect(at, trail).toBeGreaterThanOrEqual(0);
  for (const f of shown.slice(0, at)) expect(f, trail).toEqual(from);
  for (const f of shown.slice(at)) expect(f, trail).toEqual(final);
}

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.locator(".nav-item").first()).toBeEnabled();
  // The shell mounts again once it knows who is signed in; let that settle.
  await page.waitForTimeout(900);
}

const WORKSPACES = [
  ["the demo workspace", 0],
  ["a workspace with 1 project", 1],
  ["a workspace with 9 projects", 9],
] as const;

for (const reduced of [false, true])
  test.describe(
    reduced
      ? "stat numbers, with motion allowed but reduced"
      : "stat numbers, with motion",
    () => {
      test.beforeEach(async ({ motionPage: page }) => {
        if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
        await recordNumberWrites(page);
        await sampleNumbers(page);
      });

      for (const [workspace, n] of WORKSPACES)
        test(`a page load draws them in place, in ${workspace}`, async ({
          motionPage: page,
        }) => {
          await serveProjects(page, n);
          await openDashboard(page);
          expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
          const final = n ? expected(n) : await shownNumbers(page);
          const frames = await numberFrames(page);
          // Before /api/projects answers, Atlas renders its demo examples;
          // the loaded numbers replace them in one step. With projects of
          // its own, a workspace of 1 never shows 4 > 3 > 2 > 1.
          const painted = frames.find((f) => Object.keys(f).length)!;
          expectStraightSwap(frames, painted, final);
          // The loaded numbers come in new tiles (the shell mounts again
          // once it knows who is signed in): no number is ever written.
          expect(await writes(page)).toEqual([]);
          expect(await numberMarkup(page)).toEqual(
            Object.values(final).map((v) => `<strong>${v}</strong>`),
          );
        });

      test("Today and advisor, then Portfolio: the tiles mount with their numbers, with nothing written", async ({
        motionPage: page,
      }) => {
        await serveProjects(page, 9);
        await openDashboard(page);
        const final = expected(9);
        expect(await shownNumbers(page)).toEqual(final);
        await page.getByRole("button", { name: "Today and advisor" }).click();
        await expect(page.locator(".metrics")).toHaveCount(0);
        const before = { writes: (await writes(page)).length };
        const from = (await numberFrames(page)).length;
        await page
          .getByRole("button", { name: "Portfolio", exact: true })
          .click();
        const region = page.getByRole("region", { name: "Project overview" });
        await expect(region).toBeVisible();
        // The accessibility tree reads the true numbers from the tiles'
        // first frame, not a count on its way to them.
        const first = await region.ariaSnapshot();
        await page.waitForTimeout(900);
        expect(first).toBe(await region.ariaSnapshot());
        for (const value of Object.values(final))
          expect(first).toContain(value);
        for (const f of (await numberFrames(page)).slice(from))
          if (Object.keys(f).length) expect(f).toEqual(final);
        expect((await writes(page)).slice(before.writes)).toEqual([]);
      });

      test("the Archived filter swaps the numbers in one step", async ({
        motionPage: page,
      }) => {
        await serveProjects(page, 9);
        await openDashboard(page);
        const active = expected(9);
        const archived = expected(9, true);
        expect(await shownNumbers(page)).toEqual(active);
        const before = (await writes(page)).length;
        const from = (await numberFrames(page)).length;
        await page
          .getByRole("button", { name: "Archived", exact: true })
          .click();
        await expect.poll(() => shownNumbers(page)).toEqual(archived);
        await page.waitForTimeout(900);
        expectStraightSwap(
          (await numberFrames(page)).slice(from),
          active,
          archived,
        );
        expectOnlyFinalWrites((await writes(page)).slice(before), archived);
        await page
          .getByRole("button", { name: "All projects", exact: true })
          .click();
        await expect.poll(() => shownNumbers(page)).toEqual(active);
        expect(await numberMarkup(page)).toEqual(
          Object.values(active).map((v) => `<strong>${v}</strong>`),
        );
      });
    },
  );

test("under automation the stat numbers are drawn in place too", async ({
  page,
}) => {
  await serveProjects(page, 1);
  await recordNumberWrites(page);
  await openDashboard(page);
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  expect(await writes(page)).toEqual([]);
  expect(await shownNumbers(page)).toEqual(expected(1));
});

test("nothing in Atlas counts a number up", () => {
  // The OS removed its count-up to match Atlas (d2107c6a); lib/motion no
  // longer has one to import. A source check, as the OS's own suite has.
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(root, dir));
  const counting = files.filter((f) =>
    /\buseCountUp\b|\bcountUp\s*\(|<CountUp\b/.test(readFileSync(f, "utf8")),
  );
  expect(counting).toEqual([]);
});

const GROUPS = ["Team & personal", "Connections & admin"];
const NAV = ".sidebar .atlas-navigation";

/** Records every style-attribute write anywhere in the sidebar navigation
 * (toggles, chevrons, submenus, the help link), from the first script on. */
async function recordNavWrites(page: Page) {
  await page.addInitScript((nav) => {
    const w = window as unknown as { __navWrites: string[] };
    w.__navWrites = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (!el.closest(nav)) continue;
        w.__navWrites.push(
          `${el.tagName.toLowerCase()}.${el.getAttribute("class")}: ${el.getAttribute("style")}`,
        );
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });
  }, NAV);
}

const navWrites = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __navWrites: string[] }).__navWrites.slice(),
  );

type NavFrame = {
  hidden: boolean;
  opacity: number;
  scale: string;
  help: string;
};

/** Samples a group's submenu and the help link below it on every frame for
 * 500ms, starting now. */
async function sampleNav(page: Page, group: string) {
  await page.evaluate(
    ([nav, name]) => {
      const w = window as unknown as { __navFrames: NavFrame[] };
      w.__navFrames = [];
      const t0 = performance.now();
      const tick = () => {
        const root = document.querySelector(nav)!;
        const g = [...root.querySelectorAll(".navigation-group")].find(
          (x) => x.querySelector(".nav-group-toggle")?.textContent === name,
        )!;
        const sub = g.querySelector<HTMLElement>(".nav-submenu")!;
        const s = getComputedStyle(sub);
        w.__navFrames.push({
          hidden: sub.hidden,
          opacity: Number(s.opacity),
          scale: s.scale,
          help: getComputedStyle(root.querySelector(".help-nav-link")!)
            .translate,
        });
        if (performance.now() - t0 < 500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [NAV, group],
  );
}

const navFrames = async (page: Page) => {
  await page.waitForTimeout(600);
  return page.evaluate(() =>
    (window as unknown as { __navFrames: NavFrame[] }).__navFrames.slice(),
  );
};

const toggle = (page: Page, group: string) =>
  page.locator(".sidebar").getByRole("button", { name: group, exact: true });

/** Every sampled frame shows the group fully drawn or hidden, and the help
 * link in its own place: nothing unfolds, fades or glides. */
function expectSnap(frames: NavFrame[], hidden: boolean) {
  expect(frames.length).toBeGreaterThan(3);
  const after = frames.slice(frames.findIndex((f) => f.hidden === hidden));
  expect(after.length).toBeGreaterThan(0);
  for (const f of frames) {
    expect(f).toMatchObject({ opacity: 1, scale: "none", help: "none" });
  }
  for (const f of after) expect(f.hidden).toBe(hidden);
}

test.describe("sidebar groups, with motion", () => {
  test("a group snaps open and shut, as in Atlas, with nothing written to the sidebar's style", async ({
    motionPage: page,
  }) => {
    await recordNavWrites(page);
    await openDashboard(page);
    for (const group of GROUPS) {
      await expect(toggle(page, group)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await sampleNav(page, group);
      await toggle(page, group).click();
      await expect(toggle(page, group)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expectSnap(await navFrames(page), false);
      await sampleNav(page, group);
      await toggle(page, group).click();
      await expect(toggle(page, group)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expectSnap(await navFrames(page), true);
    }
    // Rapid clicks: open, shut, open.
    const group = GROUPS[0];
    await toggle(page, group).click();
    await toggle(page, group).click();
    await toggle(page, group).click();
    await expect(toggle(page, group)).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(400);
    expect(await navWrites(page)).toEqual([]);
  });

  test("the chevron turns in CSS only", async ({ motionPage: page }) => {
    await recordNavWrites(page);
    await openDashboard(page);
    const chevron = toggle(page, GROUPS[0]).locator("svg").last();
    const rest = await chevron.evaluate((el) => getComputedStyle(el).transform);
    await toggle(page, GROUPS[0]).click();
    // Mid-turn (the transition is 200ms), then at rest on its new angle.
    await page.waitForTimeout(60);
    const mid = await chevron.evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(400);
    const open = await chevron.evaluate((el) => getComputedStyle(el).transform);
    expect(open).not.toBe(rest);
    expect([rest, open]).not.toContain(mid);
    expect(await chevron.getAttribute("style")).toBeNull();
    expect(await navWrites(page)).toEqual([]);
  });

  test("a navigation made elsewhere opens its group without motion", async ({
    motionPage: page,
  }) => {
    await recordNavWrites(page);
    await openDashboard(page);
    await expect(toggle(page, GROUPS[0])).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page
      .getByRole("button", { name: "Open search and commands" })
      .click();
    await sampleNav(page, GROUPS[0]);
    await page.getByRole("button", { name: "Wellbeing & focus timer" }).click();
    await expect(toggle(page, GROUPS[0])).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expectSnap(await navFrames(page), false);
    expect(await navWrites(page)).toEqual([]);
  });

  test("groups restored open, or opened by a ?view= link, settle without motion", async ({
    motionPage: page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("atlas-nav-groups", "[]");
    });
    await recordNavWrites(page);
    await openDashboard(page);
    for (const group of GROUPS)
      await expect(toggle(page, group)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    await page.goto("/?view=wellbeing");
    await expect(page.locator(".sidebar .nav-item").first()).toBeEnabled();
    await page.waitForTimeout(800);
    expect(await navWrites(page)).toEqual([]);
  });
});

test("Atlas's own CSS motion stays the reference", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".nav-item").first()).toBeEnabled();
  const css = await page.evaluate(() => {
    const cs = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        animation: `${s.animationName} ${s.animationDuration}`,
        transition: `${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}`,
      };
    };
    return {
      heading: cs(".dashboard > .page-heading")?.animation,
      card: cs(".project-grid > .project-card")?.animation,
      indicator: cs(".view-tab-indicator")?.transition,
      chevron: cs(".sidebar .nav-group-toggle > svg:last-child")?.transition,
      metric: cs(".metrics .metric > strong"),
    };
  });
  expect(css.heading).toBe("atlas-arrive 0.5s");
  expect(css.card).toBe("atlas-arrive 0.45s");
  expect(css.indicator).toBe("transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)");
  expect(css.chevron).toBe("transform 0.2s ease");
  // The stat numbers have no motion of their own, and nothing starts them hidden.
  expect(css.metric?.animation).toBe("none 0s");
  await expect(page.locator(".metrics .metric > strong").first()).toHaveCSS(
    "opacity",
    "1",
  );
});
