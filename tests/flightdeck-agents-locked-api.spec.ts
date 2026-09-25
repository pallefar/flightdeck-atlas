import { test, expect, type Page } from "@playwright/test";
import { examples, type Project } from "../lib/projects";

// onb-aiagents-locked-atlas, against a running Atlas: while the AI agents
// step is locked, a save carrying aiAgents is refused 400 AI_AGENTS_LOCKED.
// It is not stripped, the save is not reported as successful, and the
// project's revision does not move.

const created: Project[] = [];
test.afterEach(async ({ page }) => {
  const request = page.request;
  for (const p of created.splice(0)) {
    const r = await request.get(`/api/projects/${p.id}`);
    if (r.ok()) {
      const { project } = await r.json();
      await request.delete(`/api/projects/${p.id}?revision=${project.revision}`);
    }
  }
});

// Opening Atlas signs the local test user in (as navigation.spec does).
async function signedIn(page: Page) {
  await page.goto("/");
  return page.request;
}
async function create(request: Page["request"]) {
  const { id: _id, revision: _rev, ...example } = examples[0];
  void _id;
  void _rev;
  const r = await request.post("/api/projects", {
    data: { ...example, name: "Agents QA " + Date.now() },
  });
  expect(r.status(), await r.text()).toBeLessThan(300);
  const { project } = (await r.json()) as { project: Project };
  created.push(project);
  return project;
}

test("a PUT containing aiAgents is refused 400 AI_AGENTS_LOCKED and nothing is saved", async ({
  page,
}) => {
  const request = await signedIn(page);
  const project = await create(request);
  const bodies = [
    { ...project, aiAgents: [{ purpose: "triage" }] },
    { ...project, onboarding: { countryCode: "DE", aiAgents: [] } },
    {
      scope: "onboarding",
      baseRevision: project.revision,
      onboarding: { countryCode: "DE" },
      aiAgents: [{ purpose: "triage" }],
    },
    {
      scope: "onboarding",
      baseRevision: project.revision,
      onboarding: { countryCode: "DE", aiAgents: [] },
    },
  ];
  for (const data of bodies) {
    const r = await request.put(`/api/projects/${project.id}`, { data });
    expect(r.status(), JSON.stringify(data).slice(0, 200)).toBe(400);
    expect(await r.json()).toMatchObject({ code: "AI_AGENTS_LOCKED" });
  }
  const after = (await (await request.get(`/api/projects/${project.id}`)).json())
    .project as Project & { aiAgents?: unknown };
  expect(after.revision).toBe(project.revision);
  expect(after).not.toHaveProperty("aiAgents");
  expect(after.onboarding?.countryCode).toBe(project.onboarding?.countryCode);
  // The same save without aiAgents still succeeds.
  const ok = await request.put(`/api/projects/${project.id}`, {
    data: { ...project },
  });
  expect(ok.status(), await ok.text()).toBe(200);
});

test("a new project carrying aiAgents is refused too", async ({ page }) => {
  const request = await signedIn(page);
  const { id: _id, revision: _rev, ...example } = examples[0];
  void _id;
  void _rev;
  const r = await request.post("/api/projects", {
    data: { ...example, name: "Agents QA new", aiAgents: [] },
  });
  expect(r.status()).toBe(400);
  expect(await r.json()).toMatchObject({ code: "AI_AGENTS_LOCKED" });
});
