import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  unlinkedProjects,
  projectRefKey,
  type ImportCandidate,
} from "../lib/flightdeck/bridge";
import { type Project, examples, projectSchema } from "../lib/projects";
import { onboardingTasks, opportunities } from "../lib/opportunities";
import { osWorkspacesResponseSchema } from "../lib/flightdeck/context";
import {
  createCachedReader,
  createContextClient,
  createGuardedSubmissions,
  createSubmissionClient,
  type ContextReader,
  type ReadSubmissionResult,
  type SubmitResult,
} from "../lib/flightdeck/context-client";
import {
  NEVER_SENT,
  ONBOARDING_SUMMARY,
  REVIEW_FIELDS,
  buildOnboardingPayload,
  checklistSuggestions,
  onboardingEnvelope,
  onboardingSchema,
  onboardingStatusSchema,
  payloadLeafPaths,
  personalDataHint,
  projectOnboardingPayloadSchema,
  readiness,
  reviewRows,
  type OnboardingEnvelope,
  type OnboardingStatus,
} from "../lib/flightdeck/onboarding";
import {
  createOnboardRoute,
  type OnboardDb,
} from "../lib/flightdeck/onboard-route";

// Nothing in this file contacts FlightDeck OS. The OS side of the
// project-onboarding kind (W1) is not deployed yet, so its responses come from
// a fixture recorded from the contract, the route handlers run over a fake OS
// and a SQLite database built from the real migration 0004, and browser calls
// to Atlas's FlightDeck routes are answered with page.route.
const os = JSON.parse(
  readFileSync(
    new URL("./fixtures/os-project-onboarding.json", import.meta.url),
    "utf8",
  ),
);
const ATLAS_ID = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const KEY = "0b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d";
const HASH = createHash("sha256").update("user-1").digest("hex");
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FAKE_CREDENTIAL = "fake-credential-for-tests-0123456789";
const config = { baseUrl: "http://127.0.0.1:4173", token: FAKE_CREDENTIAL };
const readBack = (name: string) => ({
  ...os.readBack.base,
  subject: `atlas-${ATLAS_ID}`,
  ...os.readBack[name],
});
const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
const fromFixture = (entry: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}) => jsonResponse(entry.status, entry.body, entry.headers);

/** An Atlas project full of things that must never leave Atlas. */
function readyProject(overrides: Partial<Project> = {}): Project {
  return {
    ...examples[0],
    id: ATLAS_ID,
    name: "Payroll rollout",
    description: "Move payroll approvals into one reviewed flow.",
    benefit: "Approval time halves within a quarter.",
    functionArea: "HR",
    category: "Consultancy pilot",
    location: "Munich, Germany",
    dueDate: "2026-12-01",
    priority: "High",
    status: "In progress",
    sponsor: "Dana Sponsor",
    nextAction: "Call Dana",
    blocker: "Waiting on Olivia",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: {
      label: "Payroll rollout",
      workspaceHint: "Hint Workspace te-ops",
    },
    onboarding: {
      proposedProjectId: "payroll-rollout",
      countryCode: "DE",
      worksCouncilRelevant: "unknown",
      legalEntity: "TE Connectivity Germany GmbH",
      headcountBand: "250+",
      ownerRoles: {
        process: "Payroll process owner",
        data: "HR data steward",
        support: "HR service desk",
      },
      dataSources: ["SAP HCM"],
      accessRequested: [{ system: "SAP HCM", level: "read" }],
      coworkRequested: true,
    },
    objectives: [
      {
        id: "o1",
        title: "Faster approvals",
        description: "Owned by Olivia",
        owner: "Olivia Owner",
        dueDate: "",
        status: "Planned",
      },
    ],
    tasks: [
      {
        id: "t1",
        title: "Confirm the sponsor, process owner, and current baseline",
        done: true,
        assignee: "Alex Assignee",
        assigneeEmail: "alex@example.com",
        timeEntries: [
          {
            id: "e1",
            date: "2026-09-01",
            minutes: 30,
            note: "Kickoff call with Alex",
            author: "alex@example.com",
          },
        ],
        checklist: [{ id: "c1", title: "Secret checklist item", done: false }],
      },
      {
        id: "t2",
        title: "Map approved data sources and minimum access",
        done: false,
      },
      { id: "t3", title: "Archived task", done: false, archived: true },
    ],
    revision: 7,
    ...overrides,
  };
}
const payloadFor = (project = readyProject(), destination = "hr-de") =>
  buildOnboardingPayload({
    project,
    destinationWorkspaceId: destination,
    idempotencyKey: KEY,
    installationId: "atlas-test",
    requestedBy: HASH,
  });

test("OS discovery excludes confirmed and denied projects without collapsing identities", () => {
  const ref = { instanceId: "os-a", workspaceId: "ops", projectId: "one" };
  const c: ImportCandidate = {
    ref,
    name: "Same label",
    workspaceName: "Operations",
    canImport: true,
  };
  const other = { ...c, ref: { ...ref, projectId: "two" } };
  expect(
    unlinkedProjects(
      [
        c,
        other,
        other,
        { ...c, ref: { ...ref, projectId: "denied" }, canImport: false },
      ],
      [ref],
      ref,
    ),
  ).toEqual([other]);
  expect(projectRefKey(ref)).not.toBe(
    projectRefKey({ ...ref, instanceId: "os-b" }),
  );
  expect(() =>
    unlinkedProjects(
      [{ ...c, ref: { ...ref, workspaceId: "wrong" } }],
      [],
      ref,
    ),
  ).toThrow("Unexpected FlightDeck context");
});

test("the onboarding payload is the §3 allowlist only: key snapshot, no sponsor, assignee or email", () => {
  const payload = payloadFor();
  expect(payloadLeafPaths(payload)).toEqual([
    "atlasProjectId",
    "atlasRevision",
    "cowork.requested",
    "facts.accessRequested",
    "facts.countryCode",
    "facts.dataSources",
    "facts.headcountBand",
    "facts.legalEntity",
    "facts.ownerRoles.data",
    "facts.ownerRoles.process",
    "facts.ownerRoles.support",
    "facts.worksCouncilRelevant",
    "idempotencyKey",
    "installationId",
    "profile.category",
    "profile.functionArea",
    "profile.priority",
    "profile.site",
    "profile.status",
    "profile.successMeasure",
    "profile.summary",
    "profile.targetDate",
    "progress",
    "requestedBy",
    "schema",
    "target.label",
    "target.projectId",
    "target.workspaceId",
  ]);
  expect(payload).toEqual({
    schema: "atlas-project-onboarding/1",
    idempotencyKey: KEY,
    atlasProjectId: ATLAS_ID,
    atlasRevision: 7,
    installationId: "atlas-test",
    requestedBy: HASH,
    target: {
      workspaceId: "hr-de",
      label: "Payroll rollout",
      projectId: "payroll-rollout",
    },
    profile: {
      summary: "Move payroll approvals into one reviewed flow.",
      successMeasure: "Approval time halves within a quarter.",
      functionArea: "HR",
      category: "Consultancy pilot",
      status: "In progress",
      priority: "High",
      targetDate: "2026-12-01",
      site: "Munich, Germany",
    },
    facts: {
      countryCode: "DE",
      legalEntity: "TE Connectivity Germany GmbH",
      headcountBand: "250+",
      worksCouncilRelevant: "unknown",
      ownerRoles: {
        process: "Payroll process owner",
        data: "HR data steward",
        support: "HR service desk",
      },
      dataSources: ["SAP HCM"],
      accessRequested: [{ system: "SAP HCM", level: "read" }],
    },
    // Counts only: task titles, assignees and time entries stay in Atlas.
    progress: { done: 1, total: 2 },
    cowork: { requested: true },
  });
  expect(projectOnboardingPayloadSchema.parse(payload)).toEqual(payload);
  const sent = JSON.stringify(onboardingEnvelope(payload));
  for (const secret of [
    "Dana",
    "Sponsor",
    "Alex",
    "Olivia",
    "@",
    "example.com",
    "Secret checklist",
    "Kickoff",
    "Hint Workspace",
    "Confirm the sponsor",
    "Archived task",
    "Call Dana",
  ])
    expect(sent, secret).not.toContain(secret);
  expect(onboardingEnvelope(payload)).toEqual({
    kind: "project-onboarding",
    subject: `atlas-${ATLAS_ID}`,
    summary: ONBOARDING_SUMMARY,
    payload,
  });
  // Unknown keys fail the strict schema, at the top level and nested.
  for (const bad of [
    { ...payload, sponsor: "Dana Sponsor" },
    { ...payload, target: { ...payload.target, owners: ["dana"] } },
    { ...payload, facts: { ...payload.facts, assigneeEmail: "a@b.c" } },
  ])
    expect(projectOnboardingPayloadSchema.safeParse(bad).success).toBe(false);
  // The saved draft cannot hold a person either: its schema is strict too.
  expect(onboardingSchema.safeParse({ sponsor: "Dana" }).success).toBe(false);
  expect(
    projectSchema.safeParse({
      ...readyProject(),
      onboarding: { ownerRoles: { process: "x", email: "a@b.c" } },
    }).success,
  ).toBe(false);
  // A bare draft sends no optional keys and says progress is not tracked.
  const bare = payloadFor(
    readyProject({
      tasks: [],
      priority: undefined,
      dueDate: "",
      location: "",
      onboarding: { countryCode: "DK", worksCouncilRelevant: "no" },
    }),
  );
  expect(bare.facts).toEqual({
    countryCode: "DK",
    worksCouncilRelevant: "no",
    ownerRoles: {},
    dataSources: [],
    accessRequested: [],
  });
  expect(bare.progress).toBeNull();
  expect(bare.cowork).toEqual({ requested: false });
  expect(Object.keys(bare.target)).toEqual(["workspaceId", "label"]);
  expect(Object.keys(bare.profile).sort()).toEqual([
    "category",
    "functionArea",
    "status",
    "successMeasure",
    "summary",
  ]);
});

test("Review & send covers every payload field and the meter counts nine required items", () => {
  const payload = payloadFor();
  const rows = reviewRows(payload, { preview: false });
  expect(rows.map((r) => r.path).sort()).toEqual(payloadLeafPaths(payload));
  expect(
    payloadLeafPaths(payload).every((p) =>
      REVIEW_FIELDS.some((f) => f.path === p),
    ),
  ).toBe(true);
  expect(rows.find((r) => r.path === "progress")?.value).toBe(
    "1 of 2 tasks done",
  );
  expect(
    reviewRows(payloadFor(readyProject({ tasks: [] }))).find(
      (r) => r.path === "progress",
    )?.value,
  ).toBe("Progress not tracked");
  expect(rows.find((r) => r.path === "requestedBy")?.value).not.toContain(HASH);
  expect(NEVER_SENT).toEqual(
    expect.arrayContaining([
      "Sponsor",
      "Task assignees and their emails",
      "Time entries",
      "Goal owners",
      "Budget",
      "Task and checklist titles",
    ]),
  );
  const ready = readiness(readyProject(), null);
  expect([ready.done, ready.total, ready.ready]).toEqual([8, 9, false]);
  expect(ready.items.filter((i) => !i.done).map((i) => i.key)).toEqual([
    "destination",
  ]);
  expect(readiness(readyProject(), "hr-de").ready).toBe(true);
  const bare = readiness(
    readyProject({
      onboarding: undefined,
      onboardingStage: "Pilot",
      functionArea: undefined,
    }),
    "hr-de",
  );
  expect(bare.items.filter((i) => !i.done).map((i) => i.key)).toEqual([
    "functionArea",
    "countryCode",
    "worksCouncilRelevant",
    "ready",
  ]);
  // Free text is checked for the obvious personal details before sending.
  expect(personalDataHint("Ask dana@example.com")).toMatch(/email/i);
  expect(personalDataHint("Call +49 89 1234 5678")).toMatch(/phone/i);
  expect(personalDataHint("Due 2026-09-22, 3 sites, 250 people")).toBeNull();
});

test("checklist items prefill role titles and pilot facts, never their own titles", () => {
  // A consultancy pilot: its checklist says which fields it informs.
  const idea = opportunities.find((o) => o.id === "hr-onboarding")!;
  const pilot = readyProject({
    functionArea: undefined,
    benefit: "",
    description: "",
    onboarding: {},
    tasks: onboardingTasks(idea),
  });
  const suggestions = checklistSuggestions(pilot);
  expect(suggestions.map((s) => [s.field, s.value])).toEqual([
    ["functionArea", "HR"],
    ["summary", idea.pilot],
    ["successMeasure", idea.measure],
    ["ownerRoles.process", "Process owner"],
    ["ownerRoles.data", "Data owner"],
    ["ownerRoles.support", "Support owner"],
  ]);
  for (const s of suggestions) expect(s.source.length).toBeGreaterThan(0);
  // Filled fields are left alone.
  expect(checklistSuggestions(readyProject())).toEqual([]);
});

test("submit() POSTs the envelope with only the bearer credential and never X-Workspace-Id", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: () => Response | Promise<Response> = () =>
    fromFixture(os.submit.accepted);
  const client = createSubmissionClient(config, {
    fetch: async (url, init) => {
      seen.push({ url, init });
      return reply();
    },
    timeoutMs: 50,
  });
  const envelope = onboardingEnvelope(payloadFor());
  expect(await client.submit(envelope)).toEqual({
    state: "ok",
    data: {
      submissionId: os.submissionId,
      receivedAt: os.receivedAt,
      payloadSha256: os.payloadSha256,
      duplicate: false,
    },
  });
  expect(seen).toHaveLength(1);
  expect(seen[0].url).toBe("http://127.0.0.1:4173/api/inbound/v1/submissions");
  expect(seen[0].init).toMatchObject({
    method: "POST",
    cache: "no-store",
    redirect: "manual",
  });
  expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  expect(seen[0].init.headers).toEqual({
    Authorization: `Bearer ${FAKE_CREDENTIAL}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  expect(
    Object.keys(seen[0].init.headers as object).map((k) => k.toLowerCase()),
  ).not.toContain("x-workspace-id");
  expect(Object.keys(seen[0].init)).not.toContain("credentials");
  expect(JSON.parse(String(seen[0].init.body))).toEqual(envelope);

  const outcome = async (make: () => Response | Promise<Response>) => {
    reply = make;
    return client.submit(envelope);
  };
  expect(await outcome(() => fromFixture(os.submit.duplicate))).toEqual({
    state: "ok",
    data: {
      submissionId: os.submissionId,
      receivedAt: null,
      payloadSha256: null,
      duplicate: true,
    },
  });
  expect(await outcome(() => fromFixture(os.submit.alreadySubmitted))).toEqual({
    state: "already_submitted",
    submissionId: os.submissionId,
    osState: "filed",
  });
  expect(await outcome(() => fromFixture(os.submit.invalid))).toEqual({
    state: "invalid_submission",
  });
  expect(await outcome(() => fromFixture(os.submit.scopeMissing))).toEqual({
    state: "refused",
  });
  expect(await outcome(() => fromFixture(os.submit.unauthorized))).toEqual({
    state: "unauthorized",
  });
  expect(await outcome(() => fromFixture(os.submit.rateLimited))).toEqual({
    state: "rate_limited",
    retryAfter: 12,
  });
  expect(await outcome(() => jsonResponse(500, {}))).toEqual({
    state: "invalid_response",
  });
  expect(
    await outcome(() =>
      jsonResponse(202, { ...os.submit.accepted.body, submissionId: "../x" }),
    ),
  ).toEqual({ state: "invalid_response" });
  expect(
    await outcome(() => {
      throw new TypeError("connect ECONNREFUSED");
    }),
  ).toEqual({ state: "os_unreachable" });
  // A reply that never arrives is a lost response, not a refusal.
  const hung = createSubmissionClient(config, {
    timeoutMs: 50,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      ),
  });
  expect(await hung.submit(envelope)).toEqual({ state: "os_unreachable" });
  // An envelope outside the strict schema is never sent at all.
  const before = seen.length;
  expect(
    await client.submit({
      ...envelope,
      payload: { ...envelope.payload, sponsor: "Dana" },
    } as unknown as OnboardingEnvelope),
  ).toEqual({ state: "invalid_submission" });
  expect(
    await client.submit({ ...envelope, subject: "atlas-someone-else" }),
  ).toEqual({ state: "invalid_submission" });
  expect(seen).toHaveLength(before);
});

test("readSubmission() reads back only this submission, maps each OS state and drops reviewer identity", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let reply: () => Response = () => jsonResponse(200, readBack("filed"));
  const client = createSubmissionClient(config, {
    fetch: async (url, init) => {
      seen.push({ url, init });
      return reply();
    },
  });
  const read = async (make: () => Response, id = os.submissionId) => {
    reply = make;
    return client.readSubmission(id);
  };
  expect(await read(() => jsonResponse(200, readBack("filed")))).toEqual({
    state: "ok",
    data: {
      submissionId: os.submissionId,
      kind: "project-onboarding",
      subject: `atlas-${ATLAS_ID}`,
      receivedAt: os.receivedAt,
      payloadSha256: os.payloadSha256,
      state: "filed",
      promoted: null,
      reasonCode: null,
    },
  });
  expect(seen[0].url).toBe(
    `http://127.0.0.1:4173/api/inbound/v1/submissions/${os.submissionId}`,
  );
  expect(seen[0].init.method).toBe("GET");
  expect(seen[0].init.headers).toEqual({
    Authorization: `Bearer ${FAKE_CREDENTIAL}`,
    Accept: "application/json",
  });
  const promoted = await read(() =>
    jsonResponse(200, {
      ...readBack("promoted"),
      outcome: { ...os.readBack.promoted.outcome, by: "reviewer-jane" },
      reviewedBy: "reviewer-jane",
    }),
  );
  expect(promoted).toMatchObject({
    state: "ok",
    data: {
      state: "promoted",
      promoted: {
        workspaceId: "hr-de",
        projectId: "payroll-rollout",
        setupState: "none",
      },
    },
  });
  expect(JSON.stringify(promoted)).not.toContain("reviewer-jane");
  expect(
    await read(() => jsonResponse(200, readBack("promotedNotShared"))),
  ).toMatchObject({ state: "ok", data: { state: "promoted", promoted: null } });
  expect(
    await read(() => jsonResponse(200, readBack("needsMoreInfo"))),
  ).toMatchObject({
    state: "ok",
    data: { state: "rejected", reasonCode: "needs-more-info" },
  });
  expect(
    await read(() =>
      jsonResponse(os.readBack.notFound.status, os.readBack.notFound.body),
    ),
  ).toEqual({ state: "not_found" });
  // Another submission's body, a route the OS does not have, or a malformed
  // id never count as this submission.
  expect(
    await read(() =>
      jsonResponse(200, {
        ...readBack("filed"),
        submissionId: os.otherSubmissionId,
      }),
    ),
  ).toEqual({ state: "invalid_response" });
  expect(
    await read(() => jsonResponse(404, { message: "Route not found" })),
  ).toEqual({ state: "invalid_response" });
  const calls = seen.length;
  expect(await read(() => jsonResponse(200, {}), "../../admin")).toEqual({
    state: "not_found",
  });
  expect(seen).toHaveLength(calls);
});

test("one rate limit covers the whole credential: context reads, submits and read-backs", async () => {
  let clock = 0;
  const cache = new Map();
  const limited: ContextReader = {
    workspaces: async () => ({ state: "rate_limited", retryAfter: 20 }),
    projects: async () => ({ state: "rate_limited", retryAfter: 20 }),
  };
  await createCachedReader(limited, cache, { now: () => clock }).workspaces();
  const calls: string[] = [];
  const submissions = createGuardedSubmissions(
    {
      async submit() {
        calls.push("submit");
        return { state: "ok", data: {} } as SubmitResult;
      },
      async readSubmission() {
        calls.push("read");
        return { state: "not_found" } as ReadSubmissionResult;
      },
    },
    cache,
    { now: () => clock },
  );
  clock = 5_000;
  expect(await submissions.submit(onboardingEnvelope(payloadFor()))).toEqual({
    state: "rate_limited",
    retryAfter: 15,
  });
  expect(await submissions.readSubmission(os.submissionId)).toEqual({
    state: "rate_limited",
    retryAfter: 15,
  });
  expect(calls).toEqual([]);
  clock = 21_000;
  expect((await submissions.readSubmission(os.submissionId)).state).toBe(
    "not_found",
  );
  expect(calls).toEqual(["read"]);
});

test("read:context accepts the new OS instanceId first and still rejects any other new key", async () => {
  const { instanceId, ...without } = os.context.workspaces;
  expect(instanceId).toBe(os.context.instanceId);
  expect(
    osWorkspacesResponseSchema.safeParse(os.context.workspaces).success,
  ).toBe(true);
  expect(osWorkspacesResponseSchema.safeParse(without).success).toBe(true);
  for (const bad of [
    { ...os.context.workspaces, root: "/srv/te-ops" },
    { ...os.context.workspaces, instanceId: "../etc" },
    { ...os.context.workspaces, instanceId: "" },
  ])
    expect(osWorkspacesResponseSchema.safeParse(bad).success).toBe(false);
  const client = createContextClient(config, {
    fetch: async () => jsonResponse(200, os.context.workspaces),
  });
  expect(await client.workspaces()).toMatchObject({
    state: "ok",
    data: { instanceId: os.context.instanceId },
  });
});

// ── The /api/flightdeck/onboard handlers over a fake OS and real SQL ───────

const ORIGIN = "http://localhost:5173";
const onboardUrl = (query = "") =>
  `${ORIGIN}/api/flightdeck/onboard/${ATLAS_ID}${query}`;
const send = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(onboardUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const statusRequest = (refresh = true) =>
  new Request(onboardUrl(refresh ? "?refresh=1" : ""), {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
const sendTo = (destinationWorkspaceId: string, revision = 7) =>
  send({ destinationWorkspaceId, revision });

/** A D1-shaped adapter over node:sqlite with the real migration 0004. */
function onboardDb() {
  const migration = readFileSync(
    new URL("../drizzle/0004_silly_speedball.sql", import.meta.url),
    "utf8",
  );
  const sqlite = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint"))
    sqlite.exec(statement);
  const db: OnboardDb = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          const args = values as SQLInputValue[];
          return {
            async first<T>() {
              return (statement.get(...args) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: statement.all(...args) as T[] };
            },
            async run() {
              return {
                meta: { changes: Number(statement.run(...args).changes) },
              };
            },
          };
        },
      };
    },
  };
  const ops = () =>
    sqlite
      .prepare("SELECT * FROM atlas_flightdeck_operations ORDER BY rowid")
      .all() as Record<string, unknown>[];
  const links = () =>
    sqlite.prepare("SELECT * FROM atlas_project_links").all() as Record<
      string,
      unknown
    >[];
  return { db, sqlite, ops, links };
}

function harness(
  options: { superAdmin?: boolean; project?: Project | null } = {},
) {
  const store = onboardDb();
  let clock = Date.parse("2026-09-22T09:00:00.000Z");
  const project =
    options.project === undefined ? readyProject() : options.project;
  const fake = {
    workspaces: structuredClone(os.context.workspaces) as Record<
      string,
      unknown
    >,
    projects: {
      "te-ops": {
        workspaceId: "te-ops",
        projects: [
          { id: "general", label: "General", enabled: true, isDefault: true },
        ],
        generatedAt: os.receivedAt,
      },
      "hr-de": structuredClone(os.context.projectsBeforePromotion),
    } as unknown as Record<string, { projects: Record<string, unknown>[] }>,
    calls: [] as string[],
    submits: [] as OnboardingEnvelope[],
    authorize: 0,
    onSubmit: (async (): Promise<SubmitResult> => ({
      state: "ok",
      data: {
        submissionId: os.submissionId,
        receivedAt: os.receivedAt,
        payloadSha256: os.payloadSha256,
        duplicate: false,
      },
    })) as (envelope: OnboardingEnvelope) => Promise<SubmitResult>,
    onRead: (async (): Promise<ReadSubmissionResult> => ({
      state: "ok",
      data: {
        submissionId: os.submissionId,
        kind: "project-onboarding",
        subject: `atlas-${ATLAS_ID}`,
        receivedAt: os.receivedAt,
        payloadSha256: os.payloadSha256,
        state: "filed",
        promoted: null,
        reasonCode: null,
      },
    })) as (id: string) => Promise<ReadSubmissionResult>,
  };
  const reader = (fresh: boolean): ContextReader => ({
    async workspaces() {
      fake.calls.push(fresh ? "workspaces:fresh" : "workspaces");
      const parsed = osWorkspacesResponseSchema.parse(fake.workspaces);
      return { state: "ok", data: parsed };
    },
    async projects(id) {
      fake.calls.push(`projects:${id}`);
      const list = fake.projects[id];
      if (!list) return { state: "workspace_not_found" };
      return {
        state: "ok",
        data: {
          workspaceId: id,
          projects: list.projects as never,
          generatedAt: os.receivedAt,
        },
      };
    },
  });
  const route = createOnboardRoute({
    async authorize() {
      fake.authorize++;
      return {
        access: { userId: "user-1", superAdmin: options.superAdmin ?? true },
      };
    },
    async loadProject(_access, id) {
      return project && id === project.id ? { project, canEdit: true } : null;
    },
    async visibleProjectIds() {
      return project ? [project.id] : [];
    },
    reader,
    submissions: () => ({
      async submit(envelope) {
        fake.calls.push("submit");
        fake.submits.push(envelope);
        return fake.onSubmit(envelope);
      },
      async readSubmission(id) {
        fake.calls.push(`read:${id}`);
        return fake.onRead(id);
      },
    }),
    db: () => store.db,
    installationId: () => "atlas-test",
    now: () => new Date(clock),
  });
  const readAs = (name: string) => async (): Promise<ReadSubmissionResult> => {
    const body = readBack(name);
    return {
      state: "ok",
      data: {
        submissionId: body.submissionId,
        kind: body.kind,
        subject: body.subject,
        receivedAt: body.receivedAt,
        payloadSha256: body.payloadSha256,
        state: body.state,
        promoted: body.state === "promoted" ? (body.outcome ?? null) : null,
        reasonCode: body.state === "rejected" ? body.outcome.reasonCode : null,
      },
    };
  };
  return {
    route,
    store,
    fake,
    readAs,
    tick: (ms: number) => void (clock += ms),
    async status(refresh = true) {
      const response = await route.GET(statusRequest(refresh), ATLAS_ID);
      expect(response.status).toBe(200);
      return onboardingStatusSchema.parse(await response.json());
    },
  };
}

test("only the Atlas Super Admin may send; anyone else gets 403 before any OS call or reservation", async () => {
  const member = harness({ superAdmin: false });
  const refused = await member.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "not_permitted" });
  expect(member.fake.calls).toEqual([]);
  expect(member.store.ops()).toEqual([]);
  // A member may read the stored status, never with OS ids and never by
  // reading the OS, even when asking for a refresh.
  const view = await member.status(true);
  expect(view).toMatchObject({ operation: null, link: null });
  expect(member.fake.calls).toEqual([]);

  // Cross-site writes are refused before authorisation.
  const admin = harness();
  const crossSite: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    { Origin: "", "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of crossSite) {
    const response = await admin.route.POST(
      send({ destinationWorkspaceId: "hr-de", revision: 7 }, headers),
      ATLAS_ID,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Request origin is not allowed.",
    });
  }
  expect(admin.fake.authorize).toBe(0);
  expect(admin.fake.calls).toEqual([]);
});

test("a send reserves its row with a fresh key before the remote call, then stores the OS receipt", async () => {
  const h = harness();
  let reservedAtCall: Record<string, unknown>[] = [];
  h.fake.onSubmit = async (envelope) => {
    reservedAtCall = h.store.ops();
    expect(reservedAtCall).toHaveLength(1);
    expect(reservedAtCall[0]).toMatchObject({
      state: "reserved",
      idempotency_key: envelope.payload.idempotencyKey,
      atlas_project_id: ATLAS_ID,
      atlas_revision: 7,
      destination_workspace_id: "hr-de",
      proposed_label: "Payroll rollout",
      proposed_project_id: "payroll-rollout",
      created_by: "user-1",
      submission_id: null,
    });
    return {
      state: "ok",
      data: {
        submissionId: os.submissionId,
        receivedAt: os.receivedAt,
        payloadSha256: os.payloadSha256,
        duplicate: false,
      },
    };
  };
  const response = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(response.status).toBe(202);
  expect(reservedAtCall).toHaveLength(1);
  const status = onboardingStatusSchema.parse(await response.json());
  expect(status.operation).toMatchObject({
    state: "filed",
    stage: "submitted",
    destinationWorkspaceId: "hr-de",
    submittedAt: os.receivedAt,
  });
  expect(status.pollable).toBe(true);
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      state: "filed",
      submission_id: os.submissionId,
      received_at: os.receivedAt,
      payload_sha256: os.payloadSha256,
    }),
  ]);
  // Exactly the allowlist built from the stored project, a v4 key and a
  // hashed requester. The route sent no header of its own: the transport
  // test above pins the header set.
  const [envelope] = h.fake.submits;
  expect(envelope.payload.idempotencyKey).toMatch(UUID_RE);
  expect(envelope.payload.requestedBy).toBe(HASH);
  expect(envelope).toEqual(
    onboardingEnvelope(
      buildOnboardingPayload({
        project: readyProject(),
        destinationWorkspaceId: "hr-de",
        idempotencyKey: envelope.payload.idempotencyKey,
        installationId: "atlas-test",
        requestedBy: HASH,
      }),
    ),
  );
  // A second press while FlightDeck holds the request sends nothing.
  const again = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ code: "already_submitted" });
  expect(h.fake.submits).toHaveLength(1);
});

test("a lost response keeps the reservation, and the retry reuses the same key and destination", async () => {
  const h = harness();
  // FlightDeck filed it, but the reply never reached Atlas.
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  const first = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(first.status).toBe(503);
  const refusal = (await first.json()) as { status: unknown };
  expect(refusal).toMatchObject({ code: "not_confirmed" });
  expect(onboardingStatusSchema.parse(refusal.status).operation?.stage).toBe(
    "not-confirmed",
  );
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      state: "reserved",
      reason_code: "os_unreachable",
    }),
  ]);
  const pending = await h.status(false);
  expect(pending).toMatchObject({ retryPending: true, canSend: true });
  expect(pending.operation?.destinationWorkspaceId).toBe("hr-de");
  // The key belongs to that destination: another one is refused, unsent.
  const moved = await h.route.POST(sendTo("te-ops"), ATLAS_ID);
  expect(moved.status).toBe(409);
  expect(await moved.json()).toMatchObject({
    code: "pending_send",
    destinationWorkspaceId: "hr-de",
  });
  expect(h.fake.submits).toHaveLength(1);
  // The retry: same key, FlightDeck answers with its duplicate receipt.
  h.fake.onSubmit = async () => ({
    state: "ok",
    data: {
      submissionId: os.submissionId,
      receivedAt: null,
      payloadSha256: null,
      duplicate: true,
    },
  });
  const retry = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(retry.status).toBe(202);
  expect(h.fake.submits).toHaveLength(2);
  expect(h.fake.submits[1].payload.idempotencyKey).toBe(
    h.fake.submits[0].payload.idempotencyKey,
  );
  const [op] = h.store.ops();
  expect(h.store.ops()).toHaveLength(1);
  expect(op).toMatchObject({
    state: "filed",
    submission_id: os.submissionId,
    idempotency_key: h.fake.submits[0].payload.idempotencyKey,
  });
  // The first read-back fills in the receipt a duplicate reply lacks.
  h.tick(61_000);
  await h.status();
  expect(h.store.ops()[0]).toMatchObject({
    received_at: os.receivedAt,
    payload_sha256: os.payloadSha256,
  });
});

test("the destination comes from this dialog and is re-checked with chooseContext, never from preferences or the hint", async () => {
  // The project's planning note names te-ops, and the harness has no
  // preference store at all: only the request body can name a destination.
  const h = harness();
  h.fake.onSubmit = async (envelope) => {
    expect(h.fake.calls.slice(0, 2)).toEqual([
      "workspaces:fresh",
      "projects:hr-de",
    ]);
    expect(envelope.payload.target.workspaceId).toBe("hr-de");
    return {
      state: "ok",
      data: {
        submissionId: os.submissionId,
        receivedAt: os.receivedAt,
        payloadSha256: os.payloadSha256,
        duplicate: false,
      },
    };
  };
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(h.store.ops()[0].destination_workspace_id).toBe("hr-de");

  for (const [destination, status, code] of [
    ["gone", 404, "workspace_not_found"],
    ["archive", 409, "workspace_disabled"],
  ] as const) {
    const other = harness();
    const response = await other.route.POST(sendTo(destination), ATLAS_ID);
    expect(response.status, destination).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(other.store.ops()).toEqual([]);
    expect(other.fake.submits).toEqual([]);
  }
  const bad = harness();
  for (const body of [
    { revision: 7 },
    { destinationWorkspaceId: "hr-de", revision: 7, workspaceHint: "te-ops" },
    { destinationWorkspaceId: "../etc", revision: 7 },
  ])
    expect((await bad.route.POST(send(body), ATLAS_ID)).status).toBe(400);
  const stale = await bad.route.POST(sendTo("hr-de", 6), ATLAS_ID);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "project_changed" });
  expect(bad.fake.calls).toEqual([]);
  // An unfinished draft is refused with the missing items, unsent.
  const draft = harness({
    project: readyProject({ onboarding: {}, onboardingStage: "Pilot" }),
  });
  const notReady = await draft.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(notReady.status).toBe(400);
  expect(await notReady.json()).toMatchObject({
    code: "not_ready",
    missing: ["countryCode", "worksCouncilRelevant", "ready"],
  });
  expect(draft.fake.calls).toEqual([]);
  expect(draft.store.ops()).toEqual([]);
});

test("Linked appears only after read:context confirms the promoted project, then setup advances", async () => {
  const h = harness();
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  h.fake.onRead = h.readAs("promoted");
  // Too soon: the first read-back waits a minute after the send.
  h.fake.calls.length = 0;
  expect((await h.status()).operation?.stage).toBe("submitted");
  expect(h.fake.calls).toEqual([]);
  h.tick(61_000);
  const accepted = await h.status();
  expect(accepted.operation).toMatchObject({
    state: "promoted",
    stage: "submitted",
    reasonCode: "project_not_visible",
  });
  expect(accepted.link).toBeNull();
  expect(h.store.links()).toEqual([]);
  expect(h.fake.calls).toEqual([
    `read:${os.submissionId}`,
    "workspaces:fresh",
    "projects:hr-de",
  ]);
  // Within the minute nothing is read again, however often the page asks.
  h.fake.calls.length = 0;
  await h.status();
  await h.status();
  expect(h.fake.calls).toEqual([]);
  // Once read:context lists the project, the link is written, then shown.
  h.fake.projects["hr-de"] = structuredClone(os.context.projectsAfterPromotion);
  h.tick(61_000);
  const linked = await h.status();
  expect(linked.operation).toMatchObject({ state: "linked", stage: "linked" });
  expect(linked.link).toMatchObject({
    workspaceId: "hr-de",
    osProjectId: "payroll-rollout",
    accessState: "active",
  });
  expect(h.store.links()).toEqual([
    {
      installation_id: "atlas-test",
      os_instance_id: os.context.instanceId,
      workspace_id: "hr-de",
      os_project_id: "payroll-rollout",
      atlas_project_id: ATLAS_ID,
      submission_id: os.submissionId,
      linked_at: expect.any(String),
      linked_by: "user-1",
      source_revision: 7,
      last_checked_at: expect.any(String),
      access_state: "active",
    },
  ]);
  h.fake.onRead = h.readAs("setupInProgress");
  h.tick(61_000);
  expect(await h.status()).toMatchObject({
    operation: { stage: "setup-in-progress", setupState: "awaiting-cowork" },
    pollable: true,
  });
  h.fake.onRead = h.readAs("setupComplete");
  h.tick(61_000);
  expect(await h.status()).toMatchObject({
    operation: { stage: "setup-complete" },
    pollable: false,
  });
  h.fake.calls.length = 0;
  h.tick(61_000);
  await h.status();
  expect(h.fake.calls).toEqual([]);
  expect(h.store.links()).toHaveLength(1);
});

test("no link without the OS instanceId, and never onto an OS project another Atlas project holds", async () => {
  const unknown = harness();
  await unknown.route.POST(sendTo("hr-de"), ATLAS_ID);
  unknown.fake.onRead = unknown.readAs("promoted");
  unknown.fake.projects["hr-de"] = structuredClone(
    os.context.projectsAfterPromotion,
  );
  delete unknown.fake.workspaces.instanceId;
  unknown.tick(61_000);
  const blind = await unknown.status();
  expect(blind.operation).toMatchObject({
    stage: "submitted",
    reasonCode: "instance_unknown",
  });
  expect(blind.notice).toMatch(/instance/i);
  expect(unknown.store.links()).toEqual([]);

  const taken = harness();
  taken.store.sqlite
    .prepare(
      "INSERT INTO atlas_project_links (installation_id,os_instance_id,workspace_id,os_project_id,atlas_project_id,submission_id,linked_at,linked_by,source_revision,last_checked_at,access_state) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "atlas-test",
      os.context.instanceId,
      "hr-de",
      "payroll-rollout",
      "11111111-2222-4333-8444-555555555555",
      null,
      os.receivedAt,
      "user-0",
      1,
      os.receivedAt,
      "active",
    );
  await taken.route.POST(sendTo("hr-de"), ATLAS_ID);
  taken.fake.onRead = taken.readAs("promoted");
  taken.fake.projects["hr-de"] = structuredClone(
    os.context.projectsAfterPromotion,
  );
  taken.tick(61_000);
  const conflict = await taken.status();
  expect(conflict.operation).toMatchObject({
    stage: "submitted",
    reasonCode: "link_conflict",
  });
  expect(conflict.link).toBeNull();
  expect(taken.store.links()).toHaveLength(1);
});

test("needs more info reopens the draft, and the next send uses a fresh key", async () => {
  const h = harness();
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  h.fake.onRead = h.readAs("needsMoreInfo");
  h.tick(61_000);
  const reopened = await h.status();
  expect(reopened).toMatchObject({
    operation: {
      state: "rejected",
      stage: "needs-more-info",
      reasonCode: "needs-more-info",
    },
    canSend: true,
    retryPending: false,
    pollable: false,
  });
  h.fake.onSubmit = async () => ({
    state: "ok",
    data: {
      submissionId: os.otherSubmissionId,
      receivedAt: os.receivedAt,
      payloadSha256: os.payloadSha256,
      duplicate: false,
    },
  });
  expect((await h.route.POST(sendTo("te-ops"), ATLAS_ID)).status).toBe(202);
  const [first, second] = h.store.ops();
  expect(first).toMatchObject({ state: "rejected" });
  expect(second).toMatchObject({
    state: "filed",
    submission_id: os.otherSubmissionId,
    destination_workspace_id: "te-ops",
  });
  expect(second.idempotency_key).not.toBe(first.idempotency_key);
  expect(h.fake.submits[1].payload.idempotencyKey).toBe(second.idempotency_key);
});

test("definitive OS refusals close the send; an OS subject lock is adopted only when it is this project's", async () => {
  const h = harness();
  h.fake.onSubmit = async () => ({ state: "refused" });
  const refused = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(refused.status).toBe(502);
  expect(await refused.json()).toMatchObject({ code: "refused" });
  expect(h.store.ops()[0]).toMatchObject({
    state: "refused",
    reason_code: "refused",
  });
  expect((await h.status(false)).operation?.stage).toBe("not-sent");

  // FlightDeck already holds a request for this subject: adopt it once the
  // read-back proves it is this project's, without sending again.
  h.fake.onSubmit = async () => ({
    state: "already_submitted",
    submissionId: os.submissionId,
    osState: "filed",
  });
  const adopted = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(adopted.status).toBe(202);
  expect(h.store.ops()[1]).toMatchObject({
    state: "filed",
    submission_id: os.submissionId,
    received_at: os.receivedAt,
  });
  expect(h.store.ops()[1].idempotency_key).not.toBe(
    h.store.ops()[0].idempotency_key,
  );

  const stranger = harness();
  stranger.fake.onSubmit = async () => ({
    state: "already_submitted",
    submissionId: os.otherSubmissionId,
    osState: "filed",
  });
  stranger.fake.onRead = async () => {
    const r = await stranger.readAs("filed")();
    return r.state === "ok"
      ? {
          ...r,
          data: {
            ...r.data,
            submissionId: os.otherSubmissionId,
            subject: "atlas-11111111-2222-4333-8444-555555555555",
          },
        }
      : r;
  };
  const clash = await stranger.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(clash.status).toBe(409);
  expect(await clash.json()).toMatchObject({ code: "already_submitted" });
  expect(stranger.store.ops()[0]).toMatchObject({
    state: "refused",
    submission_id: null,
  });
});

test("the stage list returns stored states for visible projects without reading the OS", async () => {
  const h = harness();
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  h.fake.calls.length = 0;
  const response = await h.route.LIST();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    stages: { [ATLAS_ID]: "submitted" },
  });
  expect(h.fake.calls).toEqual([]);
});

// ── Browser: the To FlightDeck form over the running Atlas ────────────────

async function createProject(page: Page, fields: Partial<Project>) {
  return page.evaluate(
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
}
async function removeProject(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const body = (await (await fetch("/api/projects")).json()) as {
      projects: Project[];
    };
    const p = body.projects.find((p: { id: string }) => p.id === id);
    if (p)
      await fetch(`/api/projects/${id}?revision=${p.revision}`, {
        method: "DELETE",
      });
  }, id);
}
/** Answers the sidebar and Review's destination list with the fixture. */
async function mockContext(page: Page) {
  await page.route("**/api/flightdeck/context", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "ok",
        workspaces: os.context.workspaces.workspaces,
        projects: os.context.projectsBeforePromotion.projects,
        selected: { osWorkspaceId: "te-ops", osProjectId: "general" },
        projectFallback: false,
        retryAfter: null,
        checkedAt: new Date().toISOString(),
      }),
    }),
  );
}
function statusBody(
  stage: NonNullable<OnboardingStatus["operation"]>["stage"] | null,
  extra: Partial<OnboardingStatus> = {},
): OnboardingStatus {
  const state = {
    "not-confirmed": "reserved",
    submitted: "filed",
    linked: "linked",
    "setup-in-progress": "linked",
    "setup-complete": "linked",
    "needs-more-info": "rejected",
    rejected: "rejected",
    "not-sent": "refused",
  } as const;
  return {
    operation: stage
      ? {
          state: state[stage],
          stage,
          destinationWorkspaceId: "hr-de",
          submittedAt: os.receivedAt,
          reasonCode: stage === "needs-more-info" ? "needs-more-info" : null,
          setupState: stage === "setup-in-progress" ? "awaiting-cowork" : null,
          atlasRevision: 2,
          updatedAt: os.receivedAt,
          checkedAt: null,
        }
      : null,
    link: null,
    canSend:
      !stage || ["needs-more-info", "rejected", "not-sent"].includes(stage),
    retryPending: false,
    pollable: stage === "submitted" || stage === "linked",
    notice: null,
    retryAfter: null,
    ...extra,
  };
}

test("onboarding drafts persist, export, and remove without creating an OS project", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/flightdeck/catalog")).status()).toBe(401);
  expect(
    (await request.post("/api/flightdeck/import", { data: {} })).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`/api/flightdeck/onboard/${ATLAS_ID}`, {
        data: { destinationWorkspaceId: "hr-de", revision: 1 },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/?view=connection");
  await expect(
    page.getByText("Import from FlightDeck:", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not enabled", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your OS project list will appear here",
    }),
  ).toBeVisible();
  const project = await createProject(page, { name: "Bridge QA" });
  try {
    await page.reload();
    await page.getByRole("button", { name: /To FlightDeck/ }).click();
    const row = page.locator("article.bridge-project", {
      hasText: "Bridge QA",
    });
    await row
      .getByRole("button", { name: "Prepare onboarding", exact: true })
      .click();
    await page.getByLabel("Proposed OS project name").fill("Operations pilot");
    await page
      .getByLabel("Preferred workspace (optional)")
      .fill("Operations Europe");
    await page.getByRole("button", { name: "Save onboarding draft" }).click();
    await expect(
      row.getByText("Draft prepared", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /To FlightDeck/ }).click();
    await expect(row.getByText(/Operations Europe/)).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await row.getByRole("button", { name: "Export draft" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe(
      `flightdeck-draft-${project.id}.md`,
    );
    // The real routes: onboarding status reads the local tables (migration
    // 0004), a malformed send is refused before FlightDeck is contacted, and
    // import stays disconnected. No response carries the credential.
    const responses = await page.evaluate(async (id) => {
      const status = await fetch(`/api/flightdeck/onboard/${id}`);
      const list = await fetch("/api/flightdeck/onboard");
      const onboard = await fetch(`/api/flightdeck/onboard/${id}`, {
        method: "POST",
      });
      const imported = await fetch("/api/flightdeck/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: { instanceId: "fake", workspaceId: "fake", projectId: "fake" },
        }),
      });
      return {
        status: status.status,
        statusBody: await status.text(),
        list: list.status,
        onboard: onboard.status,
        onboardBody: await onboard.text(),
        imported: imported.status,
      };
    }, project.id);
    expect(responses).toMatchObject({
      status: 200,
      list: 200,
      onboard: 415,
      imported: 503,
    });
    expect(
      onboardingStatusSchema.parse(JSON.parse(responses.statusBody)),
    ).toMatchObject({ operation: null, link: null });
    for (const text of [responses.statusBody, responses.onboardBody])
      expect(text).not.toMatch(/token|bearer|ATLAS_FLIGHTDECK|INBOUND/i);
    await row.getByRole("button", { name: "Remove draft" }).click();
    await expect(row.getByText("Not prepared", { exact: true })).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

test("the three-tab form prefills Basics, meters readiness, lists every field sent and follows the status", async ({
  page,
}) => {
  await page.clock.install();
  await mockContext(page);
  await page.goto("/?view=connection");
  const idea = opportunities.find((o) => o.id === "hr-onboarding")!;
  const project = await createProject(page, {
    name: "Onboarding QA",
    description: "Guide new HR users through approved tools.",
    benefit: "",
    functionArea: "HR",
    category: "Consultancy pilot",
    location: "Munich, Germany",
    dueDate: "2026-12-01",
    sponsor: "Dana Sponsor",
    onboardingStage: "Pilot",
    tasks: onboardingTasks(idea).map((t, i) =>
      i === 1 ? { ...t, assignee: "Alex Assignee" } : t,
    ),
  });
  const sent: unknown[] = [];
  let status = statusBody(null);
  await page.route(
    `**/api/flightdeck/onboard/${project.id}**`,
    async (route) => {
      const r = route.request();
      if (r.method() === "POST") {
        sent.push(r.postDataJSON());
        status = statusBody("submitted");
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify(status),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(status),
      });
    },
  );
  const refreshes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(`/api/flightdeck/onboard/${project.id}?refresh=1`))
      refreshes.push(r.url());
  });
  try {
    await page.reload();
    await page.getByRole("button", { name: /To FlightDeck/ }).click();
    const row = page.locator("article.bridge-project", {
      hasText: "Onboarding QA",
    });
    await row
      .getByRole("button", { name: "Prepare onboarding", exact: true })
      .click();
    const tabs = row.getByRole("tablist", { name: "FlightDeck onboarding" });
    await expect(tabs.getByRole("tab")).toHaveText([
      "Basics",
      "FlightDeck details",
      "Review & send",
    ]);
    await expect(tabs.getByRole("tab", { name: "Basics" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Basics is prefilled from the Atlas project.
    await expect(row.getByLabel("Proposed OS project name")).toHaveValue(
      "Onboarding QA",
    );
    await expect(row.getByLabel("Summary")).toHaveValue(
      "Guide new HR users through approved tools.",
    );
    await expect(row.getByLabel("Function area")).toHaveValue("HR");
    const meter = row.getByRole("meter", {
      name: "Required FlightDeck details",
    });
    // Label, function area, category and summary are prefilled.
    await expect(meter).toHaveAttribute("aria-valuetext", "4 of 9 required");
    // A missing item links straight to its field.
    await row
      .getByRole("list", { name: "Missing details" })
      .getByRole("button", { name: "Country" })
      .click();
    await expect(
      tabs.getByRole("tab", { name: "FlightDeck details" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(row.getByLabel("Country")).toBeFocused();
    // The checklist offers role titles and the pilot's success measure.
    await row
      .getByRole("button", { name: "Apply checklist suggestions" })
      .click();
    await expect(meter).toHaveAttribute("aria-valuetext", "5 of 9 required");
    await expect(row.getByLabel("Process owner role")).toHaveValue(
      "Process owner",
    );
    await expect(row.getByLabel("Support owner role")).toHaveValue(
      "Support owner",
    );
    await row.getByLabel("Country").selectOption("DE");
    await row.getByLabel("Works council relevant").selectOption("unknown");
    await row.getByLabel("Mark this project Ready for FlightDeck").check();
    await row.getByLabel("New data source").fill("SAP HCM");
    await row.getByRole("button", { name: "Add data source" }).click();
    await expect(meter).toHaveAttribute("aria-valuetext", "8 of 9 required");
    await row.getByRole("tab", { name: "Review & send" }).click();
    const sendButton = row.getByRole("button", { name: "Send to FlightDeck" });
    // Unsaved edits are never what gets sent.
    await expect(sendButton).toBeDisabled();
    await row.getByRole("button", { name: "Save onboarding draft" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Onboarding draft saved" }),
    ).toBeVisible();
    await row.getByLabel("Destination workspace").selectOption("hr-de");
    await expect(meter).toHaveAttribute("aria-valuetext", "9 of 9 required");
    // Every field the payload carries is listed, and nothing that is not.
    const review = row.getByRole("region", { name: "What will be sent" });
    const saved = await page.evaluate(
      async (id) =>
        (
          (await (await fetch(`/api/projects/${id}`)).json()) as {
            project: Project;
          }
        ).project,
      project.id,
    );
    for (const r of reviewRows(payloadFor(saved)))
      await expect(
        review.getByText(r.label, { exact: true }),
        r.path,
      ).toBeVisible();
    await expect(review).not.toContainText("Dana");
    await expect(review).not.toContainText("Alex");
    await expect(row.getByRole("list", { name: "Never sent" })).toContainText(
      "Sponsor",
    );
    await expect(sendButton).toBeEnabled();
    await sendButton.click();
    expect(sent).toEqual([
      { destinationWorkspaceId: "hr-de", revision: saved.revision },
    ]);
    const timeline = row.getByRole("list", { name: "FlightDeck status" });
    await expect(timeline.getByRole("listitem")).toHaveText([
      "Submitted",
      "Linked",
      "Setup in progress",
      "Setup complete",
    ]);
    await expect(timeline.locator('[aria-current="step"]')).toHaveText(
      "Submitted",
    );
    // The draft is locked while FlightDeck reviews it.
    await row.getByRole("tab", { name: "Basics" }).click();
    await expect(row.getByLabel("Summary")).toBeDisabled();
    // Polled at most once a minute.
    const before = refreshes.length;
    status = statusBody("linked", {
      link: {
        workspaceId: "hr-de",
        osProjectId: "onboarding-qa",
        linkedAt: os.receivedAt,
        accessState: "active",
      },
    });
    await page.clock.fastForward(30_000);
    expect(refreshes.length).toBe(before);
    await page.clock.fastForward(31_000);
    await expect(timeline.locator('[aria-current="step"]')).toHaveText(
      "Linked",
    );
    expect(refreshes.length).toBe(before + 1);
    await expect(
      row.getByText("Linked", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

test("needs more info reopens the draft for editing and sending again", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: "Reopen QA",
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: "Reopen QA", workspaceHint: "" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusBody("needs-more-info")),
    }),
  );
  try {
    await page.reload();
    await page.getByRole("button", { name: /To FlightDeck/ }).click();
    const row = page.locator("article.bridge-project", {
      hasText: "Reopen QA",
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    await expect(
      row.getByText("FlightDeck asked for more information", { exact: false }),
    ).toBeVisible();
    await expect(row.getByLabel("Summary")).toBeEnabled();
    await row.getByLabel("Summary").fill("Summary with the missing detail.");
    await row.getByRole("button", { name: "Save onboarding draft" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Onboarding draft saved" }),
    ).toBeVisible();
    await row.getByRole("tab", { name: "Review & send" }).click();
    await row.getByLabel("Destination workspace").selectOption("hr-de");
    await expect(
      row.getByRole("button", { name: "Send to FlightDeck" }),
    ).toBeEnabled();
  } finally {
    await removeProject(page, project.id);
  }
});
