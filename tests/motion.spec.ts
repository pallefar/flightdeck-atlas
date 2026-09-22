import { test as base, expect, type Page } from "@playwright/test";

// The shared motion layer (lib/motion) in Atlas: the dashboard's stat
// count-up, the sidebar groups' unfold, and the rules both keep. Atlas's own
// CSS motion (motion.css, the chevron's turn) is the reference design, so the
// last test pins it as it is.

type Write = { label: string; text: string };

const test = base.extend<{ motionPage: Page }>({
  // The layer switches itself off under automation (navigator.webdriver), so
  // the tests that watch it move use a Chrome launched without that flag.
  // launchOptions cannot change inside a describe (it is per worker).
  motionPage: async ({ playwright, baseURL, viewport, channel }, provide) => {
    const browser = await playwright.chromium.launch({
      channel,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({ baseURL, viewport });
    await provide(await context.newPage());
    await browser.close();
  },
});

/** Records every write to the text of a dashboard stat number, by tile. */
async function recordNumberWrites(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: Write[] };
    w.__writes = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const strong = r.target.parentElement;
        if (!strong?.matches(".metrics .metric > strong")) continue;
        w.__writes.push({
          label:
            strong.parentElement
              ?.querySelector(".metric-label")
              ?.textContent?.trim() ?? "",
          text: (r.target as Text).data,
        });
      }
    }).observe(document, { characterData: true, subtree: true });
  });
}

const writes = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __writes: Write[] }).__writes.slice(),
  );

type NumberFrame = { nums: Record<string, string>; node: number };

/** Samples what the stat numbers SHOW on every frame, from the first frame
 * on, keeping each change. Unlike the write log, this also sees a tile being
 * replaced by a new one (a new text node), and `node` numbers each <strong>
 * seen, so a remount shows as a new node. */
async function sampleNumbers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: NumberFrame[] };
    w.__frames = [];
    const ids = new WeakMap<Element, number>();
    let mounts = 0;
    const tick = () => {
      const tiles = [...document.querySelectorAll(".metrics .metric")];
      const nums: Record<string, string> = {};
      for (const tile of tiles)
        nums[tile.querySelector(".metric-label")?.textContent?.trim() ?? ""] =
          tile.querySelector("strong")?.textContent ?? "";
      const strong = tiles[0]?.querySelector("strong");
      if (strong && !ids.has(strong)) ids.set(strong, ++mounts);
      const node = strong ? ids.get(strong)! : 0;
      const last = w.__frames.at(-1);
      if (
        !last ||
        last.node !== node ||
        JSON.stringify(last.nums) !== JSON.stringify(nums)
      )
        w.__frames.push({ nums, node });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const numberFrames = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __frames: NumberFrame[] }).__frames.slice(),
  );

/** How many different <strong> nodes the sampler has seen (0 before any). */
const tileMounts = async (page: Page) =>
  new Set((await numberFrames(page)).map((f) => f.node).filter(Boolean)).size;

/** Each tile's shown text, frame by frame, is a zero-padded number that never
 * drops and never passes the rendered one, and ends on it. */
function expectOnlyRises(
  seen: string[],
  tile: { label: string; text: string },
) {
  const width = tile.text.length;
  const final = Number(tile.text);
  const trail = `${tile.label}: ${seen.join(" > ")}`;
  let last = -1;
  for (const text of seen) {
    // Zero padding kept on every frame ("03" on a padded tile).
    expect(text, trail).toMatch(new RegExp(`^\\d{${width}}$`));
    expect(Number(text), trail).toBeGreaterThanOrEqual(last);
    expect(Number(text), trail).toBeLessThanOrEqual(final);
    last = Number(text);
  }
  expect(seen.at(-1), trail).toBe(tile.text);
}

async function numbers(page: Page) {
  const tiles = page.locator(".metrics .metric");
  await expect(tiles).toHaveCount(4);
  return tiles.evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector(".metric-label")?.textContent?.trim() ?? "",
      html: el.querySelector("strong")!.outerHTML,
      text: el.querySelector("strong")!.textContent ?? "",
    })),
  );
}

/** The dashboard numbers as Atlas renders them with the layer switched off
 * (the kill switch), in a page of the same context: the byte-for-byte target. */
async function renderedWithoutMotion(page: Page) {
  const reference = await page.context().newPage();
  await reference.addInitScript(() => {
    window.__FD_MOTION_OFF = true;
  });
  await recordNumberWrites(reference);
  await reference.goto("/");
  await expect(reference.locator(".nav-item").first()).toBeEnabled();
  await reference.waitForTimeout(800);
  const rendered = await numbers(reference);
  expect(await writes(reference)).toEqual([]);
  await reference.close();
  return rendered;
}

/** Waits until the numbers show `target` and nothing has written them for a
 * while, so a count still running cannot pass as settled. */
async function settled(page: Page, target: { text: string }[]) {
  await expect
    .poll(async () => (await numbers(page)).map((n) => n.text))
    .toEqual(target.map((n) => n.text));
  let count = -1;
  await expect
    .poll(
      async () => {
        const now = (await writes(page)).length;
        const still = now === count;
        count = now;
        return still;
      },
      { intervals: [400] },
    )
    .toBe(true);
}

/** A workspace project, varied so each stat tile shows its own number. */
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
});

/** Answers GET /api/projects, for every page of the context, with the real
 * response carrying `n` generated projects instead of the workspace's own. So
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

/** The numbers every sampled frame showed, split at the load's commit: the
 * tiles painted before `/api/projects` answered (the first <strong> the
 * sampler saw; Atlas renders its demo examples then), and the tiles mounted
 * from then on. The load always mounts new tiles: the shell is keyed by the
 * signed-in user, and the stat section by where its numbers come from. */
async function loadFrames(page: Page) {
  const frames = (await numberFrames(page)).filter((f) => f.node);
  const first = frames[0]?.node;
  return {
    painted: frames.filter((f) => f.node === first).map((f) => f.nums),
    loaded: frames.filter((f) => f.node !== first).map((f) => f.nums),
  };
}

const WORKSPACES = [
  ["the demo workspace", 0],
  ["a workspace with 1 project", 1],
  ["a workspace with 9 projects", 9],
] as const;

test.describe("with motion (a browser not under automation)", () => {
  for (const [workspace, n] of WORKSPACES)
    test(`a page load never counts, in ${workspace}: the painted numbers stay until the loaded ones replace them`, async ({
      motionPage: page,
    }) => {
      await serveProjects(page, n);
      const target = await renderedWithoutMotion(page);
      const shown = Object.fromEntries(target.map((t) => [t.label, t.text]));
      await sampleNumbers(page);
      await recordNumberWrites(page);
      await page.goto("/");
      expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
      await expect.poll(() => tileMounts(page)).toBeGreaterThan(1);
      await settled(page, target);
      // No count at all. Counting from 0 would pull back a number already on
      // screen (the server HTML). Counting from the demo examples painted
      // before the load would show numbers that are neither: a workspace of 1
      // project counted 4 > 3 > 2 > 1 on every load.
      expect(await writes(page)).toEqual([]);
      const { painted, loaded } = await loadFrames(page);
      // Before the load: one set of numbers, never moving.
      expect(new Set(painted.map((nums) => JSON.stringify(nums))).size).toBe(1);
      // From the load's commit on: the loaded numbers, from its first frame.
      expect(loaded.length).toBeGreaterThan(0);
      for (const nums of loaded) expect(nums).toEqual(shown);
      // With projects of its own, the load swaps the demo numbers for them.
      if (n > 0) expect(painted[0]).not.toEqual(shown);
      else expect(painted[0]).toEqual(shown);
      // Byte-identical to the motion-off render: no style attribute, no extra node.
      expect(await numbers(page)).toEqual(target);
    });

  test("Start fresh in the demo workspace shows the empty workspace's numbers at once", async ({
    motionPage: page,
  }) => {
    await serveProjects(page, 0);
    await sampleNumbers(page);
    await recordNumberWrites(page);
    await page.goto("/");
    await expect(page.locator(".nav-item").first()).toBeEnabled();
    await expect.poll(() => tileMounts(page)).toBeGreaterThan(1);
    await page.waitForTimeout(800);
    const before = (await numberFrames(page)).length;
    // The demo examples give way to the user's own, empty, workspace.
    await page.getByRole("button", { name: "Start fresh" }).click();
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    await page.waitForTimeout(900);
    expect(await writes(page)).toEqual([]);
    const after = (await numberFrames(page)).slice(before);
    expect(after.length).toBeGreaterThan(0);
    for (const frame of after)
      expect(frame.nums).toEqual({
        "TOTAL PROJECTS": "0",
        "IN PROGRESS": "00",
        "TASKS COMPLETE": "00",
        "ON THE MAP": "00",
      });
  });

  test("a stat tile that mounts again counts from 0 again", async ({
    motionPage: page,
  }) => {
    await serveProjects(page, 9);
    const target = await renderedWithoutMotion(page);
    await recordNumberWrites(page);
    await page.goto("/");
    await settled(page, target);
    await page.getByRole("button", { name: "Today and advisor" }).click();
    await expect(page.locator(".metrics")).toHaveCount(0);
    const before = (await writes(page)).length;
    await page.getByRole("button", { name: "Portfolio", exact: true }).click();
    await settled(page, target);
    const again = (await writes(page)).slice(before);
    for (const tile of target.filter((t) => Number(t.text) > 0)) {
      const values = again.filter((w) => w.label === tile.label);
      // A tile that mounts in the browser counts from 0, and only rises.
      expect(values[0]?.text).toBe("0".padStart(tile.text.length, "0"));
      expectOnlyRises(
        values.map((v) => v.text),
        tile,
      );
    }
    // Byte-identical to the motion-off render: no style attribute, no extra node.
    expect(await numbers(page)).toEqual(target);
  });

  for (const [workspace, n] of WORKSPACES.slice(0, 2))
    test(`reduced motion, in ${workspace}: the numbers never move`, async ({
      motionPage: page,
    }) => {
      await serveProjects(page, n);
      const target = await renderedWithoutMotion(page);
      const shown = Object.fromEntries(target.map((t) => [t.label, t.text]));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await sampleNumbers(page);
      await recordNumberWrites(page);
      await page.goto("/");
      await expect(page.locator(".nav-item").first()).toBeEnabled();
      await expect.poll(() => tileMounts(page)).toBeGreaterThan(1);
      await page.waitForTimeout(1200);
      expect(await writes(page)).toEqual([]);
      // The demo numbers painted before the load give way to the loaded ones
      // at the load's commit. That swap is data arriving, not motion. From
      // that commit on, every frame shows the final numbers.
      const { painted, loaded } = await loadFrames(page);
      expect(new Set(painted.map((nums) => JSON.stringify(nums))).size).toBe(1);
      for (const nums of loaded) expect(nums).toEqual(shown);
      // A tile that mounts again, which counts from 0 with motion, shows its
      // number at once.
      await page.getByRole("button", { name: "Today and advisor" }).click();
      await expect(page.locator(".metrics")).toHaveCount(0);
      const before = (await numberFrames(page)).length;
      await page
        .getByRole("button", { name: "Portfolio", exact: true })
        .click();
      await expect(page.locator(".metrics")).toHaveCount(1);
      await page.waitForTimeout(900);
      expect(await writes(page)).toEqual([]);
      for (const frame of (await numberFrames(page)).slice(before))
        if (frame.node) expect(frame.nums).toEqual(shown);
      expect(await numbers(page)).toEqual(target);
    });
});

test("under automation the layer is off: final numbers at once, never written", async ({
  page,
}) => {
  await recordNumberWrites(page);
  await page.goto("/");
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  await expect(page.locator(".nav-item").first()).toBeEnabled();
  await page.waitForTimeout(1200);
  expect(await writes(page)).toEqual([]);
  for (const n of await numbers(page)) {
    expect(n.html).toMatch(/^<strong>\d+<\/strong>$/);
  }
});

type NavFrame = {
  hidden: boolean;
  opacity: number;
  scale: string;
  help: string;
};
const GROUP = "Team & personal";
const MOVING = ".nav-group-toggle, .nav-submenu, .help-nav-link";

/** Records every style-attribute write to a sidebar group part (a toggle, its
 * chevron, a submenu, the help link), from the first script on. */
async function recordNavWrites(page: Page) {
  await page.addInitScript((moving) => {
    const w = window as unknown as { __navWrites: string[] };
    w.__navWrites = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (!el.closest(".sidebar .atlas-navigation")) continue;
        if (!el.matches(`${moving.join(", ")}, .nav-group-toggle *`)) continue;
        w.__navWrites.push(
          `${el.getAttribute("class")}: ${el.getAttribute("style")}`,
        );
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });
  }, MOVING.split(", "));
}

const navWrites = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __navWrites: string[] }).__navWrites.slice(),
  );

/** Samples the group's submenu and the help link below it on every frame
 * for 600ms, starting now. */
async function sampleNav(page: Page) {
  await page.evaluate((name) => {
    const w = window as unknown as { __navFrames: NavFrame[] };
    w.__navFrames = [];
    const t0 = performance.now();
    const tick = () => {
      const nav = document.querySelector(".sidebar .atlas-navigation")!;
      const group = [...nav.querySelectorAll(".navigation-group")].find(
        (g) => g.querySelector(".nav-group-toggle")?.textContent === name,
      )!;
      const sub = group.querySelector<HTMLElement>(".nav-submenu")!;
      const s = getComputedStyle(sub);
      w.__navFrames.push({
        hidden: sub.hidden,
        opacity: Number(s.opacity),
        scale: s.scale,
        help: getComputedStyle(nav.querySelector(".help-nav-link")!).translate,
      });
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, GROUP);
}

const navFrames = async (page: Page) => {
  await page.waitForTimeout(700);
  return page.evaluate(() =>
    (window as unknown as { __navFrames: NavFrame[] }).__navFrames.slice(),
  );
};

/** The sidebar's groups and the help link as markup: what rests on screen. */
const navMarkup = (page: Page) =>
  page
    .locator(".sidebar .atlas-navigation")
    .evaluate((nav) =>
      [...nav.querySelectorAll(".navigation-group, .help-nav-link")]
        .map((el) => el.outerHTML)
        .join("\n"),
    );

async function openShell(page: Page) {
  await page.goto("/");
  await expect(page.locator(".sidebar .nav-item").first()).toBeEnabled();
  // The shell mounts again once it knows who is signed in; let that settle.
  await page.waitForTimeout(800);
}

const toggle = (page: Page) =>
  page.locator(".sidebar").getByRole("button", { name: GROUP, exact: true });

test.describe("sidebar groups, with motion", () => {
  test("a group unfolds, the rows below glide, and it all ends as the markup", async ({
    motionPage: page,
  }) => {
    // The target: the same toggles with the layer switched off.
    const reference = await page.context().newPage();
    await reference.addInitScript(() => {
      window.__FD_MOTION_OFF = true;
    });
    await openShell(reference);
    await toggle(reference).click();
    const opened = await navMarkup(reference);
    await toggle(reference).click();
    const closed = await navMarkup(reference);
    await reference.close();

    await recordNavWrites(page);
    await openShell(page);
    // The sidebar's mount (and the shell's second mount) never moves it.
    expect(await navWrites(page)).toEqual([]);
    expect(await navMarkup(page)).toBe(closed);

    await sampleNav(page);
    await toggle(page).click();
    // The new state is in the markup at once: the links are there to reach.
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator(".sidebar").getByRole("button", { name: "Team workspace" }),
    ).toBeVisible();
    let frames = (await navFrames(page)).filter((f) => !f.hidden);
    // It unfolds from its top edge, fading in, and never goes back.
    expect(frames[0].opacity).toBeLessThan(0.5);
    expect(frames[0].scale).toMatch(/^1 0(\.\d+)?$/);
    for (let i = 1; i < frames.length; i++)
      expect(frames[i].opacity).toBeGreaterThanOrEqual(frames[i - 1].opacity);
    expect(frames.at(-1)).toMatchObject({ opacity: 1, scale: "none" });
    // The help link below starts where it was painted (higher up) and glides down.
    const firstGlide = frames.find((f) => f.help !== "none")!;
    expect(
      Number(firstGlide.help.split(" ")[1].replace("px", "")),
    ).toBeLessThan(-50);
    expect(frames.at(-1)!.help).toBe("none");
    expect(await navMarkup(page)).toBe(opened);

    await sampleNav(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    frames = await navFrames(page);
    // A closed group is gone at once, as in Atlas (from the click's first
    // frame on, never half-shown); the rows below glide up.
    const gone = frames.findIndex((f) => f.hidden);
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(frames.slice(0, gone).every((f) => f.opacity === 1)).toBe(true);
    frames = frames.slice(gone);
    expect(frames.every((f) => f.hidden)).toBe(true);
    const up = frames.find((f) => f.help !== "none")!;
    expect(Number(up.help.split(" ")[1].replace("px", ""))).toBeGreaterThan(50);
    expect(frames.at(-1)!.help).toBe("none");
    expect(await navMarkup(page)).toBe(closed);

    // The chevron's turn stays Atlas's CSS transition: the layer never wrote it.
    const writes = await navWrites(page);
    expect(writes.some((w) => w.startsWith("nav-submenu:"))).toBe(true);
    expect(writes.filter((w) => /lucide|chevron/.test(w))).toEqual([]);
  });

  test("a navigation made elsewhere opens its group with the same unfold", async ({
    motionPage: page,
  }) => {
    await openShell(page);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("button", { name: "Open search and commands" })
      .click();
    await sampleNav(page);
    await page.getByRole("button", { name: "Wellbeing & focus timer" }).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    const frames = (await navFrames(page)).filter((f) => !f.hidden);
    expect(Math.min(...frames.map((f) => f.opacity))).toBeLessThan(0.5);
    expect(frames.at(-1)).toMatchObject({ opacity: 1, scale: "none" });
  });

  test("groups restored open at load settle without motion", async ({
    motionPage: page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("atlas-nav-groups", "[]");
    });
    await recordNavWrites(page);
    await openShell(page);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    expect(await navWrites(page)).toEqual([]);
  });

  test("the group of a view opened by a link settles without motion", async ({
    motionPage: page,
  }) => {
    // Atlas reads ?view= after its first render, while the workspace loads.
    await recordNavWrites(page);
    await page.goto("/?view=wellbeing");
    await expect(page.locator(".sidebar .nav-item").first()).toBeEnabled();
    await page.waitForTimeout(800);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    expect(await navWrites(page)).toEqual([]);
  });

  test("reduced motion: a group opens and closes without moving", async ({
    motionPage: page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordNavWrites(page);
    await openShell(page);
    await toggle(page).click();
    await expect(
      page.locator(".sidebar").getByRole("button", { name: "Team workspace" }),
    ).toBeVisible();
    await toggle(page).click();
    await page.waitForTimeout(400);
    expect(await navWrites(page)).toEqual([]);
  });
});

test("under automation a sidebar group opens and closes without moving", async ({
  page,
}) => {
  await recordNavWrites(page);
  await openShell(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await toggle(page).click();
  await page.waitForTimeout(400);
  expect(await navWrites(page)).toEqual([]);
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
  // The count-up is text only: the number has no animation or transition of
  // its own to fight, and nothing in CSS starts it hidden.
  expect(css.metric?.animation).toBe("none 0s");
  await expect(page.locator(".metrics .metric > strong").first()).toHaveCSS(
    "opacity",
    "1",
  );
});
