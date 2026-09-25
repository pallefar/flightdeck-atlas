import { test, expect, type Browser, type Page } from "@playwright/test";
import { examples, type Project } from "../lib/projects";

// onb-atlas-save-ux (plan 2026-09-25 §3 J2, §7 lane A): the To FlightDeck
// form saves its onboarding details on its own through the single-flight
// coordinator, shows what the save is doing in a polite status pill, guards
// leaving while work is unsaved, and on a conflict shows both versions side
// by side with "Keep mine" and "Use theirs", holding the local copy (per
// viewer, per project) across a reload until one is chosen.
//
// Drives a running Atlas (ATLAS_BASE_URL, e.g. a dev server of its own on
// :4802) and writes to that server's database, so every project carries a
// run token and is swept before and after.
test.describe.configure({ timeout: 90_000 });

const QA_MARK = " QA-AUTOSAVE ";
const RUN = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const qa = (name: string) => `${name}${QA_MARK}${RUN}`;

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
const latest = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const r = await fetch(`/api/projects/${id}`);
    return ((await r.json()) as { project: Project }).project;
  }, id);
/** A whole-project save from "another tab". */
const saveElsewhere = (page: Page, project: Project, fields: Partial<Project>) =>
  page.evaluate(
    async ({ project, fields }) => {
      const r = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...project,
          activity: undefined,
          ...fields,
          revision: project.revision,
        }),
      });
      return ((await r.json()) as { project: Project }).project;
    },
    { project, fields },
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
  // The tab is clickable before React has hydrated, and the dev server may
  // reload the page once while it optimises dependencies: retry the two
  // clicks together until the form is really open.
  await expect(async () => {
    await tab.click({ timeout: 2_000 });
    await expect(tab).toHaveAttribute("aria-pressed", "true", {
      timeout: 1_000,
    });
    await row
      .getByRole("button", { name: "Edit draft", exact: true })
      .click({ timeout: 2_000 });
    await expect(row.getByRole("tab", { name: "FlightDeck details" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });
  await row.getByRole("tab", { name: "FlightDeck details" }).click();
  // The draft opens once the status has loaded.
  await expect(row.getByLabel("Country")).toBeEnabled();
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
/** True when the page would ask before unloading. */
const unloadGuarded = (page: Page) =>
  page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

test("the pill follows the save, the details save themselves, and nothing guards a saved form", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("Pill");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  const pill = row.getByRole("status", { name: "Autosave" });
  await expect(pill).toHaveAttribute("aria-live", "polite");
  await row.getByLabel("Country").selectOption("FR");
  await expect(pill).toHaveText(/Saved \d{1,2}:\d{2}.*\(revision \d+\)/);
  const saved = await latest(page, project.id);
  expect(saved.onboarding?.countryCode).toBe("FR");
  expect(saved.revision).toBe(project.revision + 1);
  await expect(pill).toContainText(`revision ${saved.revision}`);
  // Everything saved: neither the tab nor the app asks before leaving.
  expect(await unloadGuarded(page)).toBe(false);
  let asked = false;
  page.on("dialog", (d) => {
    asked = true;
    void d.dismiss();
  });
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/view=dashboard/);
  expect(asked).toBe(false);
});

test("a failed save keeps retrying, the pill says so, and leaving asks first", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("Guard");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  let failing = true;
  await page.route(`**/api/projects/${project.id}`, (route) =>
    route.request().method() === "PUT" && failing
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unavailable" }),
        })
      : route.fallback(),
  );
  const row = await openEditor(page, name);
  const pill = row.getByRole("status", { name: "Autosave" });
  await row.getByLabel("Legal entity (optional)").fill("Example GmbH");
  await expect(pill).toContainText(/Not saved, retrying/);
  await expect(row.getByRole("button", { name: "Save now" })).toBeVisible();
  expect(await unloadGuarded(page)).toBe(true);
  // The in-app route guard: dismissing keeps the form open.
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await expect.poll(() => dialogs).toEqual(["confirm"]);
  await expect(page).toHaveURL(/view=connection/);
  await expect(row.getByLabel("Legal entity (optional)")).toHaveValue(
    "Example GmbH",
  );
  // Save now sends at once; once saved, nothing guards any more.
  failing = false;
  await row.getByRole("button", { name: "Save now" }).click();
  await expect(pill).toHaveText(/Saved/);
  expect((await latest(page, project.id)).onboarding?.legalEntity).toBe(
    "Example GmbH",
  );
  expect(await unloadGuarded(page)).toBe(false);
});

test("a conflict shows both versions, survives a reload, and Keep mine re-applies local values on top", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("KeepMine");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  // Another tab changes the onboarding details (and the summary) first.
  const theirs = await saveElsewhere(page, project, {
    description: "Their summary",
    onboarding: { countryCode: "AT", worksCouncilRelevant: "yes" },
  });
  await row.getByLabel("Legal entity (optional)").fill("Mine GmbH");
  const panel = row.getByRole("region", {
    name: `Someone else saved revision ${theirs.revision}`,
  });
  await expect(panel).toBeVisible();
  const pill = row.getByRole("status", { name: "Autosave" });
  await expect(pill).toContainText(/Not saved/);
  await expect(panel.getByRole("columnheader", { name: "Yours" })).toBeVisible();
  await expect(
    panel.getByRole("columnheader", { name: "Theirs" }),
  ).toBeVisible();
  await expect(panel.getByRole("row", { name: /Legal entity/ })).toContainText(
    "Mine GmbH",
  );
  // Only fields this form changed are in question: the country, which only
  // the other tab changed, keeps their value either way.
  await expect(panel.getByRole("row", { name: /Country/ })).toHaveCount(0);
  expect(await unloadGuarded(page)).toBe(true);

  // A reload keeps the local copy until a choice is made.
  await page.reload();
  const again = await openEditor(page, name);
  const held = again.getByRole("region", { name: /Someone else saved|Unsaved changes/ });
  await expect(held).toBeVisible();
  await expect(held.getByRole("row", { name: /Legal entity/ })).toContainText(
    "Mine GmbH",
  );

  await held.getByRole("button", { name: "Keep mine (re-apply on top)" }).click();
  await expect(held).toHaveCount(0);
  await expect(
    again.getByRole("status", { name: "Autosave" }),
  ).toHaveText(/Saved/);
  const merged = await latest(page, project.id);
  expect(merged.revision).toBeGreaterThan(theirs.revision);
  // Mine on top of theirs: my local values win where I edited them, and
  // their unrelated edit (the summary) is kept.
  expect(merged.onboarding?.legalEntity).toBe("Mine GmbH");
  expect(merged.onboarding?.countryCode).toBe("AT");
  expect(merged.onboarding?.worksCouncilRelevant).toBe("yes");
  expect(merged.description).toBe("Their summary");
  expect(await unloadGuarded(page)).toBe(false);
  // The held copy is gone once chosen.
  await page.reload();
  const after = await openEditor(page, name);
  await expect(
    after.getByRole("region", { name: /Someone else saved|Unsaved changes/ }),
  ).toHaveCount(0);
});

test("Use theirs discards the local copy and loads the other version", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("UseTheirs");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  const theirs = await saveElsewhere(page, project, {
    onboarding: { countryCode: "AT", worksCouncilRelevant: "yes" },
  });
  await row.getByLabel("Legal entity (optional)").fill("Mine GmbH");
  const panel = row.getByRole("region", {
    name: `Someone else saved revision ${theirs.revision}`,
  });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Use theirs" }).click();
  await expect(panel).toHaveCount(0);
  await expect(row.getByLabel("Country")).toHaveValue("AT");
  await expect(row.getByLabel("Legal entity (optional)")).toHaveValue("");
  const server = await latest(page, project.id);
  expect(server.revision).toBe(theirs.revision);
  expect(server.onboarding?.legalEntity).toBeUndefined();
  expect(await unloadGuarded(page)).toBe(false);
  await page.reload();
  const after = await openEditor(page, name);
  await expect(
    after.getByRole("region", { name: /Someone else saved|Unsaved changes/ }),
  ).toHaveCount(0);
});

test("edits made while a recovered conflict waits for a choice stay local until Keep mine", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("HeldEdits");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  const theirs = await saveElsewhere(page, project, {
    onboarding: { countryCode: "AT", worksCouncilRelevant: "yes" },
  });
  await row.getByLabel("Legal entity (optional)").fill("Mine GmbH");
  await expect(
    row.getByRole("region", {
      name: `Someone else saved revision ${theirs.revision}`,
    }),
  ).toBeVisible();
  // After a reload the form holds the old local copy, and a new coordinator
  // starts on their revision: an edit now must not send that copy over
  // theirs.
  await page.reload();
  const again = await openEditor(page, name);
  const held = again.getByRole("region", {
    name: /Someone else saved|Unsaved changes/,
  });
  await expect(held).toBeVisible();
  await again.getByLabel("Legal entity (optional)").fill("Mine Two GmbH");
  await page.waitForTimeout(2_500);
  const untouched = await latest(page, project.id);
  expect(untouched.revision).toBe(theirs.revision);
  expect(untouched.onboarding?.countryCode).toBe("AT");
  expect(untouched.onboarding?.worksCouncilRelevant).toBe("yes");
  await expect(held).toBeVisible();
  await expect(again.getByRole("status", { name: "Autosave" })).toContainText(
    /Not saved/,
  );
  expect(await unloadGuarded(page)).toBe(true);

  await held.getByRole("button", { name: "Keep mine (re-apply on top)" }).click();
  await expect(held).toHaveCount(0);
  await expect(again.getByRole("status", { name: "Autosave" })).toHaveText(
    /Saved/,
  );
  const merged = await latest(page, project.id);
  expect(merged.onboarding?.legalEntity).toBe("Mine Two GmbH");
  expect(merged.onboarding?.countryCode).toBe("AT");
  expect(merged.onboarding?.worksCouncilRelevant).toBe("yes");
});

test("Keep mine where both sides chose the same value keeps their unrelated change", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("SameValue");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  const row = await openEditor(page, name);
  // Both editors pick France; the other one also changed works-council
  // relevance.
  const theirs = await saveElsewhere(page, project, {
    onboarding: { countryCode: "FR", worksCouncilRelevant: "yes" },
  });
  await row.getByLabel("Country").selectOption("FR");
  const panel = row.getByRole("region", {
    name: `Someone else saved revision ${theirs.revision}`,
  });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Keep mine (re-apply on top)" }).click();
  await expect(panel).toHaveCount(0);
  await page.waitForTimeout(2_500);
  const server = await latest(page, project.id);
  expect(server.onboarding?.countryCode).toBe("FR");
  expect(server.onboarding?.worksCouncilRelevant).toBe("yes");
  await expect(row.getByLabel("Works council relevant")).toHaveValue("yes");
  expect(await unloadGuarded(page)).toBe(false);
});

test("Save now freezes the form until the whole save is done, so no edit is lost", async ({
  page,
}) => {
  await page.goto("/");
  const name = qa("SaveNowFreeze");
  const project = await createProject(page, seed(name));
  await openStatus(page, project.id);
  // Hold the onboarding autosave open long enough to try an edit.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (
      route.request().method() === "PUT" &&
      (route.request().postData() ?? "").includes('"scope":"onboarding"')
    )
      await gate;
    await route.fallback();
  });
  const row = await openEditor(page, name);
  await row.getByRole("tab", { name: "Basics" }).click();
  await row.getByLabel("Proposed OS project name").fill(`${name} renamed`);
  await row.getByRole("tab", { name: "FlightDeck details" }).click();
  const legal = row.getByLabel("Legal entity (optional)");
  await legal.fill("First GmbH");
  await row.getByRole("button", { name: "Save now" }).click();
  // While the waiting autosave is sent and the whole-project save follows,
  // the form takes no edit that the save would then overwrite.
  await expect(legal).toBeDisabled();
  release();
  await expect(legal).toBeEnabled();
  await expect(row.getByRole("status", { name: "Autosave" })).toHaveText(
    /^(All changes saved|Saved)/,
  );
  const server = await latest(page, project.id);
  expect(server.onboarding?.legalEntity).toBe("First GmbH");
  expect(server.flightdeckDraft?.label).toBe(`${name} renamed`);
  await expect(legal).toHaveValue("First GmbH");
  expect(await unloadGuarded(page)).toBe(false);
});
