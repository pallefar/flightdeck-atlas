import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { examples, type Project } from "../lib/projects";

// onb-atlas-form-a11y-responsive (plan 2026-09-25, lane onb): the whole To
// FlightDeck form, not only its 390 px stepper, holds up on a phone and at
// 200% zoom, and tells a screen reader what changed.
// - No horizontal scroll on any step at 390x844, nor at 1280 wide zoomed to
//   200% (a 640x400 CSS viewport at device scale 2).
// - The action bar (autosave pill, Save now, Close) is sticky at the bottom
//   of the viewport and never covers the field that has focus.
// - Every control has a label; hints and errors are linked with
//   aria-describedby, and an invalid value is marked aria-invalid.
// - A step change moves focus to the step's h2 and is announced politely;
//   the autosave pill is a polite live region.
// axe-core is not a declared dev dependency, so this is a role/label
// assertion set instead of an axe run.
//
// Drives a running Atlas (ATLAS_BASE_URL, e.g. a dev server of its own on
// :4800) and writes to that server's database, so every project carries a
// run token and is swept before and after.
test.describe.configure({ timeout: 90_000 });

const QA_MARK = " QA-FORMA11Y ";
const RUN = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const qa = (name: string) => `${name}${QA_MARK}${RUN}`;
const STEPS = [
  "Basics",
  "FlightDeck details",
  "Apps (optional)",
  "AI agents (locked)",
  "Review & send",
];
const stepButton = (row: ReturnType<Page["locator"]>, name: string) =>
  row
    .getByRole("navigation", { name: "Onboarding steps" })
    .getByRole("button", { name, exact: true });

/** Screenshots land in the test output; ONB_SHOTS_DIR also keeps a copy
 * (e.g. .shots/onb-next) for the review. */
function shot(name: string) {
  const path = test.info().outputPath(name);
  return {
    path,
    keep() {
      const dir = process.env.ONB_SHOTS_DIR;
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      copyFileSync(path, join(dir, name));
    },
  };
}

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
test.beforeAll(async ({ browser }) => sweep(browser));
test.afterAll(async ({ browser }) => sweep(browser));

const createProject = (page: Page, fields: Partial<Project>) =>
  page.evaluate(
    async (body) => {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return ((await r.json()) as { project: Project }).project;
    },
    { ...examples[0], tasks: [], ...fields },
  );

/** No FlightDeck send: the draft is open. */
async function openStatus(page: Page, id: string) {
  await page.route(`**/api/flightdeck/onboard/${id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operation: null,
        link: null,
        pendingPayload: null,
        canSend: true,
        canClose: false,
        retryPending: false,
        pollable: false,
        notice: null,
        retryAfter: null,
      }),
    }),
  );
}

async function openEditor(page: Page, name: string) {
  await page.goto("/?view=connection");
  const tab = page.getByRole("button", { name: /To FlightDeck/ });
  const row = page.locator("article.bridge-project", { hasText: name });
  await expect(async () => {
    await tab.click({ timeout: 2_000 });
    await expect(tab).toHaveAttribute("aria-pressed", "true", {
      timeout: 1_000,
    });
    await row
      .getByRole("button", { name: "Edit draft", exact: true })
      .click({ timeout: 2_000 });
    await expect(stepButton(row, "Basics")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  // The draft opens once the status has loaded.
  await expect(row.getByLabel("Proposed OS project name")).toBeEnabled();
  return row;
}

const seed = (name: string): Partial<Project> => ({
  name,
  description: "Summary",
  benefit: "Measure",
  functionArea: "HR",
  flightdeckDraft: { label: name, workspaceHint: "" },
  onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
});

/** The page and the form both fit the viewport's width. */
async function expectNoSideScroll(page: Page, where: string) {
  const sizes = await page.evaluate(() => {
    const form = document.querySelector<HTMLElement>("form.fd-onboard")!;
    return {
      doc: document.documentElement.scrollWidth,
      view: innerWidth,
      form: form.scrollWidth,
      formBox: form.clientWidth,
    };
  });
  expect(sizes.doc, `page width on ${where}`).toBeLessThanOrEqual(sizes.view);
  expect(sizes.form, `form width on ${where}`).toBeLessThanOrEqual(
    sizes.formBox + 1,
  );
}

/** The action bar is sticky, sits inside the viewport, and the focused
 * control is fully between the sticky app header and the bar. */
async function expectBarClearOf(
  page: Page,
  field: ReturnType<Page["locator"]>,
) {
  const r = await field.evaluate((el) => {
    const bar = el.closest("form")!.querySelector<HTMLElement>(".fd-actions")!;
    const f = el.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return {
      position: getComputedStyle(bar).position,
      fieldTop: f.top,
      fieldBottom: f.bottom,
      barTop: b.top,
      barBottom: b.bottom,
      view: innerHeight,
      header:
        document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0,
      focused: document.activeElement === el,
    };
  });
  expect(r.focused).toBe(true);
  expect(r.position).toBe("sticky");
  expect(r.barBottom).toBeLessThanOrEqual(r.view + 1);
  expect(
    r.fieldTop,
    "the focused field clears the app header",
  ).toBeGreaterThanOrEqual(r.header);
  expect(
    r.fieldBottom,
    "the focused field clears the action bar",
  ).toBeLessThanOrEqual(r.barTop);
}

async function walkTheForm(page: Page, label: string, file: string) {
  await page.goto("/");
  const name = qa(label);
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  for (const step of STEPS) {
    await stepButton(row, step).click();
    await expect(stepButton(row, step)).toHaveAttribute("aria-current", "step");
    await expectNoSideScroll(page, step);
  }
  // Basics: Summary sits just above the foot of the viewport, under the
  // sticky bar. Tabbing into it from Category scrolls it clear of the bar
  // (the controls' scroll margin), instead of leaving it covered.
  await stepButton(row, "Basics").click();
  const summary = row.getByLabel("Summary", { exact: true });
  await summary.evaluate((el) => {
    el.scrollIntoView({ block: "start" });
    const top = el.getBoundingClientRect().top;
    scrollBy(0, top - (innerHeight - 40));
    const bar = el.closest("form")!.querySelector(".fd-actions")!;
    // Precondition: the field really starts under the bar.
    if (el.getBoundingClientRect().top < bar.getBoundingClientRect().top)
      throw new Error("Summary is not under the action bar");
    document.getElementById("fd-category")!.focus({ preventScroll: true });
  });
  await page.keyboard.press("Tab");
  await expectBarClearOf(page, summary);
  const s = shot(file);
  await page.screenshot({ path: s.path });
  s.keep();
  // The same from the other end: a focused field never hides under it.
  const site = row.getByLabel("Site", { exact: true });
  await site.focus();
  await expectBarClearOf(page, site);
}

test("at 390x844 every step fits, and the sticky action bar never covers the focused field", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await walkTheForm(page, "Phone", "atlas-form-390.png");
  } finally {
    await context.close();
  }
});

test("at 1280 wide zoomed to 200% every step fits, and the bar still clears the focused field", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await walkTheForm(page, "Zoom", "atlas-form-zoom.png");
  } finally {
    await context.close();
  }
});

test("every control is labelled, hints and errors are described, steps focus their h2 and are announced", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("Labels");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  const form = row.locator("form.fd-onboard");

  // The autosave pill is a polite live region.
  const pill = row.getByRole("status", { name: "Autosave" });
  await expect(pill).toHaveAttribute("aria-live", "polite");

  // Basics is open; walk the other steps, then come back to it.
  for (const i of [1, 2, 3, 4, 0]) {
    const step = STEPS[i];
    await stepButton(row, step).click();
    // Focus lands on the step's own heading, and the change is announced.
    const heading = form.getByRole("heading", { level: 2, name: step });
    await expect(heading).toBeFocused();
    await expect(form.locator('[aria-live="polite"].sr-only')).toHaveText(
      `Step ${i + 1} of ${STEPS.length}: ${step}`,
    );
    // The step's fields are grouped under that heading.
    await expect(form.getByRole("group", { name: step })).toBeVisible();

    const problems = await form.evaluate((f) => {
      const out: string[] = [];
      const named = (el: Element) =>
        (el as HTMLInputElement).labels?.length ||
        el.getAttribute("aria-label")?.trim() ||
        el.getAttribute("aria-labelledby");
      for (const el of f.querySelectorAll("input, select, textarea")) {
        if ((el as HTMLInputElement).type === "hidden") continue;
        if (!named(el)) out.push(`unlabelled ${el.tagName} #${el.id}`);
      }
      for (const el of f.querySelectorAll("button")) {
        const text = (el.textContent ?? "").trim();
        if (!text && !el.getAttribute("aria-label"))
          out.push(`unnamed button ${el.outerHTML.slice(0, 80)}`);
      }
      // A field's hint or warning is its control's description.
      for (const field of f.querySelectorAll(".fd-field")) {
        const label = field.querySelector("label[for]");
        if (!label) continue;
        const control = f.querySelector(`#${label.getAttribute("for")}`);
        const hints = [...field.querySelectorAll(".fd-hint, .fd-warn")];
        if (!control || !hints.length) continue;
        const ids = (control.getAttribute("aria-describedby") ?? "").split(
          /\s+/,
        );
        for (const hint of hints) {
          const described = ids.some(
            (id) => id && document.getElementById(id)?.contains(hint),
          );
          if (!described)
            out.push(`#${control.id} does not describe "${hint.textContent}"`);
        }
      }
      return out;
    });
    expect(problems, step).toEqual([]);
  }

  // An invalid value is flagged and its message is the description.
  await stepButton(row, "FlightDeck details").click();
  const slug = row.getByLabel("Proposed OS project id (optional)");
  await slug.fill("Not A Slug!");
  await expect(slug).toHaveAttribute("aria-invalid", "true");
  await expect(slug).toHaveAccessibleDescription(
    /Use lowercase letters, digits and dashes/,
  );
  await slug.fill("");
  await expect(slug).toHaveAttribute("aria-invalid", "false");

  // Next moves focus to the next step's heading too.
  await row.getByLabel("Mark this project Ready for FlightDeck").check();
  await row.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    form.getByRole("heading", { level: 2, name: "Apps (optional)" }),
  ).toBeFocused();
  // A link to a missing field still focuses that field, not the heading.
  await stepButton(row, "Basics").click();
  await row.getByLabel("Success measure").fill("");
  await row
    .getByRole("list", { name: "Missing details" })
    .getByRole("button", { name: "Success measure" })
    .click();
  await expect(row.getByLabel("Success measure")).toBeFocused();
});
