import { test, expect, type Browser, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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
  draftEdited,
  isDraftLocked,
  isLockedState,
  isStatusMoving,
  lockNote,
  lockedStages,
  movingStages,
  onboardStagesSchema,
  onboardingStages,
  onboardingEnvelope,
  onboardingSchema,
  onboardingSummaryLine,
  onboardingStatusSchema,
  operationStates,
  parseSubmissionStatus,
  payloadLeafPaths,
  personalDataHint,
  personalDataIn,
  projectOnboardingPayloadSchema,
  readiness,
  rejectionReasons,
  reviewRows,
  setupStates,
  stageFor,
  timelineSteps,
  type OnboardingEnvelope,
  type OnboardingStage,
  type OnboardingStatus,
} from "../lib/flightdeck/onboarding";
import {
  DRAFT_NOT_HELD_SQL,
  createOnboardRoute,
  deleteProject,
  draftHeld,
  forgetProject,
  isPollable,
  unconfirmedSend,
  type OnboardDb,
} from "../lib/flightdeck/onboard-route";
import { NO_FEATURES, type InboundFeatures } from "../lib/flightdeck/features";
import { applyObservedStage } from "../lib/flightdeck/transitions";

// Nothing in this file contacts FlightDeck OS. The OS's responses for the
// project-onboarding kind come from a fixture recorded from the OS
// apiReference schemas at OS commit 0f2b3a1e (not a live capture: a real
// submit would file a proposal), the route handlers run over a fake OS and a
// SQLite database built from the real migration 0004, and browser calls to
// Atlas's FlightDeck routes are answered with page.route.
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
  // Both ids are refused here exactly where the OS refuses them: zod 4's
  // uuid (the OS) wants an RFC version and variant, zod 3's (Atlas) any hex
  // 8-4-4-4-12. Upper case is refused too, so the subject stays the OS's
  // lower-cased `atlas-<id>`.
  for (const id of [
    "11111111-1111-1111-1111-111111111111",
    "12345678-1234-1234-1234-123456789abc",
    "00000000-0000-0000-0000-000000000000",
    ATLAS_ID.toUpperCase(),
  ]) {
    expect(
      projectOnboardingPayloadSchema.safeParse({
        ...payload,
        atlasProjectId: id,
      }).success,
      id,
    ).toBe(false);
    expect(
      projectOnboardingPayloadSchema.safeParse({
        ...payload,
        idempotencyKey: id,
      }).success,
      id,
    ).toBe(false);
  }
  expect(
    projectOnboardingPayloadSchema.safeParse({
      ...payload,
      atlasProjectId: "11111111-2222-4333-8444-555555555555",
      idempotencyKey: crypto.randomUUID(),
    }).success,
  ).toBe(true);
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
  // "Never sent" promises only what Atlas can keep: no blanket claim that
  // free text holds no email address or name.
  expect(NEVER_SENT.join(" ")).not.toMatch(/any email|person's name/i);
  const typed = payloadFor(
    readyProject({
      description: "Guide new HR users. Contact jane@example.com",
    }),
  );
  expect(
    reviewRows(typed).find((r) => r.path === "profile.summary")?.value,
  ).toBe("Guide new HR users. Contact jane@example.com");
  expect(personalDataIn(typed)).toEqual({
    refused: [],
    warned: ["profile.summary"],
  });
  expect(personalDataIn(payload)).toEqual({ refused: [], warned: [] });
  expect(
    personalDataIn(
      payloadFor(
        readyProject({
          location: "Call +49 89 1234 5678",
          onboarding: {
            ...readyProject().onboarding,
            ownerRoles: { data: "dana@example.com" },
          },
        }),
      ),
    ).refused,
  ).toEqual(["profile.site", "facts.ownerRoles.data"]);
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
  // The OS's two other 409s each name their own cause.
  expect(await outcome(() => fromFixture(os.submit.lockUnreadable))).toEqual({
    state: "lock_unreadable",
  });
  expect(await outcome(() => fromFixture(os.submit.keyConflict))).toEqual({
    state: "idempotency_key_conflict",
  });
  expect(
    await outcome(() => jsonResponse(409, { code: "something_new" })),
  ).toEqual({ state: "invalid_response" });
  expect(await outcome(() => fromFixture(os.submit.invalid))).toEqual({
    state: "invalid_submission",
  });
  expect(await outcome(() => fromFixture(os.submit.scopeMissing))).toEqual({
    state: "refused",
  });
  expect(await outcome(() => fromFixture(os.submit.kindNotEnabled))).toEqual({
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
      outcomeWithheld: null,
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
  ).toMatchObject({
    state: "ok",
    data: { state: "promoted", promoted: null, outcomeWithheld: null },
  });
  // Why a promoted answer has no outcome: two causes, two different fixes.
  expect(
    await read(() => jsonResponse(200, readBack("promotedWithheldScope"))),
  ).toMatchObject({
    state: "ok",
    data: { state: "promoted", promoted: null, outcomeWithheld: "scope" },
  });
  expect(
    await read(() => jsonResponse(200, readBack("promotedWithheldNotShared"))),
  ).toMatchObject({
    state: "ok",
    data: {
      state: "promoted",
      promoted: null,
      outcomeWithheld: "workspace-not-shared",
    },
  });
  // A cause word this Atlas does not know is not a broken read-back.
  expect(
    await read(() =>
      jsonResponse(200, {
        ...readBack("promoted"),
        outcome: undefined,
        outcomeWithheld: "later",
      }),
    ),
  ).toMatchObject({
    state: "ok",
    data: { state: "promoted", promoted: null, outcomeWithheld: null },
  });
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

test("the OS fixture is recorded from the OS's published schemas, not from a pre-deployment guess", () => {
  // The OS publishes its response schemas (strict, every key required unless
  // optional) in server/inbound/apiReference.ts. The fixture must carry the
  // same keys, so a test that passes here passes against the real OS answer.
  expect(os._about).not.toMatch(/not deployed/i);
  expect(os._about).toMatch(/apiReference/);
  // ContextWorkspacesResponse declares instanceId as z.string().uuid().
  expect(os.context.instanceId).toMatch(UUID_RE);
  expect(os.context.workspaces.instanceId).toBe(os.context.instanceId);
  const keys = (body: object) => Object.keys(body).sort();
  // SubmissionStatus: subject is required.
  expect(os.readBack.base.subject).toBe(`atlas-${ATLAS_ID}`);
  expect(keys(os.readBack.base)).toEqual(
    [
      "fieldNames",
      "integrationId",
      "kind",
      "payloadBytes",
      "payloadSha256",
      "receivedAt",
      "subject",
      "submissionId",
    ].sort(),
  );
  // OnboardingAlreadySubmitted: error, code, submissionId, state.
  expect(keys(os.submit.alreadySubmitted.body)).toEqual(
    ["code", "error", "state", "submissionId"].sort(),
  );
  // InvalidOnboardingPayload: issues carry a path and a Zod code, no message.
  expect(os.submit.invalid.body).toMatchObject({
    error: "invalid project-onboarding submission",
    reason: "invalid-payload",
  });
  for (const issue of os.submit.invalid.body.issues)
    expect(keys(issue)).toEqual(["code", "path"]);
  // InvalidCredential and KindNotEnabled.
  expect(os.submit.unauthorized.body).toEqual({
    error: "invalid or unauthorized credential",
  });
  expect(os.submit.kindNotEnabled).toMatchObject({
    status: 403,
    body: { reason: "kind-not-enabled" },
  });
  expect(keys(os.submit.kindNotEnabled.body)).toEqual(["error", "reason"]);
});

test("read:context accepts any OS instanceId value it has not seen, and still rejects any other new key", async () => {
  const { instanceId, ...without } = os.context.workspaces;
  expect(instanceId).toBe(os.context.instanceId);
  expect(
    osWorkspacesResponseSchema.safeParse(os.context.workspaces).success,
  ).toBe(true);
  expect(osWorkspacesResponseSchema.safeParse(without).success).toBe(true);
  // The OS declares instanceId a UUID today (apiReference), but Atlas keeps
  // it opaque on purpose: if the OS ever changes the format, that must
  // degrade onboarding only (the link is held, see "no link without the OS
  // instanceId"), never take the whole read:context response — and with it
  // the context switcher — down.
  for (const odd of [
    "flightdeck.local",
    "te-ops:9f2c",
    "OS 12",
    "../etc",
    "0f1e2d3c-4b5a-6789-abcd-ef0123456789",
  ]) {
    const client = createContextClient(config, {
      fetch: async () =>
        jsonResponse(200, { ...os.context.workspaces, instanceId: odd }),
    });
    expect(await client.workspaces()).toMatchObject({
      state: "ok",
      data: { instanceId: odd },
    });
  }
  // An unknown KEY, a non-string id, an empty id or an absurd length still
  // rejects: the DTO stays strict about shape, only not about the value.
  for (const bad of [
    { ...os.context.workspaces, root: "/srv/te-ops" },
    { ...os.context.workspaces, instanceId: "" },
    { ...os.context.workspaces, instanceId: 7 },
    { ...os.context.workspaces, instanceId: "x".repeat(129) },
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
const closeSend = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/flightdeck/onboard/${ATLAS_ID}/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const listRequest = (refresh: boolean, headers: Record<string, string> = {}) =>
  new Request(
    `${ORIGIN}/api/flightdeck/onboard${refresh ? "?refresh=1" : ""}`,
    {
      headers: { "Sec-Fetch-Site": "same-origin", ...headers },
    },
  );

/** A D1-shaped adapter over node:sqlite with the real onboarding migrations
 * (0004 onwards). */
function onboardDb() {
  const dir = new URL("../drizzle/", import.meta.url);
  const sqlite = new DatabaseSync(":memory:");
  // Every migration, so the send and the project it belongs to share one
  // database, as they do in D1: the reservation and the project delete are
  // each conditional on the other table.
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
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
  /** The transition log, as [stage, source, observed_at] per row. */
  const transitions = () =>
    (
      sqlite
        .prepare(
          "SELECT stage,source,observed_at FROM atlas_flightdeck_transitions ORDER BY send_id,seq",
        )
        .all() as { stage: string; source: string; observed_at: string }[]
    ).map((t) => [t.stage, t.source, t.observed_at]);
  return { db, sqlite, ops, links, transitions };
}

function harness(
  options: {
    superAdmin?: boolean;
    project?: Project | null;
    /** The OS features for this credential; omitted, the route runs with
     * no features dependency at all. */
    features?: () => Promise<InboundFeatures>;
    /** ONB_METRICS_ENABLED; unset is the default (off). */
    metrics?: boolean;
  } = {},
) {
  const store = onboardDb();
  let clock = Date.parse("2026-09-22T09:00:00.000Z");
  let project =
    options.project === undefined ? readyProject() : options.project;
  /** The project's own row, which the reservation requires to exist. */
  const saveRow = (next: Project) =>
    store.sqlite
      .prepare(
        "INSERT INTO atlas_projects (id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision",
      )
      .run(
        next.id,
        "user-1",
        JSON.stringify(next),
        next.source ?? "atlas",
        os.receivedAt,
        next.revision,
      );
  if (project) saveRow(project);
  let user = { userId: "user-1", superAdmin: options.superAdmin ?? true };
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
    /** Other projects the caller can see. */
    visible: [] as string[],
    submits: [] as OnboardingEnvelope[],
    authorize: 0,
    /** Awaited at the start of every workspaces() read, to hold a send
     * between loading its project and reserving its row. */
    beforeWorkspaces: null as null | (() => Promise<void>),
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
        outcomeWithheld: null,
      },
    })) as (id: string) => Promise<ReadSubmissionResult>,
  };
  const reader = (fresh: boolean): ContextReader => ({
    async workspaces() {
      fake.calls.push(fresh ? "workspaces:fresh" : "workspaces");
      await fake.beforeWorkspaces?.();
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
      return { access: { ...user } };
    },
    async loadProject(_access, id) {
      return project && id === project.id ? { project, canEdit: true } : null;
    },
    async visibleProjectIds() {
      return [...(project ? [project.id] : []), ...fake.visible];
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
    ...(options.features
      ? {
          features: async () => {
            fake.calls.push("features");
            return options.features!();
          },
        }
      : {}),
    ...(options.metrics === undefined
      ? {}
      : { metricsEnabled: () => options.metrics! }),
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
        outcomeWithheld: body.outcomeWithheld ?? null,
      },
    };
  };
  return {
    route,
    store,
    fake,
    readAs,
    tick: (ms: number) => void (clock += ms),
    /** The project as edited elsewhere in Atlas after a send. */
    setProject: (next: Project) => {
      project = next;
      saveRow(next);
    },
    as: (userId: string, superAdmin = true) =>
      void (user = { userId, superAdmin }),
    async status(refresh = true) {
      const response = await route.GET(statusRequest(refresh), ATLAS_ID);
      expect(response.status).toBe(200);
      return onboardingStatusSchema.parse(await response.json());
    },
    async list(refresh = true) {
      const response = await route.LIST(listRequest(refresh));
      expect(response.status).toBe(200);
      return onboardStagesSchema.parse(await response.json());
    },
    /** Closes the send the caller last saw. */
    async close(seen: OnboardingStatus) {
      return route.CLOSE(
        closeSend({ updatedAt: seen.operation!.updatedAt }),
        ATLAS_ID,
      );
    },
    /** A filed send of another project, straight into the table. */
    fileOther(id: string, submissionId: string, checkedAt: string | null) {
      store.sqlite
        .prepare(
          "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,state,submission_id,created_by,updated_at,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `op-${id}`,
          id,
          1,
          `key-${id}`,
          "hr-de",
          "Other",
          "filed",
          submissionId,
          "user-0",
          os.receivedAt,
          checkedAt,
        );
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

test("a fresh send reads this credential's features before the remote call; a retry resends its bytes without reading them", async () => {
  const h = harness({ features: async () => NO_FEATURES });
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  const first = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(first.status).toBe(503);
  const firstCalls = [...h.fake.calls];
  expect(firstCalls.filter((c) => c === "features")).toHaveLength(1);
  expect(firstCalls.indexOf("features")).toBeLessThan(
    firstCalls.indexOf("submit"),
  );
  h.fake.calls.length = 0;
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(h.fake.calls).toContain("submit");
  expect(h.fake.calls).not.toContain("features");
  // With every flag off the envelope is today's allowlist, nothing more.
  const [envelope] = h.fake.submits;
  expect(Object.keys(envelope.payload).sort()).toEqual(
    Object.keys(payloadFor()).sort(),
  );
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

const duplicateReceipt = async (): Promise<SubmitResult> => ({
  state: "ok",
  data: {
    submissionId: os.submissionId,
    receivedAt: null,
    payloadSha256: null,
    duplicate: true,
  },
});

test("a retry after an edit resends the reserved request byte for byte and keeps its revision", async () => {
  const h = harness();
  // Revision 7 carries an email in the summary; FlightDeck filed it, but the
  // reply was lost.
  h.setProject(
    readyProject({ description: "Summary v1: contact alex@example.com" }),
  );
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(503);
  const [reserved] = h.store.ops();
  expect(JSON.parse(String(reserved.request_body))).toEqual(h.fake.submits[0]);
  // The project is then edited elsewhere in Atlas: revision 8, clean text.
  h.setProject(
    readyProject({
      revision: 8,
      description: "Summary v2: no personal data",
      flightdeckDraft: { label: "Renamed label", workspaceHint: "" },
    }),
  );
  // The Super Admin sees exactly what Retry resends: revision 7, as sent.
  const pending = await h.status(false);
  expect(pending.operation?.atlasRevision).toBe(7);
  expect(pending.pendingPayload).toEqual(h.fake.submits[0].payload);
  expect(pending.pendingPayload?.profile.summary).toBe(
    "Summary v1: contact alex@example.com",
  );
  // Retrying "the current project" is refused, unsent: the key is revision 7's.
  const changed = await h.route.POST(sendTo("hr-de", 8), ATLAS_ID);
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({
    code: "pending_send_changed",
    atlasRevision: 7,
  });
  expect(h.fake.submits).toHaveLength(1);
  // Another Super Admin retries revision 7: the very same bytes go again.
  h.as("user-2");
  h.fake.onSubmit = duplicateReceipt;
  const retry = await h.route.POST(sendTo("hr-de", 7), ATLAS_ID);
  expect(retry.status).toBe(202);
  expect(h.fake.submits).toHaveLength(2);
  expect(JSON.stringify(h.fake.submits[1])).toBe(
    JSON.stringify(h.fake.submits[0]),
  );
  expect(h.fake.submits[1].payload).toMatchObject({
    atlasRevision: 7,
    requestedBy: HASH,
    target: { label: "Payroll rollout" },
  });
  // Atlas records what FlightDeck holds, and drops its copy of the body.
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      id: reserved.id,
      state: "filed",
      idempotency_key: reserved.idempotency_key,
      atlas_revision: 7,
      proposed_label: "Payroll rollout",
      request_body: null,
    }),
  ]);
  const filed = await h.status(false);
  expect(filed.operation?.atlasRevision).toBe(7);
  expect(filed.pendingPayload).toBeNull();
  // The link records revision 7 as its source, not the edited revision 8.
  h.fake.onRead = h.readAs("promoted");
  h.fake.projects["hr-de"] = structuredClone(os.context.projectsAfterPromotion);
  h.tick(61_000);
  expect((await h.status()).operation?.stage).toBe("linked");
  expect(h.store.links()[0]).toMatchObject({ source_revision: 7 });
});

test("only the Super Admin sees the request a retry would resend", async () => {
  const h = harness();
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  h.as("member-1", false);
  const view = await h.status(false);
  expect(view).toMatchObject({
    retryPending: true,
    pendingPayload: null,
    operation: { destinationWorkspaceId: null },
  });
});

test("a refusal after a lost response keeps the reservation, so the retry reuses the first key", async () => {
  const h = harness();
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  // FlightDeck may hold the first attempt. A refusal of a later attempt
  // (the kind switched off for a while, a rotated credential, a format
  // check) says nothing about that one.
  for (const state of [
    "refused",
    "unauthorized",
    "invalid_submission",
  ] as const) {
    h.fake.onSubmit = async () => ({ state });
    const response = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    expect(response.status, state).toBe(502);
    const body = (await response.json()) as { error: string; status: unknown };
    expect(body).toMatchObject({ code: state });
    expect(body.error).toMatch(/earlier attempt may already have been filed/i);
    expect(onboardingStatusSchema.parse(body.status)).toMatchObject({
      retryPending: true,
      operation: {
        state: "reserved",
        stage: "not-confirmed",
        reasonCode: state,
      },
    });
  }
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      state: "reserved",
      reason_code: "invalid_submission",
    }),
  ]);
  // Nothing else can be sent meanwhile, and no fresh key is ever issued.
  const moved = await h.route.POST(sendTo("te-ops"), ATLAS_ID);
  expect(moved.status).toBe(409);
  expect(await moved.json()).toMatchObject({ code: "pending_send" });
  h.fake.onSubmit = duplicateReceipt;
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(
    new Set(h.fake.submits.map((e) => e.payload.idempotencyKey)).size,
  ).toBe(1);
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      state: "filed",
      destination_workspace_id: "hr-de",
      submission_id: os.submissionId,
    }),
  ]);
});

test("a refused retry after the receipt was never stored keeps the reservation, its key and its request", async () => {
  const h = harness();
  // FlightDeck files the send (202), but the one write that stores its
  // receipt fails, exactly as if the Worker stopped after the POST: the row
  // stays reserved and no reason code was ever recorded.
  const prepare = h.store.db.prepare.bind(h.store.db);
  let failReceipt = true;
  h.store.db.prepare = (sql) => {
    if (
      failReceipt &&
      sql.startsWith(
        "UPDATE atlas_flightdeck_operations SET state=?,submission_id=?",
      )
    ) {
      failReceipt = false;
      throw Error("D1 unavailable");
    }
    return prepare(sql);
  };
  const lost = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(lost.status).toBe(503);
  expect(await lost.json()).toMatchObject({ code: "storage_unavailable" });
  expect(failReceipt).toBe(false);
  const [first] = h.store.ops();
  expect(first).toMatchObject({ state: "reserved", reason_code: null });
  expect(first.request_body).toEqual(expect.any(String));

  // The kind flag is set per run in the OS shell, so after an OS restart the
  // retry is refused. That says nothing about the attempt FlightDeck filed.
  for (const state of [
    "refused",
    "unauthorized",
    "invalid_submission",
  ] as const) {
    h.fake.onSubmit = async () => ({ state });
    const response = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    expect(response.status, state).toBe(502);
    const body = (await response.json()) as { error: string; status: unknown };
    expect(body).toMatchObject({ code: state });
    expect(body.error).toMatch(/earlier attempt may already have been filed/i);
    expect(body.error).not.toMatch(/nothing was filed/i);
    expect(onboardingStatusSchema.parse(body.status)).toMatchObject({
      retryPending: true,
      operation: { state: "reserved", stage: "not-confirmed" },
    });
    expect(h.store.ops()).toEqual([
      expect.objectContaining({
        id: first.id,
        state: "reserved",
        idempotency_key: first.idempotency_key,
        request_body: first.request_body,
        destination_workspace_id: "hr-de",
        atlas_revision: 7,
        reason_code: state,
      }),
    ]);
  }
  // Once FlightDeck accepts requests again the retry reuses the first key,
  // is answered as a duplicate, and nothing is adopted.
  h.fake.onSubmit = duplicateReceipt;
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(new Set(h.fake.submits.map((e) => e.payload.idempotencyKey))).toEqual(
    new Set([first.idempotency_key]),
  );
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      id: first.id,
      state: "filed",
      adopted: 0,
      destination_workspace_id: "hr-de",
      atlas_revision: 7,
      submission_id: os.submissionId,
    }),
  ]);
});

test("a retry FlightDeck refuses for good can be closed, and the next send follows what FlightDeck holds instead of filing twice", async () => {
  const h = harness();
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  const [reserved] = h.store.ops();
  // FlightDeck checks the format before it looks at the key, so these exact
  // bytes are refused on every retry: they were never filed under any key.
  h.fake.onSubmit = async () => ({ state: "invalid_submission" });
  for (let i = 0; i < 3; i++) {
    const retry = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    expect(retry.status).toBe(502);
    expect(((await retry.json()) as { error: string }).error).toMatch(
      /close this unconfirmed send/i,
    );
  }
  // A corrected revision and another destination still wait for this one,
  // and both refusals say how to close it.
  h.setProject(readyProject({ revision: 8 }));
  for (const request of [sendTo("hr-de", 8), sendTo("te-ops", 7)]) {
    const blocked = await h.route.POST(request, ATLAS_ID);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toMatch(
      /close it/i,
    );
  }
  const stuck = await h.status(false);
  expect(stuck).toMatchObject({
    retryPending: true,
    canClose: true,
    operation: { state: "reserved", stage: "not-confirmed" },
  });
  // The way out: close it. Nothing is sent and the OS is not read.
  h.fake.calls.length = 0;
  const closed = await h.close(stuck);
  expect(closed.status).toBe(200);
  expect(onboardingStatusSchema.parse(await closed.json())).toMatchObject({
    operation: { state: "refused", stage: "closed", reasonCode: "abandoned" },
    canSend: true,
    retryPending: false,
    canClose: false,
    pollable: false,
    pendingPayload: null,
  });
  expect(h.fake.calls).toEqual([]);
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      id: reserved.id,
      idempotency_key: reserved.idempotency_key,
      state: "refused",
      reason_code: "abandoned",
      request_body: null,
    }),
  ]);
  // Say FlightDeck did file the first attempt after all: the next send, with
  // a fresh key, meets its subject lock, and Atlas follows that request once
  // the read-back proves it is this project's. Nothing is filed twice.
  h.fake.onSubmit = async () => ({
    state: "already_submitted",
    submissionId: os.submissionId,
    osState: "filed",
  });
  const again = await h.route.POST(sendTo("hr-de", 8), ATLAS_ID);
  expect(again.status).toBe(202);
  const [, second] = h.store.ops();
  expect(second).toMatchObject({
    state: "filed",
    submission_id: os.submissionId,
    adopted: 1,
  });
  expect(second.idempotency_key).not.toBe(reserved.idempotency_key);
  expect(h.fake.submits.at(-1)!.payload.idempotencyKey).toBe(
    second.idempotency_key,
  );
  // A send FlightDeck confirmed cannot be closed.
  const late = await h.close(await h.status(false));
  expect(late.status).toBe(409);
  expect(await late.json()).toMatchObject({ code: "not_closable" });
  expect(h.store.ops()[1]).toMatchObject({ state: "filed" });
});

test("a reserved request Atlas cannot read can be closed instead of blocking the project for good", async () => {
  const h = harness();
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  h.store.sqlite
    .prepare("UPDATE atlas_flightdeck_operations SET request_body='{'")
    .run();
  const unreadable = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(unreadable.status).toBe(409);
  const body = (await unreadable.json()) as { code: string; error: string };
  expect(body.code).toBe("pending_send_unreadable");
  expect(body.error).toMatch(/close this unconfirmed send/i);
  const seen = await h.status(false);
  expect(seen.canClose).toBe(true);
  expect((await h.close(seen)).status).toBe(200);
  h.fake.onSubmit = async () => ({
    state: "ok",
    data: {
      submissionId: os.otherSubmissionId,
      receivedAt: os.receivedAt,
      payloadSha256: os.payloadSha256,
      duplicate: false,
    },
  });
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(h.store.ops().map((o) => o.state)).toEqual(["refused", "filed"]);
});

test("only the Super Admin closes a send, same-origin, and only the send they last saw", async () => {
  const h = harness();
  h.fake.onSubmit = async () => ({ state: "os_unreachable" });
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  const seen = await h.status(false);
  const updatedAt = seen.operation!.updatedAt;
  const crossSite: Record<string, string>[] = [
    { Origin: "https://attacker.example" },
    { Origin: "", "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of crossSite) {
    const response = await h.route.CLOSE(
      closeSend({ updatedAt }, headers),
      ATLAS_ID,
    );
    expect(response.status).toBe(403);
  }
  h.as("member-1", false);
  expect((await h.status(false)).canClose).toBe(false);
  const member = await h.route.CLOSE(closeSend({ updatedAt }), ATLAS_ID);
  expect(member.status).toBe(403);
  expect(await member.json()).toMatchObject({ code: "not_permitted" });
  h.as("user-1");
  for (const body of [{}, { updatedAt: "yesterday" }, { updatedAt, x: 1 }])
    expect(
      (await h.route.CLOSE(closeSend(body), ATLAS_ID)).status,
      JSON.stringify(body),
    ).toBe(400);
  // A retry since then changed the send: closing what was seen is refused.
  h.tick(1_000);
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  const stale = await h.close(seen);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "status_changed" });
  expect(h.store.ops()).toEqual([
    expect.objectContaining({ state: "reserved" }),
  ]);
  // Nothing to close at all.
  const none = harness();
  const nothing = await none.route.CLOSE(closeSend({ updatedAt }), ATLAS_ID);
  expect(nothing.status).toBe(409);
  expect(await nothing.json()).toMatchObject({ code: "not_closable" });
});

test("a retry still reaches FlightDeck after its destination was disabled or unshared, so a lost reply can be reconciled", async () => {
  for (const change of ["disabled", "unshared"] as const) {
    const h = harness();
    h.fake.onSubmit = async () => ({ state: "os_unreachable" });
    await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    const list = h.fake.workspaces.workspaces as {
      id: string;
      enabled: boolean;
    }[];
    if (change === "disabled")
      list.find((w) => w.id === "hr-de")!.enabled = false;
    else h.fake.workspaces.workspaces = list.filter((w) => w.id !== "hr-de");
    // The destination was checked when the key was reserved. FlightDeck
    // answers a known key before it looks at the target, so resending the
    // same bytes is the only way to learn what it holds.
    h.fake.calls.length = 0;
    h.fake.onSubmit = duplicateReceipt;
    const retry = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    expect(retry.status, change).toBe(202);
    expect(h.fake.calls, change).toEqual(["submit"]);
    expect(h.store.ops(), change).toEqual([
      expect.objectContaining({
        state: "filed",
        submission_id: os.submissionId,
        destination_workspace_id: "hr-de",
      }),
    ]);
  }
});

test("a filed send FlightDeck no longer knows can be closed and sent again; one it knows cannot", async () => {
  const h = harness();
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  h.fake.onRead = async () => ({ state: "not_found" });
  h.tick(61_000);
  const lost = await h.status();
  expect(lost).toMatchObject({
    canSend: false,
    canClose: true,
    operation: { state: "filed", reasonCode: "submission_not_found" },
  });
  expect(lost.notice).toMatch(/close this send/i);
  expect(lost.notice).not.toMatch(/before sending again/i);
  // FlightDeck knows it again: it can no longer be closed.
  h.fake.onRead = h.readAs("filed");
  h.tick(61_000);
  const known = await h.status();
  expect(known).toMatchObject({
    canClose: false,
    notice: null,
    operation: { state: "filed", reasonCode: null },
  });
  const refused = await h.close(known);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "not_closable" });
  // Unknown again: closed, then sent again with a fresh key.
  h.fake.onRead = async () => ({ state: "not_found" });
  h.tick(61_000);
  const gone = await h.status();
  expect((await h.close(gone)).status).toBe(200);
  expect(h.store.ops()[0]).toMatchObject({
    state: "refused",
    reason_code: "abandoned",
    submission_id: os.submissionId,
  });
  expect(await h.status(false)).toMatchObject({
    pollable: false,
    canSend: true,
    operation: { stage: "closed" },
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
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  const [first, second] = h.store.ops();
  expect(second).toMatchObject({
    state: "filed",
    submission_id: os.otherSubmissionId,
  });
  expect(second.idempotency_key).not.toBe(first.idempotency_key);
});

test("a project cannot be deleted under an unconfirmed send, and deleting it takes its send record and its link with it", async () => {
  // A reserved send is the one state that still holds `request_body`: a
  // verbatim copy of the summary and success measure, kept only so a retry
  // can resend the same bytes. Deleting the project under it would strand
  // that copy for good — POST, GET and CLOSE all answer 404 once the project
  // is gone, and the list sweep only ever selects filed, promoted and linked.
  const pending = harness();
  pending.fake.onSubmit = async () => ({ state: "os_unreachable" });
  expect((await pending.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(
    503,
  );
  expect(pending.store.ops()[0]).toMatchObject({
    state: "reserved",
    request_body: expect.any(String),
  });
  expect(String(pending.store.ops()[0].request_body)).toContain(
    readyProject().description,
  );
  expect(await unconfirmedSend(pending.store.db, ATLAS_ID)).toMatchObject({
    state: "reserved",
  });
  // Nothing is deleted behind the owner's back (decision 6): this is exactly
  // the state the form offers "Close this unconfirmed send" for, so the delete
  // waits for that, and closing clears the body first.
  expect((await pending.close(await pending.status(false))).status).toBe(200);
  expect(pending.store.ops()[0]).toMatchObject({
    state: "refused",
    request_body: null,
  });
  expect(await unconfirmedSend(pending.store.db, ATLAS_ID)).toBeNull();
  expect(await forgetProject(pending.store.db, ATLAS_ID)).toEqual({
    operations: 1,
    links: 0,
  });
  expect(pending.store.ops()).toEqual([]);

  // A send FlightDeck has confirmed never blocks the delete: its body was
  // cleared when the receipt was stored. Its link must still go, or
  // uniq_atlas_project_links_os holds that OS project against a project Atlas
  // no longer has, and every later promotion onto it answers link_conflict
  // with no route able to clear it.
  const held = harness();
  expect((await held.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  held.fake.onRead = held.readAs("promoted");
  held.fake.projects["hr-de"] = structuredClone(
    os.context.projectsAfterPromotion,
  );
  held.tick(61_000);
  expect((await held.status()).operation?.stage).toBe("linked");
  expect(held.store.ops()[0]).toMatchObject({ request_body: null });
  expect(held.store.links()).toHaveLength(1);
  expect(await unconfirmedSend(held.store.db, ATLAS_ID)).toBeNull();
  // Another Atlas project cannot take that OS project while the link stands.
  const OTHER = "99999999-2222-4333-8444-555555555555";
  const linkOther = () => {
    try {
      held.store.sqlite
        .prepare(
          "INSERT INTO atlas_project_links (installation_id,os_instance_id,workspace_id,os_project_id,atlas_project_id,submission_id,linked_at,linked_by,source_revision,last_checked_at,access_state) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "atlas-test",
          os.context.instanceId,
          "hr-de",
          "payroll-rollout",
          OTHER,
          null,
          os.receivedAt,
          "user-0",
          1,
          os.receivedAt,
          "active",
        );
      return true;
    } catch {
      return false;
    }
  };
  expect(linkOther()).toBe(false);
  expect(await forgetProject(held.store.db, ATLAS_ID)).toEqual({
    operations: 1,
    links: 1,
  });
  expect(held.store.ops()).toEqual([]);
  expect(held.store.links()).toEqual([]);
  expect(linkOther()).toBe(true);
});

/** A gate a fake can wait on: `reached` resolves once it is waiting (or once
 * `count` callers are), `open()` lets them all through. */
function gate(count = 1) {
  let open!: () => void;
  let arrive!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  const reached = new Promise<void>((r) => (arrive = r));
  let waiting = 0;
  return {
    reached,
    open,
    async wait() {
      if (++waiting === count) arrive();
      await opened;
    },
  };
}

test("a project deleted while its first send waits on FlightDeck is never reserved or sent, and one with a reserved send is not deleted", async () => {
  // The delete lands after the send loaded the project and before it
  // reserved a row: nothing is reserved and nothing reaches FlightDeck, so no
  // copy of the summary is left in a row no route can reach.
  const h = harness();
  const reader = gate();
  h.fake.beforeWorkspaces = reader.wait;
  const sending = h.route.POST(sendTo("hr-de"), ATLAS_ID);
  await reader.reached;
  expect(await deleteProject(h.store.db, ATLAS_ID, 7)).toBe("deleted");
  reader.open();
  const refused = await sending;
  expect(refused.status).toBe(404);
  expect(await refused.json()).toMatchObject({ code: "not_found" });
  expect(h.fake.submits).toEqual([]);
  expect(h.store.ops()).toEqual([]);

  // The reservation lands first: the delete is refused in the same statement
  // that would remove the project, so it cannot slip in between.
  const r = harness();
  const remote = gate();
  r.fake.onSubmit = async () => {
    await remote.wait();
    return { state: "os_unreachable" };
  };
  const first = r.route.POST(sendTo("hr-de"), ATLAS_ID);
  await remote.reached;
  expect(await deleteProject(r.store.db, ATLAS_ID, 7)).toBe("unconfirmed");
  remote.open();
  expect((await first).status).toBe(503);
  expect(await deleteProject(r.store.db, ATLAS_ID, 7)).toBe("unconfirmed");
  expect(
    r.store.sqlite.prepare("SELECT id FROM atlas_projects").all(),
  ).toHaveLength(1);
  // An old revision is refused as changed, whatever the send.
  expect((await r.close(await r.status(false))).status).toBe(200);
  expect(await deleteProject(r.store.db, ATLAS_ID, 6)).toBe("changed");
  expect(await deleteProject(r.store.db, ATLAS_ID, 7)).toBe("deleted");
  expect(r.store.ops()).toEqual([]);
  expect(r.store.sqlite.prepare("SELECT id FROM atlas_projects").all()).toEqual(
    [],
  );
});

test("the server keeps a draft FlightDeck may hold as it was sent, whatever the form shows", async () => {
  // The form locks itself while a send is open, but a form that has not
  // loaded its status yet (or failed to) knows nothing: the project save
  // must refuse on its own. Only the draft itself is held: the rest of the
  // project keeps moving (its board status, its tasks), and later edits there
  // are simply not sent.
  const before = readyProject();
  const edits: [string, Project, boolean][] = [
    [
      "label",
      {
        ...before,
        flightdeckDraft: { ...before.flightdeckDraft!, label: "Renamed" },
      },
      true,
    ],
    ["draft removed", { ...before, flightdeckDraft: null }, true],
    [
      "country",
      { ...before, onboarding: { ...before.onboarding, countryCode: "FR" } },
      true,
    ],
    ["board status", { ...before, status: "On hold" }, false],
    ["stage", { ...before, onboardingStage: "Rolled out" }, false],
    ["as the save parses it", projectSchema.parse(before) as Project, false],
  ];
  for (const [name, next, changed] of edits)
    expect(draftEdited(before, next), name).toBe(changed);

  const h = harness();
  const save = () =>
    h.store.db
      .prepare(
        "UPDATE atlas_projects SET revision=revision+1 WHERE id=?" +
          DRAFT_NOT_HELD_SQL,
      )
      .bind(ATLAS_ID)
      .run();
  expect(await draftHeld(h.store.db, ATLAS_ID)).toBe(false);
  expect((await save()).meta.changes).toBe(1);
  // Reserved, then filed: FlightDeck may hold it, so the draft is held.
  const remote = gate();
  h.fake.onSubmit = async () => {
    await remote.wait();
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
  const sending = h.route.POST(sendTo("hr-de"), ATLAS_ID);
  await remote.reached;
  expect(await draftHeld(h.store.db, ATLAS_ID)).toBe(true);
  expect((await save()).meta.changes).toBe(0);
  remote.open();
  expect((await sending).status).toBe(202);
  expect(await draftHeld(h.store.db, ATLAS_ID)).toBe(true);
  expect((await save()).meta.changes).toBe(0);
  // FlightDeck asks for more information: the draft opens again.
  h.fake.onRead = h.readAs("needsMoreInfo");
  h.tick(61_000);
  expect((await h.status()).operation?.stage).toBe("needs-more-info");
  expect(await draftHeld(h.store.db, ATLAS_ID)).toBe(false);
  expect((await save()).meta.changes).toBe(1);
});

test("two sends at once reserve one row: one reaches FlightDeck, the other is told a send is in progress", async () => {
  // Two tabs press Send together: both pass the latest-send check before
  // either reserves, so only the one-open-send index stands between them.
  const h = harness();
  const reader = gate(2);
  h.fake.beforeWorkspaces = reader.wait;
  const a = h.route.POST(sendTo("hr-de"), ATLAS_ID);
  const b = h.route.POST(sendTo("hr-de"), ATLAS_ID);
  await reader.reached;
  reader.open();
  const results = await Promise.all([a, b]);
  expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(await results.find((r) => r.status === 409)!.json()).toMatchObject({
    code: "send_in_progress",
  });
  expect(h.fake.submits).toHaveLength(1);
  expect(h.store.ops()).toEqual([
    expect.objectContaining({
      state: "filed",
      idempotency_key: h.fake.submits[0].payload.idempotencyKey,
    }),
  ]);

  // The second press arrives after the first has reserved its row, while
  // FlightDeck has not answered: it resends that request byte for byte, under
  // the same key, and both settle on one filed row.
  const k = harness();
  const remote = gate();
  let calls = 0;
  const receipt: SubmitResult = {
    state: "ok",
    data: {
      submissionId: os.submissionId,
      receivedAt: os.receivedAt,
      payloadSha256: os.payloadSha256,
      duplicate: false,
    },
  };
  k.fake.onSubmit = async () => {
    if (++calls === 1) await remote.wait();
    return receipt;
  };
  const first = k.route.POST(sendTo("hr-de"), ATLAS_ID);
  await remote.reached;
  const second = await k.route.POST(sendTo("hr-de"), ATLAS_ID);
  remote.open();
  expect([(await first).status, second.status]).toEqual([202, 202]);
  expect(k.fake.submits).toHaveLength(2);
  expect(JSON.stringify(k.fake.submits[1])).toBe(
    JSON.stringify(k.fake.submits[0]),
  );
  expect(k.store.ops()).toEqual([
    expect.objectContaining({
      state: "filed",
      idempotency_key: k.fake.submits[0].payload.idempotencyKey,
      submission_id: os.submissionId,
      request_body: null,
    }),
  ]);
});

test("an email or phone number outside the summary and success measure is refused before anything is reserved or sent", async () => {
  const base = readyProject().onboarding!;
  const cases: [string, Partial<Project>][] = [
    [
      "target.label",
      {
        flightdeckDraft: {
          label: "jane.doe@example.com payroll",
          workspaceHint: "",
        },
      },
    ],
    [
      "facts.ownerRoles.process",
      {
        onboarding: {
          ...base,
          ownerRoles: { process: "jane.doe@example.com" },
        },
      },
    ],
    [
      "facts.dataSources",
      {
        onboarding: {
          ...base,
          dataSources: ["SAP HCM", "jane.doe@example.com mailbox"],
        },
      },
    ],
    [
      "facts.accessRequested",
      {
        onboarding: {
          ...base,
          accessRequested: [{ system: "Call +49 89 1234 5678", level: "read" }],
        },
      },
    ],
    ["profile.site", { location: "jane.doe@example.com" }],
    [
      "facts.legalEntity",
      { onboarding: { ...base, legalEntity: "Ask +49 (89) 1234-5678" } },
    ],
    ["profile.functionArea", { functionArea: "hr@example.com" }],
    ["profile.category", { category: "Pilot for jane@example.com" }],
  ];
  for (const [path, overrides] of cases) {
    const h = harness({ project: readyProject(overrides) });
    const response = await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    expect(response.status, path).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text), path).toMatchObject({
      code: "personal_data",
      fields: [path],
    });
    // The refusal names the field, never the value.
    for (const value of ["example.com", "jane", "1234"])
      expect(text, path).not.toContain(value);
    expect(h.fake.calls, path).toEqual([]);
    expect(h.store.ops(), path).toEqual([]);
  }
  // A long run of digits is not a phone number. Decision 4 asks for role
  // titles in place of people, and a role title carries a plant number and a
  // year range; a system name carries a version; an entity carries a cost
  // centre. These are refused by no override, so counting every digit in a
  // group would leave the owner unable to send at all — and the refusal would
  // name a phone number that is not in the text.
  const codes = readyProject({
    flightdeckDraft: { label: "Payroll 2024-2026", workspaceHint: "" },
    functionArea: "Quality, Plant 4 (2024-2026)",
    location: "Werk 4 / 2021-2024",
    onboarding: {
      ...base,
      legalEntity: "Entity 4711 / cost centre 100-200-300-400",
      ownerRoles: {
        process: "Head of Quality, Plant 4 (2024-2026)",
        data: "SAP (ERP) 2020 2021 2022 steward",
      },
      dataSources: ["SAP ECC 6.0 / S4 2021-2024"],
    },
  });
  const clean = harness({ project: codes });
  expect((await clean.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(clean.fake.submits[0].payload.facts.ownerRoles.process).toBe(
    "Head of Quality, Plant 4 (2024-2026)",
  );
  // The same text in the free-text fields is still warned about: a warning
  // costs the writer a hint, a refusal costs them the send.
  expect(personalDataIn(payloadFor(codes))).toEqual({
    refused: [],
    warned: [],
  });
  expect(
    personalDataIn(
      payloadFor({
        ...codes,
        description: "Head of Quality, Plant 4 (2024-2026)",
      }),
    ),
  ).toEqual({ refused: [], warned: ["profile.summary"] });
  // The form's own hint agrees with the route, field by field.
  expect(
    personalDataHint("Head of Quality, Plant 4 (2024-2026)", true),
  ).toBeNull();
  expect(personalDataHint("Head of Quality, Plant 4 (2024-2026)")).toMatch(
    /phone/i,
  );
  expect(personalDataHint("Call +49 89 1234 5678", true)).toMatch(
    /will not send an email address or phone number/i,
  );
  expect(personalDataHint("Reach me on 0151 2345678", true)).toMatch(
    /will not send an email address or phone number/i,
  );

  // Summary and success measure are free text the owner chose to send
  // (decision 5): the form warns, and they travel as written.
  const free = harness({
    project: readyProject({
      description: "Contact jane@example.com",
      benefit: "Call +49 89 1234 5678",
    }),
  });
  expect((await free.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(free.fake.submits[0].payload.profile).toMatchObject({
    summary: "Contact jane@example.com",
    successMeasure: "Call +49 89 1234 5678",
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

test("the send and poll paths log each stage once, at the time Atlas saw it, and a project delete takes the log", async () => {
  const h = harness();
  const t0 = new Date(Date.parse("2026-09-22T09:00:00.000Z")).toISOString();
  const after = (ms: number) =>
    new Date(Date.parse("2026-09-22T09:00:00.000Z") + ms).toISOString();
  expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(h.store.transitions()).toEqual([["submitted", "atlas", t0]]);
  // Still filed: a read-back that sees no change logs nothing.
  h.tick(61_000);
  await h.status();
  // Promoted but not yet visible to read:context: still "submitted".
  h.fake.onRead = h.readAs("promoted");
  h.tick(61_000);
  await h.status();
  expect(h.store.transitions()).toEqual([["submitted", "atlas", t0]]);
  h.fake.projects["hr-de"] = structuredClone(os.context.projectsAfterPromotion);
  h.tick(61_000);
  await h.status();
  h.fake.onRead = h.readAs("setupInProgress");
  h.tick(61_000);
  await h.status();
  // The list's own sweep logs through the same path.
  h.tick(5 * 60_000);
  h.fake.onRead = h.readAs("setupComplete");
  await h.list();
  expect(h.store.transitions()).toEqual([
    ["submitted", "atlas", t0],
    ["linked", "poll", after(183_000)],
    ["setup-in-progress", "poll", after(244_000)],
    ["setup-complete", "poll", after(544_000)],
  ]);
  expect(await forgetProject(h.store.db, ATLAS_ID)).toMatchObject({
    operations: 1,
  });
  expect(h.store.transitions()).toEqual([]);

  // A send FlightDeck never confirmed, then closed by the Super Admin.
  const lost = harness();
  lost.fake.onSubmit = async () => ({ state: "os_unreachable" });
  await lost.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(lost.store.transitions()).toEqual([["not-confirmed", "atlas", t0]]);
  lost.tick(1_000);
  const seen = await lost.status(false);
  expect((await lost.close(seen)).status).toBe(200);
  expect(lost.store.transitions()).toEqual([
    ["not-confirmed", "atlas", t0],
    ["closed", "atlas", after(1_000)],
  ]);

  // Declined, then a late read-back that still says filed: no step back.
  const declined = harness();
  await declined.route.POST(sendTo("hr-de"), ATLAS_ID);
  declined.fake.onRead = declined.readAs("needsMoreInfo");
  declined.tick(61_000);
  await declined.status();
  expect(declined.store.transitions()).toEqual([
    ["submitted", "atlas", t0],
    ["needs-more-info", "poll", after(61_000)],
  ]);
});

test("onboarding measures (default off) record opened, sent and correction once per draft, as its hash and never a value", async () => {
  const measures = (h: ReturnType<typeof harness>) =>
    h.store.sqlite
      .prepare("SELECT * FROM atlas_onboarding_metrics ORDER BY at, kind")
      .all() as Record<string, unknown>[];
  const flow = async (h: ReturnType<typeof harness>) => {
    await h.status(false);
    h.setProject(readyProject());
    expect((await h.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
    h.fake.onRead = h.readAs("needsMoreInfo");
    h.tick(61_000);
    await h.status();
    h.tick(61_000);
    await h.status();
  };
  const empty = { ...readyProject(), onboarding: undefined };
  // Default: the flag is unset, and nothing is measured.
  const off = harness({ project: empty });
  await flow(off);
  expect(off.store.transitions().length).toBe(2);
  expect(measures(off)).toEqual([]);
  // On: the moments, each once, keyed by the draft's hash only.
  const on = harness({ project: empty, metrics: true });
  await flow(on);
  const draftHash = createHash("sha256").update(ATLAS_ID).digest("hex");
  const t0 = "2026-09-22T09:00:00.000Z";
  expect(measures(on)).toEqual([
    { draft_hash: draftHash, kind: "draft-opened", at: t0 },
    { draft_hash: draftHash, kind: "sent", at: t0 },
    {
      draft_hash: draftHash,
      kind: "correction",
      at: "2026-09-22T09:01:01.000Z",
    },
  ]);
  const stored = JSON.stringify(measures(on));
  for (const value of [ATLAS_ID, "Payroll", "hr-de", os.submissionId])
    expect(stored).not.toContain(value);
  // A draft that already holds details was not opened empty: no start.
  const started = harness({ metrics: true });
  await started.status(false);
  expect(measures(started)).toEqual([]);
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

test("a promoted request FlightDeck withholds says which fix it needs: re-mint the credential, or share the workspace", async () => {
  const cases = [
    {
      name: "promotedWithheldScope",
      reasonCode: "credential_scope",
      notice: /read:context/,
    },
    {
      name: "promotedWithheldNotShared",
      reasonCode: "destination_not_shared",
      notice: /not shared with Atlas/,
    },
    // An OS from before the cause word: the old reading stands.
    {
      name: "promotedNotShared",
      reasonCode: "destination_not_shared",
      notice: /not shared with Atlas/,
    },
  ];
  for (const c of cases) {
    const h = harness();
    await h.route.POST(sendTo("hr-de"), ATLAS_ID);
    h.fake.onRead = h.readAs(c.name);
    h.tick(61_000);
    const held = await h.status();
    expect(held.operation, c.name).toMatchObject({
      state: "filed",
      stage: "submitted",
      reasonCode: c.reasonCode,
    });
    expect(held.notice, c.name).toMatch(c.notice);
    expect(held.link, c.name).toBeNull();
    if (c.reasonCode === "credential_scope")
      expect(held.notice).not.toMatch(/not shared/);
    expect(h.store.links(), c.name).toEqual([]);
  }
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

// The reviewer note (D-037 item 5, DPO signed off; onb-atlas-decision-note).
// FlightDeck returns it on a needs-more-info read-back while its
// features.decisionNote is on; Atlas keeps it only on that send's
// needs-more-info transition row, and only while the send is the project's
// current one.
const NOTE = "Please name the <b>site</b> and the data owner's role.";
/** Every value in every table of the database, as one string: a note that
 * leaked into another table or column shows up here. */
function everything(store: ReturnType<typeof onboardDb>) {
  const tables = store.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  return tables
    .map(({ name }) =>
      JSON.stringify(store.sqlite.prepare(`SELECT * FROM "${name}"`).all()),
    )
    .join("\n");
}
function withNote(h: ReturnType<typeof harness>, fields: unknown) {
  h.fake.onRead = async () => ({
    state: "ok",
    data: parseSubmissionStatus(
      {
        ...readBack("needsMoreInfo"),
        outcome: { reasonCode: "needs-more-info", note: NOTE, fields },
      },
      { onUnknownFieldPointers: () => {} },
    )!,
  });
}
const noteRows = (store: ReturnType<typeof onboardDb>) =>
  store.sqlite
    .prepare(
      "SELECT stage,note,fields FROM atlas_flightdeck_transitions WHERE note IS NOT NULL OR fields IS NOT NULL",
    )
    .all();

test("a needs-more-info note and its allowlisted fields are kept on the transition row only, shown to requester and Super Admin, never in a notice", async () => {
  const h = harness();
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  withNote(h, ["site", "ownerRoles", "requestedBy", "sponsor.name", 7]);
  h.tick(61_000);
  const admin = await h.status();
  expect(admin.operation).toMatchObject({
    stage: "needs-more-info",
    note: NOTE,
    fields: ["site", "ownerRoles"],
  });
  expect(admin.notice ?? "").not.toContain("site");
  // Stored once, on the needs-more-info transition, and nowhere else.
  expect(noteRows(h.store)).toEqual([
    {
      stage: "needs-more-info",
      note: NOTE,
      fields: JSON.stringify(["site", "ownerRoles"]),
    },
  ]);
  const all = everything(h.store);
  expect(all.split("name the <b>site</b>").length).toBe(2);
  expect(JSON.stringify(h.store.ops())).not.toContain("name the");
  // The requester reads the note from the projection (never the OS).
  h.as("user-2", false);
  const editor = await h.status(false);
  expect(editor.operation).toMatchObject({
    note: NOTE,
    fields: ["site", "ownerRoles"],
  });
  expect(editor.notice).toBeNull();
  // The list carries stages only.
  h.as("user-1", true);
  const list = await h.route.LIST(listRequest(true));
  expect(await list.text()).not.toContain("name the");
  // A needs-more-info answer without a note (feature off in FlightDeck):
  // no note keys at all, today's answer.
  const plain = harness();
  await plain.route.POST(sendTo("hr-de"), ATLAS_ID);
  plain.fake.onRead = plain.readAs("needsMoreInfo");
  plain.tick(61_000);
  const off = await plain.status();
  expect(off.operation?.stage).toBe("needs-more-info");
  expect(off.operation).not.toHaveProperty("note");
  expect(off.operation).not.toHaveProperty("fields");
  expect(noteRows(plain.store)).toEqual([]);
});

test("the note goes with its send: a new send of the project, a later stage of the send, and a project delete each delete it", async () => {
  // A new send of the project (the corrected request) supersedes it.
  const resent = harness();
  await resent.route.POST(sendTo("hr-de"), ATLAS_ID);
  withNote(resent, ["summary"]);
  resent.tick(61_000);
  expect((await resent.status()).operation?.note).toBe(NOTE);
  resent.fake.onSubmit = async () => ({
    state: "ok",
    data: {
      submissionId: os.otherSubmissionId,
      receivedAt: os.receivedAt,
      payloadSha256: os.payloadSha256,
      duplicate: false,
    },
  });
  expect((await resent.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(noteRows(resent.store)).toEqual([]);
  expect(everything(resent.store)).not.toContain("name the");
  expect((await resent.status(false)).operation).not.toHaveProperty("note");

  // The send moves on (closed, or sent again): the note is deleted.
  const moved = harness();
  await moved.route.POST(sendTo("hr-de"), ATLAS_ID);
  withNote(moved, ["summary"]);
  moved.tick(61_000);
  await moved.status();
  const sendId = String(moved.store.ops()[0].id);
  expect(
    await applyObservedStage(
      moved.store.db,
      sendId,
      "closed",
      new Date().toISOString(),
      "atlas",
    ),
  ).toBe(true);
  expect(noteRows(moved.store)).toEqual([]);
  expect(everything(moved.store)).not.toContain("name the");

  // The project is deleted: the send, its log and the note go with it.
  const gone = harness();
  await gone.route.POST(sendTo("hr-de"), ATLAS_ID);
  withNote(gone, ["summary"]);
  gone.tick(61_000);
  await gone.status();
  expect(noteRows(gone.store)).toHaveLength(1);
  expect(await deleteProject(gone.store.db, ATLAS_ID, readyProject().revision)).toBe(
    "deleted",
  );
  expect(everything(gone.store)).not.toContain("name the");
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

  // FlightDeck already holds a request for this subject, one Atlas has no
  // record of: adopt it once the read-back proves it is this project's,
  // without sending again. The read-back does not say where it was sent or
  // which revision it carries, so Atlas claims neither: not the te-ops this
  // request named, and not revision 7.
  h.fake.onSubmit = async () => ({
    state: "already_submitted",
    submissionId: os.submissionId,
    osState: "filed",
  });
  const adopted = await h.route.POST(sendTo("te-ops"), ATLAS_ID);
  expect(adopted.status).toBe(202);
  expect(h.store.ops()[1]).toMatchObject({
    state: "filed",
    submission_id: os.submissionId,
    received_at: os.receivedAt,
    adopted: 1,
    request_body: null,
  });
  expect(h.store.ops()[1].idempotency_key).not.toBe(
    h.store.ops()[0].idempotency_key,
  );
  expect((await h.status(false)).operation).toMatchObject({
    stage: "submitted",
    adopted: true,
    destinationWorkspaceId: null,
    atlasRevision: null,
  });
  // Once promoted, the link takes FlightDeck's workspace and no revision.
  h.fake.onRead = h.readAs("promoted");
  h.fake.projects["hr-de"] = structuredClone(os.context.projectsAfterPromotion);
  h.tick(61_000);
  expect((await h.status()).link).toMatchObject({ workspaceId: "hr-de" });
  expect(h.store.links()).toEqual([
    expect.objectContaining({ workspace_id: "hr-de", source_revision: null }),
  ]);

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

test("an unreadable OS lock keeps the reservation and asks for an operator; a key FlightDeck holds for another project closes the send", async () => {
  // lock_unreadable: FlightDeck cannot tell whether it holds this request,
  // so Atlas keeps the key, and says who has to act.
  const locked = harness();
  locked.fake.onSubmit = async () => ({ state: "lock_unreadable" });
  const first = await locked.route.POST(sendTo("hr-de"), ATLAS_ID);
  expect(first.status).toBe(409);
  const body = (await first.json()) as { code: string; error: string };
  expect(body.code).toBe("lock_unreadable");
  expect(body.error).toMatch(/operator/);
  expect(locked.store.ops()).toEqual([
    expect.objectContaining({
      state: "reserved",
      reason_code: "lock_unreadable",
    }),
  ]);
  expect(await locked.status(false)).toMatchObject({
    retryPending: true,
    canClose: true,
  });
  // Once the operator has fixed the lock, the retry reuses the same key.
  locked.fake.onSubmit = duplicateReceipt;
  expect((await locked.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(202);
  expect(locked.fake.submits[1].payload.idempotencyKey).toBe(
    locked.fake.submits[0].payload.idempotencyKey,
  );
  expect(locked.store.ops()).toEqual([
    expect.objectContaining({ state: "filed", reason_code: null }),
  ]);

  // idempotency_key_conflict: this key names another Atlas project in
  // FlightDeck, so nothing of this project was filed under it — first
  // attempt or retry. The send closes, and the next one takes a fresh key.
  for (const retry of [false, true]) {
    const clash = harness();
    if (retry) {
      clash.fake.onSubmit = async () => ({ state: "os_unreachable" });
      await clash.route.POST(sendTo("hr-de"), ATLAS_ID);
    }
    clash.fake.onSubmit = async () => ({ state: "idempotency_key_conflict" });
    const refused = await clash.route.POST(sendTo("hr-de"), ATLAS_ID);
    expect(refused.status, `retry=${retry}`).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "idempotency_key_conflict",
    });
    expect(clash.store.ops()).toEqual([
      expect.objectContaining({
        state: "refused",
        reason_code: "idempotency_key_conflict",
        request_body: null,
      }),
    ]);
    clash.fake.onSubmit = async () => ({
      state: "ok",
      data: {
        submissionId: os.submissionId,
        receivedAt: os.receivedAt,
        payloadSha256: os.payloadSha256,
        duplicate: false,
      },
    });
    expect((await clash.route.POST(sendTo("hr-de"), ATLAS_ID)).status).toBe(
      202,
    );
    const [closed, fresh] = clash.store.ops();
    expect(fresh.idempotency_key).not.toBe(closed.idempotency_key);
  }
});

test("the stage list returns stored states for visible projects, and only a Super Admin refresh reads the OS", async () => {
  const h = harness();
  await h.route.POST(sendTo("hr-de"), ATLAS_ID);
  h.fake.calls.length = 0;
  const response = await h.route.LIST(listRequest(false));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    stages: { [ATLAS_ID]: "submitted" },
    checked: { [ATLAS_ID]: os.receivedAt },
    retryAfter: null,
  });
  // FlightDeck asks for more information. Nobody has the form open.
  h.fake.onRead = h.readAs("needsMoreInfo");
  h.tick(5 * 60_000);
  expect((await h.list(false)).stages[ATLAS_ID]).toBe("submitted");
  // A member's list never reads the OS, and a refresh is same-origin only.
  h.as("member-1", false);
  expect((await h.list(true)).stages[ATLAS_ID]).toBe("submitted");
  const crossSite = await h.route.LIST(
    listRequest(true, { "Sec-Fetch-Site": "cross-site" }),
  );
  expect(crossSite.status).toBe(403);
  expect(h.fake.calls).toEqual([]);
  // The Super Admin's list (and the dashboard, which reads it) checks the
  // send, so every list in Atlas follows FlightDeck.
  h.as("user-1");
  const followed = await h.list(true);
  expect(followed.stages[ATLAS_ID]).toBe("needs-more-info");
  expect(followed.checked[ATLAS_ID]).toBe("2026-09-22T09:05:00.000Z");
  expect(h.fake.calls).toEqual([`read:${os.submissionId}`]);
  h.as("member-1", false);
  expect((await h.list(false)).stages[ATLAS_ID]).toBe("needs-more-info");
});

test("a list refresh checks at most two due sends a call, longest unchecked first, each at most every five minutes", async () => {
  const h = harness({ project: null });
  const ids = [1, 2, 3, 4, 5].map(
    (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-2222-4333-8444-555555555555`,
  );
  const submission = (n: number) => String(n).repeat(24);
  // Checked 20, 10, never, 30 minutes ago and just now; the fifth project's
  // send is not visible to the caller.
  const checked = [
    "2026-09-22T08:40:00.000Z",
    "2026-09-22T08:50:00.000Z",
    null,
    "2026-09-22T08:30:00.000Z",
    "2026-09-22T09:00:00.000Z",
  ];
  ids.forEach((id, i) => h.fileOther(id, submission(i + 1), checked[i]));
  h.fake.visible.push(...ids.slice(0, 4));
  h.fake.onRead = async (id) => {
    const r = await h.readAs("filed")();
    const n = Number(id[0]);
    return r.state === "ok"
      ? {
          ...r,
          data: { ...r.data, submissionId: id, subject: `atlas-${ids[n - 1]}` },
        }
      : r;
  };
  const reads = () => h.fake.calls.filter((c) => c.startsWith("read:"));
  await h.list(true);
  expect(reads()).toEqual([`read:${submission(3)}`, `read:${submission(4)}`]);
  await h.list(true);
  expect(reads().slice(2)).toEqual([
    `read:${submission(1)}`,
    `read:${submission(2)}`,
  ]);
  // Every visible send was checked within five minutes: nothing is read.
  await h.list(true);
  expect(reads()).toHaveLength(4);
  // A rate limit stops the round and is passed on.
  h.tick(5 * 60_000);
  h.fake.onRead = async () => ({ state: "rate_limited", retryAfter: 30 });
  const busy = await h.list(true);
  expect(busy.retryAfter).toBe(30);
  expect(reads()).toHaveLength(5);
  expect(reads().some((r) => r.endsWith(submission(5)))).toBe(false);
});

// ── Browser: the To FlightDeck form over the running Atlas ────────────────

// These tests write to the dev server's own database — the one the owner's
// Atlas reads — so a project left behind is not just a red suite, it shows up
// in Connections → To FlightDeck beside real projects. A test that runs out of
// time never reaches its own `finally`: Playwright has already closed the
// page, so `removeProject` cannot run. Two habits keep that from compounding.
// Every project this file creates carries a token unique to the run, so a
// leftover can never collide with a later run and resolve a row locator to
// four elements; and the sweep below deletes anything an earlier run left,
// before the first test and again after the last.
// Playwright's 30 s default is a budget for browser interactions. These tests
// drive the dev server end to end — Vite, workerd and the local D1 — and the
// longest of them saves from a second tab three times over. On a loaded
// machine that runs out, and running out is expensive here: the page closes
// before the test's own `finally`, so the project it made is left behind.
test.describe.configure({ timeout: 90_000 });

const QA_MARK = " QA ";
const RUN_TOKEN = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const qa = (name: string) => `${name}${QA_MARK}${RUN_TOKEN}`;
async function sweepQaProjects(browser: Browser) {
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
test.beforeAll(async ({ browser }) => sweepQaProjects(browser));
test.afterAll(async ({ browser }) => sweepQaProjects(browser));

/** Opens the To FlightDeck tab and waits until it is really the open one.
 * The button is there and clickable before React has hydrated the page, so a
 * single click straight after a reload can be swallowed: the list then stays
 * on From FlightDeck, and everything the test asks about the row is missing
 * for a reason that has nothing to do with what it is testing. */
async function openToFlightDeck(page: Page) {
  const tab = page.getByRole("button", { name: /To FlightDeck/ });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true", {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
}

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
async function updateProject(
  page: Page,
  project: Project,
  fields: Partial<Project>,
) {
  return page.evaluate(
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
/** The onboarding form's named step (the guided stepper). */
const stepButton = (row: ReturnType<Page["locator"]>, name: string) =>
  row
    .getByRole("navigation", { name: "Onboarding steps" })
    .getByRole("button", { name, exact: true });
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
    closed: "refused",
  } as const;
  return {
    operation: stage
      ? {
          state: state[stage],
          stage,
          destinationWorkspaceId: "hr-de",
          submittedAt: os.receivedAt,
          reasonCode:
            stage === "needs-more-info"
              ? "needs-more-info"
              : stage === "closed"
                ? "abandoned"
                : null,
          setupState:
            stage === "setup-in-progress"
              ? "awaiting-cowork"
              : stage === "setup-complete"
                ? "complete"
                : stage === "linked"
                  ? "none"
                  : null,
          atlasRevision: 2,
          adopted: false,
          updatedAt: os.receivedAt,
          checkedAt: null,
        }
      : null,
    link: null,
    pendingPayload: null,
    canSend:
      !stage ||
      ["needs-more-info", "rejected", "not-sent", "closed"].includes(stage),
    canClose: false,
    retryPending: false,
    // What the server itself calls pollable: filed, promoted, or linked
    // before setup is complete.
    pollable:
      !!stage &&
      ["submitted", "linked", "setup-in-progress"].includes(stage as string),
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
  expect(
    (
      await request.post(`/api/flightdeck/onboard/${ATLAS_ID}/close`, {
        data: { updatedAt: new Date().toISOString() },
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
  const project = await createProject(page, { name: qa("Bridge") });
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Bridge"),
    });
    await row
      .getByRole("button", { name: "Prepare onboarding", exact: true })
      .click();
    await page.getByLabel("Proposed OS project name").fill("Operations pilot");
    await page
      .getByLabel("Preferred workspace (optional)")
      .fill("Operations Europe");
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(
      row.getByText("Draft prepared", { exact: true }),
    ).toBeVisible();
    // The badge follows client state; the reload below reads the database, so
    // wait for the save itself to be confirmed before throwing the page away.
    await expect(
      page.getByRole("status").filter({ hasText: "Onboarding draft saved" }),
    ).toBeVisible();
    await page.reload();
    await openToFlightDeck(page);
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
      const list = await fetch("/api/flightdeck/onboard?refresh=1");
      const close = await fetch(`/api/flightdeck/onboard/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updatedAt: new Date().toISOString() }),
      });
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
        listBody: await list.text(),
        close: close.status,
        closeBody: await close.text(),
        onboard: onboard.status,
        onboardBody: await onboard.text(),
        imported: imported.status,
      };
    }, project.id);
    expect(responses).toMatchObject({
      status: 200,
      list: 200,
      close: 409,
      onboard: 415,
      imported: 503,
    });
    // Nothing was sent, so there is nothing to close.
    expect(JSON.parse(responses.closeBody)).toMatchObject({
      code: "not_closable",
    });
    expect(
      onboardStagesSchema.parse(JSON.parse(responses.listBody)).stages,
    ).not.toHaveProperty(project.id);
    expect(
      onboardingStatusSchema.parse(JSON.parse(responses.statusBody)),
    ).toMatchObject({ operation: null, link: null });
    for (const text of [
      responses.statusBody,
      responses.onboardBody,
      responses.listBody,
      responses.closeBody,
    ])
      expect(text).not.toMatch(/token|bearer|ATLAS_FLIGHTDECK|INBOUND/i);
    await row.getByRole("button", { name: "Remove draft" }).click();
    await expect(row.getByText("Not prepared", { exact: true })).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

test("the guided stepper prefills Basics, meters readiness, lists every field sent and follows the status", async ({
  page,
}) => {
  await page.clock.install();
  await mockContext(page);
  await page.goto("/?view=connection");
  const idea = opportunities.find((o) => o.id === "hr-onboarding")!;
  const project = await createProject(page, {
    name: qa("Onboarding"),
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
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Onboarding"),
    });
    await row
      .getByRole("button", { name: "Prepare onboarding", exact: true })
      .click();
    const steps = row.getByRole("navigation", { name: "Onboarding steps" });
    await expect(steps.getByRole("button")).toHaveText([
      "1Basics",
      "2FlightDeck details",
      "3Apps (optional)",
      "4AI agents (locked)",
      "5Review & send",
    ]);
    await expect(stepButton(row, "Basics")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(steps.locator('[aria-current="step"]')).toHaveCount(1);
    // Basics is prefilled from the Atlas project.
    await expect(row.getByLabel("Proposed OS project name")).toHaveValue(
      qa("Onboarding"),
    );
    await expect(row.getByLabel("Summary")).toHaveValue(
      "Guide new HR users through approved tools.",
    );
    await expect(row.getByLabel("Function area")).toHaveValue("HR");
    const meter = row.getByRole("meter", {
      name: "Required FlightDeck details",
    });
    // Label, function area, category and summary are prefilled. The
    // destination is the Super Admin's own item and joins on Review only.
    await expect(meter).toHaveAttribute("aria-valuetext", "4 of 8 required");
    // A missing item links straight to its field.
    await row
      .getByRole("list", { name: "Missing details" })
      .getByRole("button", { name: "Country" })
      .click();
    await expect(stepButton(row, "FlightDeck details")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(row.getByLabel("Country")).toBeFocused();
    // The checklist offers role titles and the pilot's success measure.
    await row
      .getByRole("button", { name: "Apply checklist suggestions" })
      .click();
    await expect(meter).toHaveAttribute("aria-valuetext", "5 of 8 required");
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
    await expect(meter).toHaveAttribute("aria-valuetext", "8 of 8 required");
    await stepButton(row, "Review & send").click();
    await expect(meter).toHaveAttribute("aria-valuetext", "8 of 9 required");
    const sendButton = row.getByRole("button", { name: "Send to FlightDeck" });
    // Unsaved edits are never what gets sent.
    await expect(sendButton).toBeDisabled();
    await row.getByRole("button", { name: "Save now" }).click();
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
    await stepButton(row, "Basics").click();
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

test("the stepper counts an editor's own items, Next stops with a focused error summary, and a missing item opens its step", async ({
  page,
}) => {
  await mockContext(page);
  // View the form as an editor: the same page, with the Super Admin flag off.
  await page.route(/\/api\/projects(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { access?: { superAdmin: boolean } };
    return route.fulfill({
      response,
      json: {
        ...body,
        access: body.access && { ...body.access, superAdmin: false },
      },
    });
  });
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Stepper"),
    description: "",
    benefit: "",
    functionArea: "HR",
    category: "Consultancy pilot",
    onboardingStage: "Pilot",
  });
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusBody(null)),
    }),
  );
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Stepper"),
    });
    await row
      .getByRole("button", { name: "Prepare onboarding", exact: true })
      .click();
    const meter = row.getByRole("meter", {
      name: "Required FlightDeck details",
    });
    // Label, function area and category are prefilled: the editor's own
    // eight items, never the Super Admin's destination.
    await expect(meter).toHaveAttribute("aria-valuetext", "3 of 8 for you");
    await expect(meter).toContainText("3 of 8 for you");
    const missing = row.getByRole("list", { name: "Missing details" });
    await expect(missing).not.toContainText("Destination");
    // Next with missing details stays put and says which, in a focused alert.
    const next = row.getByRole("button", { name: "Next", exact: true });
    await next.click();
    const summary = row.getByRole("alert", {
      name: /Complete these details before going on/,
    });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("button")).toHaveText([
      "Summary",
      "Success measure",
    ]);
    await expect(stepButton(row, "Basics")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await row.screenshot({ path: shot("stepper-error-summary-1440.png") });
    await summary.getByRole("button", { name: "Success measure" }).click();
    await expect(row.getByLabel("Success measure")).toBeFocused();
    await row.getByLabel("Success measure").fill("Fewer tickets");
    await expect(summary.getByRole("button")).toHaveText(["Summary"]);
    await row.getByLabel("Summary").fill("Guide new HR users");
    await expect(summary).toHaveCount(0);
    await expect(meter).toHaveAttribute("aria-valuetext", "5 of 8 for you");
    await next.click();
    await expect(stepButton(row, "FlightDeck details")).toHaveAttribute(
      "aria-current",
      "step",
    );
    // A missing item on another step opens that step and focuses its field.
    await row.getByRole("button", { name: "Back", exact: true }).click();
    await missing
      .getByRole("button", { name: "Works council relevance" })
      .click();
    await expect(stepButton(row, "FlightDeck details")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(row.getByLabel("Works council relevant")).toBeFocused();
    await row.getByLabel("Country").selectOption("DE");
    await row.getByLabel("Works council relevant").selectOption("unknown");
    await row.getByLabel("Mark this project Ready for FlightDeck").check();
    await expect(meter).toHaveAttribute("aria-valuetext", "8 of 8 for you");
    // Apps and AI agents are placeholders that never block Next.
    await next.click();
    await expect(stepButton(row, "Apps (optional)")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(row.getByText(/not available yet/)).toBeVisible();
    await next.click();
    await expect(stepButton(row, "AI agents (locked)")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(row.getByText(/AI agents are locked/)).toBeVisible();
    await next.click();
    await expect(stepButton(row, "Review & send")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(next).toHaveCount(0);
    // On Review the editor still counts only their own items, sees no
    // workspace list, and cannot send (Decision 7).
    await expect(meter).toHaveAttribute("aria-valuetext", "8 of 8 for you");
    await expect(row.getByLabel("Destination workspace")).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Send to FlightDeck" }),
    ).toHaveCount(0);
  } finally {
    await removeProject(page, project.id);
  }
});

test("a project FlightDeck has created reads as held, not as a draft under review, and cannot be unpicked from the row", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Created"),
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Created"), workspaceHint: "hr-de" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  await page.route(
    (url) => url.pathname === "/api/flightdeck/onboard",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stages: { [project.id]: "setup-complete" },
          checked: { [project.id]: null },
          retryAfter: null,
        }),
      }),
  );
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        statusBody("setup-complete", {
          link: {
            workspaceId: "hr-de",
            osProjectId: "created-qa",
            linkedAt: os.receivedAt,
            accessState: "active",
          },
        }),
      ),
    }),
  );
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Created"),
    });
    await expect(
      row.getByText("Setup complete", { exact: true }),
    ).toBeVisible();
    // The project exists in FlightDeck: the row must not offer to drop the
    // draft it was created from, and must not call reading it "editing".
    await expect(
      row.getByRole("button", { name: "Remove draft" }),
    ).toBeDisabled();
    await expect(
      row.getByRole("button", { name: "Remove draft" }),
    ).toHaveAccessibleDescription(/linked to a FlightDeck project/i);
    await expect(
      row.getByRole("button", { name: "Edit draft", exact: true }),
    ).toHaveCount(0);
    await row.getByRole("button", { name: "View status", exact: true }).click();
    // The form is read-only, and says why instead of leaving it unexplained.
    await expect(
      row.getByText(
        "Linked to FlightDeck project created-qa in HR Germany. FlightDeck holds this project now, so the Atlas draft is kept as it was sent.",
        { exact: false },
      ),
    ).toBeVisible();
    await stepButton(row, "Basics").click();
    await expect(row.getByLabel("Summary")).toBeDisabled();
    await expect(
      row.getByRole("button", { name: "Save now" }),
    ).toBeDisabled();
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
    name: qa("Reopen"),
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Reopen"), workspaceHint: "" },
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
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Reopen"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    await expect(
      row.getByText("FlightDeck asked for more information", { exact: false }),
    ).toBeVisible();
    await expect(row.getByLabel("Summary")).toBeEnabled();
    await row.getByLabel("Summary").fill("Summary with the missing detail.");
    await row.getByRole("button", { name: "Save now" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Onboarding draft saved" }),
    ).toBeVisible();
    await stepButton(row, "Review & send").click();
    await row.getByLabel("Destination workspace").selectOption("hr-de");
    await expect(
      row.getByRole("button", { name: "Send to FlightDeck" }),
    ).toBeEnabled();
  } finally {
    await removeProject(page, project.id);
  }
});

test("needs more info shows the reviewer note as plain text, outlines the pointed fields and badges their steps", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Note"),
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Note"), workspaceHint: "" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  const body = statusBody("needs-more-info");
  body.operation = {
    ...body.operation!,
    note: "Please name the <b>site</b>.\nAnd the country.",
    fields: ["site", "countryCode"],
  };
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Note"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    const callout = row.getByRole("note", { name: "Reviewer's note" });
    await expect(callout).toBeVisible();
    // A text node: the markup is shown, never parsed.
    await expect(callout).toContainText("Please name the <b>site</b>.");
    await expect(callout.locator("b")).toHaveCount(0);
    await expect(
      callout.getByRole("list", { name: "Fields to check" }).getByRole("button"),
    ).toHaveText(["Site", "Country"]);
    // The pointed field is outlined and marked invalid; others are not.
    await expect(row.locator("#fd-site")).toHaveAttribute("aria-invalid", "true");
    await expect(row.locator("#fd-summary")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    const outline = await row
      .locator("#fd-site")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    // Each step holding a pointed field is badged, the others are not.
    const steps = row.getByRole("navigation", { name: "Onboarding steps" });
    await expect(steps.locator(".fd-step-flag")).toHaveCount(2);
    await expect(
      steps.locator("#fd-step-basics .fd-step-flag"),
    ).toHaveCount(1);
    await expect(
      steps.locator("#fd-step-details .fd-step-flag"),
    ).toHaveCount(1);
    await expect(steps.locator("#fd-step-apps .fd-step-flag")).toHaveCount(0);
    // A field in the list opens its step and focuses it.
    await callout.getByRole("button", { name: "Country" }).click();
    await expect(row.locator("#fd-step-details")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(row.locator("#fd-step-basics .fd-step-flag")).toHaveText(
      "needs a fix",
    );
    await expect(row.locator("#fd-country")).toBeFocused();
    await expect(row.locator("#fd-country")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await row.screenshot({ path: shot("decision-note-1440.png") });
  } finally {
    await removeProject(page, project.id);
  }
});

test("the Super Admin can close an unconfirmed send from the form, and the draft opens again", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Close"),
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Close"), workspaceHint: "" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  const pendingPayload = buildOnboardingPayload({
    project,
    destinationWorkspaceId: "hr-de",
    idempotencyKey: KEY,
    installationId: "atlas-local",
    requestedBy: HASH,
  });
  let status = statusBody("not-confirmed", {
    retryPending: true,
    canSend: true,
    canClose: true,
    pendingPayload,
  });
  status = {
    ...status,
    operation: {
      ...status.operation!,
      atlasRevision: project.revision,
      reasonCode: "invalid_submission",
    },
  };
  const closes: unknown[] = [];
  const sends: unknown[] = [];
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) => {
    const r = route.request();
    if (r.method() === "POST") {
      if (new URL(r.url()).pathname.endsWith("/close")) {
        closes.push(r.postDataJSON());
        status = statusBody("closed");
      } else sends.push(r.postDataJSON());
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status),
    });
  });
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Close"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    // Locked while the send is unconfirmed; Retry is the normal way on.
    await expect(
      row.getByRole("button", { name: "Save now" }),
    ).toBeDisabled();
    await stepButton(row, "Review & send").click();
    await expect(row.getByRole("button", { name: "Retry send" })).toBeEnabled();
    // Closing asks first and says what it means.
    await row
      .getByRole("button", { name: "Close this unconfirmed send" })
      .click();
    await expect(
      row.getByText(/if FlightDeck did file it, the next send follows/i),
    ).toBeVisible();
    await row.getByRole("button", { name: "Keep it", exact: true }).click();
    expect(closes).toEqual([]);
    await row
      .getByRole("button", { name: "Close this unconfirmed send" })
      .click();
    await row
      .getByRole("button", { name: "Close the send", exact: true })
      .click();
    await expect.poll(() => closes).toEqual([{ updatedAt: os.receivedAt }]);
    expect(sends).toEqual([]);
    await expect(
      row.getByText(/closed this unconfirmed send/i).first(),
    ).toBeVisible();
    // The row's badge and the form's timeline both say so.
    await expect(
      row.locator("span.status", { hasText: "Send closed" }),
    ).toBeVisible();
    await expect(
      row
        .getByRole("list", { name: "FlightDeck status" })
        .locator('li[aria-current="step"]'),
    ).toHaveText("Send closed");
    await expect(
      row.getByRole("button", { name: "Close this unconfirmed send" }),
    ).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Save now" }),
    ).toBeEnabled();
    await expect(
      row.getByRole("region", { name: "What will be sent" }),
    ).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

test("the To FlightDeck list and the dashboard follow FlightDeck without the form open, and say when it last checked", async ({
  page,
}) => {
  await page.clock.install();
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Follow"),
    functionArea: "HR",
    flightdeckDraft: { label: qa("Follow"), workspaceHint: "" },
  });
  let stage = "submitted";
  let checkedAt: string | null = null;
  const lists: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/flightdeck/onboard",
    (route) => {
      lists.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stages: { [project.id]: stage },
          checked: { [project.id]: checkedAt },
          retryAfter: null,
        }),
      });
    },
  );
  const forms: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(`/api/flightdeck/onboard/${project.id}`))
      forms.push(r.url());
  });
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Follow"),
    });
    await expect(row.getByText("Submitted", { exact: true })).toBeVisible();
    await expect(
      row.getByText("Not checked with FlightDeck yet", { exact: true }),
    ).toBeVisible();
    // The Super Admin's list asks the server to check FlightDeck.
    await expect
      .poll(() => lists.map((u) => new URL(u).search).at(-1))
      .toBe("?refresh=1");
    stage = "linked";
    checkedAt = "2026-09-22T09:05:00.000Z";
    await page.clock.fastForward(61_000);
    await expect(row.getByText("Linked", { exact: true })).toBeVisible();
    await expect(row.getByText(/^Last checked with FlightDeck/)).toBeVisible();
    stage = "needs-more-info";
    await page.clock.fastForward(61_000);
    await expect(
      row.getByText("Needs more info", { exact: true }),
    ).toBeVisible();
    // The form was never opened, and never asked.
    await expect(
      row.getByRole("navigation", { name: "Onboarding steps" }),
    ).toHaveCount(0);
    expect(forms).toEqual([]);
    // The dashboard card reads the same list.
    await page.goto("/");
    await expect(
      page.getByText(
        "Onboarding: 1 sent to FlightDeck, 0 linked, 1 need more info.",
      ),
    ).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

test("the dashboard counts every request FlightDeck filed as sent, answered ones included", () => {
  const cases: [OnboardingStage[], string][] = [
    [[], "Onboarding: no project sent yet. Prepare one in To FlightDeck."],
    [["rejected"], "Onboarding: 1 sent to FlightDeck, 0 linked, 1 declined."],
    [
      ["rejected", "not-confirmed"],
      "Onboarding: 1 sent to FlightDeck, 0 linked, 1 declined, 1 awaiting confirmation.",
    ],
    [
      ["needs-more-info"],
      "Onboarding: 1 sent to FlightDeck, 0 linked, 1 need more info.",
    ],
    [
      ["submitted", "linked", "setup-in-progress", "setup-complete"],
      "Onboarding: 4 sent to FlightDeck, 3 linked.",
    ],
    [
      ["not-sent", "closed"],
      "Onboarding: 0 sent to FlightDeck, 0 linked, 1 not sent, 1 closed before FlightDeck confirmed.",
    ],
  ];
  for (const [stages, line] of cases)
    expect(onboardingSummaryLine(stages), stages.join(",")).toBe(line);
  // Every stage is counted somewhere: none can make a project vanish.
  for (const stage of onboardingStages)
    expect(onboardingSummaryLine([stage]), stage).toMatch(/[1-9]/);
});

test("one lock for both surfaces: every state the form locks shows a stage the row locks, with a reason", () => {
  // The form knows the operation state, the list row knows only the stage.
  // They must answer the same question the same way for every operation a
  // status read-back can describe, or the row offers what the form forbids.
  const reasons = [null, ...rejectionReasons, "abandoned", "os_unreachable"];
  const setups = [null, ...setupStates];
  const produced = new Set<OnboardingStage>();
  for (const state of operationStates)
    for (const setupState of setups)
      for (const reasonCode of reasons) {
        const stage = stageFor({ state, reasonCode, setupState });
        if (isLockedState(state)) produced.add(stage);
        expect({
          state,
          setupState,
          reasonCode,
          locked: isDraftLocked(stage),
          // A locked stage always says why; an open one never claims to.
          reason: !!lockNote(stage),
        }).toEqual({
          state,
          setupState,
          reasonCode,
          locked: isLockedState(state),
          reason: isLockedState(state),
        });
      }
  // The derived list, pinned: a new branch in stageFor() has to be answered
  // here and in LOCK_NOTE rather than quietly unlocking a row.
  expect([...lockedStages].sort()).toEqual([
    "linked",
    "not-confirmed",
    "setup-complete",
    "setup-in-progress",
    "submitted",
  ]);
  expect([...lockedStages].sort()).toEqual([...produced].sort());
  // Saying when Atlas last checked is a smaller set than being locked: a
  // status that can still move on its own is always a locked draft.
  for (const stage of movingStages) expect(isDraftLocked(stage)).toBe(true);
  expect(movingStages.some((s) => !lockedStages.includes(s))).toBe(false);
  // And that smaller set is the server's own: the row promises "last
  // checked" for exactly the sends the server still reads back.
  for (const state of operationStates)
    for (const setupState of setups)
      expect({
        state,
        setupState,
        moving: isStatusMoving(
          stageFor({ state, reasonCode: null, setupState }),
        ),
      }).toEqual({
        state,
        setupState,
        moving: isPollable({ state, setup_state: setupState }),
      });
  // "FlightDeck is reviewing this" is never said of a created project.
  expect(lockNote("setup-complete")).toMatch(/linked to a FlightDeck project/i);
  expect(lockNote("not-confirmed")).toMatch(/not confirmed/i);
  expect(lockNote("needs-more-info")).toBe("");
});

test("the list cannot remove a draft FlightDeck is still reviewing, and offers the status instead", async ({
  page,
}) => {
  await page.clock.install();
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Locked Row"),
    functionArea: "HR",
    // No planning note: the subtitle then has to say something of its own,
    // which is where it used to claim a workspace was still to be chosen for
    // a project FlightDeck already held.
    flightdeckDraft: { label: qa("Locked Row"), workspaceHint: "" },
  });
  let stage = "submitted";
  await page.route(
    (url) => url.pathname === "/api/flightdeck/onboard",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stages: { [project.id]: stage },
          checked: { [project.id]: null },
          retryAfter: null,
        }),
      }),
  );
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Locked Row"),
    });
    await expect(row.getByText("Submitted", { exact: true })).toBeVisible();
    const remove = row.getByRole("button", { name: "Remove draft" });
    const edit = row.getByRole("button", { name: "Edit draft", exact: true });
    const status = row.getByRole("button", {
      name: "View status",
      exact: true,
    });
    // What the row says about the project, beside the badge. A project
    // FlightDeck holds is with FlightDeck; an open draft has yet to choose
    // where it goes, and it chooses that in Review & send, not by connecting.
    const subtitle = row.locator("p").first();
    // The form calls the draft locked for every state FlightDeck may hold —
    // unconfirmed, under review, linked and set up — and the row outside the
    // form must not be the way around that promise. Removing it would drop
    // the name FlightDeck is reviewing, break Export draft, drop the project
    // from this tab's count, and empty the draft a "Needs more info" reopens.
    for (const [locked, label] of [
      ["not-confirmed", "Not confirmed"],
      ["submitted", "Submitted"],
      ["linked", "Linked"],
      ["setup-in-progress", "Setup in progress"],
      ["setup-complete", "Setup complete"],
    ] as const) {
      stage = locked;
      await page.clock.fastForward(61_000);
      await expect(row.getByText(label, { exact: true })).toBeVisible();
      await expect(remove).toBeVisible();
      await expect(remove).toBeDisabled();
      // And it says why, in words true of that stage, on the row itself.
      await expect(remove).toHaveAccessibleDescription(lockNote(locked));
      await expect(
        row.getByText(lockNote(locked), { exact: true }),
      ).toBeVisible();
      await expect(edit).toHaveCount(0);
      await expect(status).toBeEnabled();
      // Never "choose a workspace" beside a project FlightDeck already holds.
      await expect(subtitle).toHaveText("HR · With FlightDeck");
      // Read-only export is untouched, and never calls it unsent.
      await expect(
        row.getByRole("button", { name: "Export draft" }),
      ).toBeEnabled();
      const exported = await exportText(page, row);
      expect(exported).toContain("Sent to FlightDeck");
      expect(exported).not.toContain("Not submitted");
      expect(exported).not.toContain("To select");
    }
    // Once FlightDeck hands it back, the row is the owner's again.
    for (const [open, label] of [
      ["needs-more-info", "Needs more info"],
      ["rejected", "Declined"],
      ["not-sent", "Not sent"],
      ["closed", "Send closed"],
    ] as const) {
      stage = open;
      await page.clock.fastForward(61_000);
      await expect(row.getByText(label, { exact: true })).toBeVisible();
      await expect(remove).toBeEnabled();
      await expect(edit).toBeEnabled();
      await expect(status).toHaveCount(0);
      // A draft FlightDeck handed back chooses its destination on the next
      // send; it is not a project that was never sent.
      await expect(subtitle).toHaveText(
        "HR · Destination chosen when you send again",
      );
    }
    // A planning note, where there is one, is shown as the owner wrote it.
    await updateProject(page, project, {
      flightdeckDraft: { label: qa("Locked Row"), workspaceHint: "hr-de" },
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(subtitle).toHaveText("HR · hr-de");
  } finally {
    await removeProject(page, project.id);
  }
});

/** Presses the row's Export draft and returns the file it downloads. */
async function exportText(page: Page, row: ReturnType<Page["locator"]>) {
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "Export draft" }).click();
  return readFileSync((await (await download).path())!, "utf8");
}

test("after a send the form shows where it went and which revision FlightDeck holds, never a missing destination", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const first = await createProject(page, {
    name: qa("Sent"),
    description: "Summary v1: contact alex@example.com",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Sent"), workspaceHint: "" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  const sentPayload = buildOnboardingPayload({
    project: first,
    destinationWorkspaceId: "hr-de",
    idempotencyKey: KEY,
    installationId: "atlas-local",
    requestedBy: HASH,
  });
  // Edited elsewhere in Atlas after the send: a new revision, clean text.
  const project = await updateProject(page, first, {
    description: "Summary v2: no personal data",
  });
  expect(project.revision).toBe(first.revision + 1);
  const op = { atlasRevision: first.revision, destinationWorkspaceId: "hr-de" };
  let status = statusBody("submitted");
  status = { ...status, operation: { ...status.operation!, ...op } };
  const posts: unknown[] = [];
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) => {
    if (route.request().method() === "POST")
      posts.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status),
    });
  });
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", { hasText: qa("Sent") });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    await expect(row.getByText(/Sent for review to HR Germany/)).toBeVisible();
    // Sent: nothing is "missing", and nothing claims to be about to be sent.
    await expect(row.getByRole("meter")).toHaveCount(0);
    await expect(
      row.getByRole("list", { name: "Missing details" }),
    ).toHaveCount(0);
    await stepButton(row, "Review & send").click();
    await expect(row.getByLabel("Destination workspace")).toHaveCount(0);
    await expect(
      row.getByRole("region", { name: "What will be sent" }),
    ).toHaveCount(0);
    const record = row.getByRole("region", { name: "Sent to FlightDeck" });
    await expect(record).toContainText("HR Germany");
    await expect(record).toContainText(`revision ${first.revision}`);
    await expect(record).toContainText(`now at revision ${project.revision}`);
    // In the panel's own type, not body size.
    await expect(record.locator("p")).toHaveCSS("font-size", "13px");
    await expect(row.getByText("Missing", { exact: true })).toHaveCount(0);
    // Export draft says what FlightDeck holds, not "Not submitted".
    await row.getByRole("button", { name: "Close", exact: true }).click();
    const exported = await exportText(page, row);
    expect(exported).toContain("Sent to workspace: hr-de");
    expect(exported).toContain(
      `Sent to FlightDeck (revision ${first.revision}, workspace hr-de) and under review there.`,
    );
    expect(exported).not.toContain("Not submitted");
    expect(exported).not.toContain("To select");

    // Not confirmed: Review lists exactly what Retry resends (revision 1,
    // with its email), says the later edit is not in it, and Retry names
    // that revision.
    status = statusBody("not-confirmed", {
      retryPending: true,
      canSend: true,
      pendingPayload: sentPayload,
    });
    status = { ...status, operation: { ...status.operation!, ...op } };
    await page.reload();
    await openToFlightDeck(page);
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    await expect(row.getByRole("meter")).toHaveCount(0);
    await stepButton(row, "Review & send").click();
    const resend = row.getByRole("region", { name: "What Retry send resends" });
    await expect(resend).toContainText("Summary v1: contact alex@example.com");
    await expect(resend).not.toContainText("Summary v2");
    await expect(row.getByText(/later edits are not included/i)).toBeVisible();
    await expect(row.getByText(/HR Germany/).first()).toBeVisible();
    await row.getByRole("button", { name: "Retry send" }).click();
    await expect
      .poll(() => posts)
      .toEqual([{ destinationWorkspaceId: "hr-de", revision: first.revision }]);
  } finally {
    await removeProject(page, project.id);
  }
});

test("a save elsewhere while the form is open refreshes Review, and an edited draft can neither overwrite it nor be sent", async ({
  page,
}) => {
  // The longest test here: three saves from another tab, each a real round
  // trip, plus a send. It is the one that ran out of the default budget; the
  // file's own budget above is set for it.
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Stale"),
    description: "Reviewed summary v1",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Stale"), workspaceHint: "" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  const posts: unknown[] = [];
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) => {
    if (route.request().method() === "POST")
      posts.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        statusBody(route.request().method() === "POST" ? "submitted" : null),
      ),
    });
  });
  // Atlas reloads its projects on focus (and every minute); this is the
  // same reload, without the wait.
  const reloadProjects = () =>
    page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const latest = async () =>
    page.evaluate(async (id) => {
      const body = (await (await fetch("/api/projects")).json()) as {
        projects: Project[];
      };
      return body.projects.find((p) => p.id === id)!;
    }, project.id);
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Stale"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();

    // Edited here, then saved elsewhere: the edits stay, both versions show
    // side by side, and neither Save nor Send may go ahead until the viewer
    // chooses Keep mine or Use theirs (onb-atlas-save-ux).
    await row.getByLabel("Summary").fill("My unsaved summary");
    const elsewhere = await updateProject(page, project, {
      description:
        "Changed by another editor: call Jane Doe on +49 151 23456789",
    });
    expect(elsewhere.revision).toBe(project.revision + 1);
    await reloadProjects();
    const conflict = row.getByRole("region", {
      name: `Someone else saved revision ${elsewhere.revision}`,
    });
    await expect(conflict).toBeVisible();
    const summaryRow = conflict.getByRole("row", { name: /Summary/ });
    await expect(summaryRow).toContainText("My unsaved summary");
    await expect(summaryRow).toContainText("Changed by another editor");
    await expect(row.getByLabel("Summary")).toHaveValue("My unsaved summary");
    await expect(row.getByRole("button", { name: "Save now" })).toBeDisabled();
    await stepButton(row, "Review & send").click();
    await row.getByLabel("Destination workspace").selectOption("hr-de");
    const sendButton = row.getByRole("button", { name: "Send to FlightDeck" });
    await expect(sendButton).toBeDisabled();
    await expect(
      row.getByText(/This project was saved elsewhere\. Choose Keep mine or Use theirs/),
    ).toBeVisible();
    expect((await latest()).description).toBe(elsewhere.description);

    // Use theirs loads the latest version: Review shows exactly what the
    // server would send, with the free-text warning for it.
    await conflict.getByRole("button", { name: "Use theirs" }).click();
    await expect(conflict).toHaveCount(0);
    const review = row.getByRole("region", { name: "What will be sent" });
    await expect(review).toContainText("Jane Doe");
    await expect(review).not.toContainText("My unsaved summary");
    await expect(
      row.getByText(/Summary is sent as written.*phone number/i),
    ).toBeVisible();

    // An untouched draft follows a save elsewhere on its own, and Send
    // confirms the revision Review shows.
    const third = await updateProject(page, elsewhere, {
      description: "Summary v3 from another tab",
    });
    await reloadProjects();
    await expect(review).toContainText("Summary v3 from another tab");
    await expect(review).not.toContainText("Jane Doe");
    await expect(
      row.getByText(
        new RegExp(
          `saved elsewhere, so this form now shows revision ${third.revision}`,
        ),
      ),
    ).toBeVisible();
    await expect(sendButton).toBeEnabled();
    await sendButton.click();
    await expect
      .poll(() => posts)
      .toEqual([{ destinationWorkspaceId: "hr-de", revision: third.revision }]);
  } finally {
    await removeProject(page, project.id);
  }
});

test("Review warns about personal details in free text and blocks them in every other field", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Privacy"),
    description: "Guide new HR users. Contact jane@example.com",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Privacy"), workspaceHint: "" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
  });
  await page.route(`**/api/flightdeck/onboard/${project.id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusBody(null)),
    }),
  );
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Privacy"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    await stepButton(row, "Review & send").click();
    const review = row.getByRole("region", { name: "What will be sent" });
    await expect(review).toContainText("Contact jane@example.com");
    await expect(
      row.getByText(/Summary is sent as written.*email address/i),
    ).toBeVisible();
    const never = row.getByRole("list", { name: "Never sent" });
    await expect(never).toContainText("Sponsor");
    await expect(never).not.toContainText(/any email address/i);
    await row.getByLabel("Destination workspace").selectOption("hr-de");
    const sendButton = row.getByRole("button", { name: "Send to FlightDeck" });
    await expect(sendButton).toBeEnabled();
    // A role title is never a person: an email there blocks the send.
    await stepButton(row, "FlightDeck details").click();
    await row.getByLabel("Process owner role").fill("jane@example.com");
    await expect(
      row.getByText(
        /Atlas will not send an email address or phone number here/,
      ),
    ).toBeVisible();
    await row.getByRole("button", { name: "Save now" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Onboarding draft saved" }),
    ).toBeVisible();
    await stepButton(row, "Review & send").click();
    await expect(sendButton).toBeDisabled();
    await expect(
      row.getByText(
        /Remove the email address or phone number from: Process owner \(role title\)/,
      ),
    ).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

// ---- W3 review round 3 -------------------------------------------------

/** Screenshots for review, kept with the test's own output. */
const shot = (name: string) => test.info().outputPath(name);
/** What a Remove draft button looks like, so a locked one can be told apart
 * from a live one without hovering. */
const looks = (button: ReturnType<Page["locator"]>) =>
  button.evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: Number(s.opacity), cursor: s.cursor };
  });
/** Serves the stage list: held until `release()`, then `stage`, or a failure
 * while `fail` is set. */
async function stageList(page: Page, projectId: string) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const state = { stage: "submitted" as OnboardingStage, fail: false };
  await page.route(
    (url) => url.pathname === "/api/flightdeck/onboard",
    async (route) => {
      await held;
      if (state.fail)
        return route.fulfill({ status: 503, body: "{}" }).catch(() => {});
      return route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            stages: { [projectId]: state.stage },
            checked: { [projectId]: null },
            retryAfter: null,
          }),
        })
        .catch(() => {});
    },
  );
  return { state, release };
}

test("every stage has a place on the status timeline, and an answered request shows it was submitted", () => {
  const answered = ["needs-more-info", "rejected"];
  const filed = ["linked", "setup-in-progress", "setup-complete", ...answered];
  for (const stage of onboardingStages) {
    const steps = timelineSteps(stage);
    // The stage the project is in is always the one step marked current:
    // never a timeline with nothing on it.
    expect({
      stage,
      current: steps.filter((s) => s.state === "current").map((s) => s.stage),
    }).toEqual({ stage, current: [stage] });
    // "Submitted" is done exactly when FlightDeck filed it and moved on.
    expect({
      stage,
      submitted: steps.some(
        (s) => s.stage === "submitted" && s.state === "done",
      ),
    }).toEqual({ stage, submitted: filed.includes(stage) });
  }
  const shape = (stage: OnboardingStage) =>
    timelineSteps(stage).map((s) => [s.stage, s.state]);
  expect(shape("needs-more-info")).toEqual([
    ["submitted", "done"],
    ["needs-more-info", "current"],
  ]);
  expect(shape("rejected")).toEqual([
    ["submitted", "done"],
    ["rejected", "current"],
  ]);
  // Refused before filing, or closed unconfirmed: never claims a filing.
  expect(shape("not-sent")).toEqual([["not-sent", "current"]]);
  expect(shape("closed")).toEqual([["closed", "current"]]);
  expect(shape("not-confirmed")).toEqual([
    ["not-confirmed", "current"],
    ["linked", "upcoming"],
    ["setup-in-progress", "upcoming"],
    ["setup-complete", "upcoming"],
  ]);
  expect(shape("linked")).toEqual([
    ["submitted", "done"],
    ["linked", "current"],
    ["setup-in-progress", "upcoming"],
    ["setup-complete", "upcoming"],
  ]);
});

test("a locked Remove draft looks and announces locked, says why on the row, and refuses mouse, keyboard and touch", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.clock.install();
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Lock Look"),
    functionArea: "HR",
    flightdeckDraft: { label: qa("Lock Look"), workspaceHint: "" },
  });
  const list = await stageList(page, project.id);
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes(project.id))
      puts.push(r.url());
  });
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Lock Look"),
    });
    const subtitle = row.locator("p").first();
    const remove = row.getByRole("button", { name: "Remove draft" });
    // Before Atlas knows whether FlightDeck holds the draft, the row neither
    // claims a destination is still to be chosen nor offers to drop it.
    await expect(subtitle).toHaveText("HR · Checking FlightDeck status");
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    list.release();
    await expect(row.getByText("Submitted", { exact: true })).toBeVisible();
    await expect(subtitle).toHaveText("HR · With FlightDeck");
    // Announced locked, and still reachable so the reason can be heard.
    await expect(remove).toBeDisabled();
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(remove).toHaveAccessibleDescription(lockNote("submitted"));
    // The reason is on the row itself, not behind a hover.
    await expect(
      row.getByText(lockNote("submitted"), { exact: true }),
    ).toBeVisible();
    const locked = await looks(remove);
    expect(locked.cursor).toBe("not-allowed");
    expect(locked.opacity).toBeLessThanOrEqual(0.6);
    await page.screenshot({ path: shot("locked-row-1440.png") });
    // Mouse, keyboard: nothing is removed.
    await remove.click({ force: true });
    await remove.focus();
    await expect(remove).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    // Touch, at phone width: the same.
    // The same server as the rest of the suite (ATLAS_BASE_URL, else :5173).
    const touch = await browser.newContext({
      baseURL,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const phone = await touch.newPage();
    try {
      await mockContext(phone);
      const phoneList = await stageList(phone, project.id);
      phoneList.release();
      await phone.goto("/?view=connection");
      await openToFlightDeck(phone);
      const phoneRow = phone.locator("article.bridge-project", {
        hasText: qa("Lock Look"),
      });
      await expect(
        phoneRow.getByText(lockNote("submitted"), { exact: true }),
      ).toBeVisible();
      await phoneRow
        .getByRole("button", { name: "Remove draft" })
        .tap({ force: true });
      await phoneRow.scrollIntoViewIfNeeded();
      await phone.screenshot({ path: shot("locked-row-390.png") });
    } finally {
      await touch.close();
    }
    expect(puts).toEqual([]);
    await expect(remove).toBeVisible();
    // Handed back: live again, looks live, no reason shown, and the subtitle
    // speaks of the next send, not of one never made.
    list.state.stage = "needs-more-info";
    await page.clock.fastForward(61_000);
    await expect(
      row.getByText("Needs more info", { exact: true }),
    ).toBeVisible();
    await expect(remove).toBeEnabled();
    await expect(remove).not.toHaveAttribute("aria-disabled", "true");
    await expect(row.getByText(lockNote("submitted"))).toHaveCount(0);
    expect(await looks(remove)).toEqual({ opacity: 1, cursor: "pointer" });
    await expect(subtitle).toHaveText(
      "HR · Destination chosen when you send again",
    );
  } finally {
    await removeProject(page, project.id);
  }
});

test("a stage list Atlas could not read locks the row instead of offering to drop a draft FlightDeck may hold", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Unknown Stage"),
    functionArea: "HR",
    flightdeckDraft: { label: qa("Unknown Stage"), workspaceHint: "" },
  });
  const list = await stageList(page, project.id);
  list.state.fail = true;
  list.release();
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Unknown Stage"),
    });
    await expect(row.locator("p").first()).toHaveText(
      "HR · FlightDeck status unavailable",
    );
    const remove = row.getByRole("button", { name: "Remove draft" });
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(remove).toHaveAccessibleDescription(/could not check/i);
    await expect(row.getByText(/could not check/i)).toBeVisible();
  } finally {
    await removeProject(page, project.id);
  }
});

/** Runs `fn` against the dev server's local D1 database (the miniflare
 * sqlite file that holds the onboarding tables). */
function devDb<T>(fn: (db: DatabaseSync) => T): T {
  const folder = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  for (const file of readdirSync(folder).filter(
    (p) => p.endsWith(".sqlite") && p !== "metadata.sqlite",
  )) {
    const db = new DatabaseSync(`${folder}/${file}`);
    try {
      if (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='atlas_flightdeck_operations'",
          )
          .get()
      )
        return fn(db);
    } finally {
      db.close();
    }
  }
  throw Error("The dev server's D1 database was not found.");
}

test("the form stays read-only until Atlas knows FlightDeck does not hold the draft, and the server refuses to save over one it holds", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Form Lock"),
    functionArea: "HR",
    flightdeckDraft: { label: qa("Form Lock"), workspaceHint: "" },
  });
  // Never sent, as far as the list knows.
  await page.route(
    (url) => url.pathname === "/api/flightdeck/onboard",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ stages: {}, checked: {}, retryAfter: null }),
      }),
  );
  // The form's own status: held, then failing, then never sent.
  const statusGate = gate();
  const answer = { mode: "hold" as "hold" | "fail" | "ok" };
  await page.route(
    `**/api/flightdeck/onboard/${project.id}**`,
    async (route) => {
      if (answer.mode === "hold") await statusGate.wait();
      if (answer.mode !== "ok")
        return route.fulfill({ status: 503, body: "{}" }).catch(() => {});
      return route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(statusBody(null)),
        })
        .catch(() => {});
    },
  );
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes(`/api/projects/${project.id}`))
      puts.push(r.url());
  });
  try {
    await page.reload();
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Form Lock"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    const name = row.getByLabel("Proposed OS project name");
    const save = row.getByRole("button", { name: "Save now" });
    // Still loading: FlightDeck may hold this draft, so nothing may change.
    await statusGate.reached;
    await expect(row.getByText("Checking FlightDeck status")).toBeVisible();
    await expect(name).toBeDisabled();
    await expect(save).toBeDisabled();
    // The status could not be read: still read-only, and it says why.
    answer.mode = "fail";
    statusGate.open();
    await expect(row.getByText("FlightDeck status unavailable")).toBeVisible();
    await expect(name).toBeDisabled();
    await expect(save).toBeDisabled();
    await name.press("Enter").catch(() => {});
    // Atlas tries again on its own; once it knows nothing is held, the
    // draft opens.
    answer.mode = "ok";
    await expect(name).toBeEnabled({ timeout: 15_000 });
    await expect(row.getByText("FlightDeck status unavailable")).toHaveCount(0);
    expect(puts).toEqual([]);

    // The server keeps the promise on its own. A send FlightDeck holds (a
    // linked project, set up) is written straight into the dev database.
    devDb((db) =>
      db
        .prepare(
          "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,state,setup_state,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `op-${project.id}`,
          project.id,
          project.revision,
          crypto.randomUUID(),
          "hr-de",
          qa("Form Lock"),
          "linked",
          "complete",
          "qa",
          new Date().toISOString(),
        ),
    );
    const put = (fields: Partial<Project>) =>
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
          return {
            status: r.status,
            body: (await r.json()) as { project?: Project; code?: string },
          };
        },
        { project, fields },
      );
    const renamed = await put({
      flightdeckDraft: { label: qa("Form Lock edited"), workspaceHint: "" },
    });
    expect(renamed).toMatchObject({
      status: 409,
      body: { code: "draft_locked" },
    });
    expect((await put({ onboarding: { countryCode: "FR" } })).status).toBe(409);
    // The rest of the project keeps moving.
    const moved = await put({ status: "On hold" });
    expect(moved.status).toBe(200);
    expect(moved.body.project).toMatchObject({
      status: "On hold",
      flightdeckDraft: { label: qa("Form Lock") },
    });
  } finally {
    await removeProject(page, project.id);
    devDb((db) =>
      db
        .prepare("DELETE FROM atlas_flightdeck_operations WHERE id=?")
        .run(`op-${project.id}`),
    );
  }
});

test("an onboarding-scoped save changes only the onboarding field, merges over other edits, and refuses a stale onboarding, a wrong scope and a held draft", async ({
  page,
}) => {
  await page.goto("/");
  const created = await createProject(page, {
    name: qa("Scoped Save"),
    description: "Original description",
    functionArea: "HR",
  });
  const scoped = (body: Record<string, unknown>) =>
    page.evaluate(
      async ({ id, body }) => {
        const r = await fetch(`/api/projects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return {
          status: r.status,
          body: (await r.json()) as {
            project?: Project;
            code?: string;
            error?: string;
          },
        };
      },
      { id: created.id, body },
    );
  try {
    expect(created.revision).toBe(1);
    // User A saves the description (revision 2) while user B's onboarding
    // form still holds revision 1.
    const a1 = await updateProject(page, created, {
      description: "A's description",
    });
    expect(a1.revision).toBe(2);
    // B's autosave merges: only the onboarding field changes.
    const b1 = await scoped({
      scope: "onboarding",
      baseRevision: 1,
      onboarding: { countryCode: "DE" },
      // Anything else in the body is ignored, never saved.
      description: "B must not overwrite this",
      name: "Hijacked",
    });
    expect(b1.status).toBe(200);
    expect(b1.body.project).toMatchObject({
      revision: 3,
      description: "A's description",
      name: qa("Scoped Save"),
      onboarding: { countryCode: "DE" },
    });
    // A form based on revision 2 has not seen that onboarding change.
    const stale = await scoped({
      scope: "onboarding",
      baseRevision: 2,
      onboarding: { countryCode: "FR" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("onboarding_changed");
    // A full save by A that leaves onboarding alone keeps B's next autosave
    // (based on revision 3) mergeable.
    const a2 = await updateProject(page, b1.body.project!, {
      description: "A again",
    });
    expect(a2).toMatchObject({
      revision: 4,
      onboarding: { countryCode: "DE" },
    });
    const b2 = await scoped({
      scope: "onboarding",
      baseRevision: 3,
      onboarding: { countryCode: "DE", legalEntity: "Acme GmbH" },
    });
    expect(b2.status).toBe(200);
    expect(b2.body.project).toMatchObject({
      revision: 5,
      description: "A again",
      onboarding: { countryCode: "DE", legalEntity: "Acme GmbH" },
    });
    // A full save that changes onboarding is an onboarding change too.
    const a3 = await updateProject(page, b2.body.project!, {
      onboarding: { countryCode: "AT" },
    });
    expect(a3.revision).toBe(6);
    expect(
      (
        await scoped({
          scope: "onboarding",
          baseRevision: 5,
          onboarding: { countryCode: "DE" },
        })
      ).status,
    ).toBe(409);
    // Only the onboarding scope exists, and the body must be well formed.
    expect(
      (
        await scoped({
          scope: "description",
          baseRevision: 6,
          onboarding: { countryCode: "DE" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await scoped({ scope: "onboarding", onboarding: { countryCode: "DE" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await scoped({
          scope: "onboarding",
          baseRevision: 6,
          onboarding: { countryCode: "XX" },
        })
      ).status,
    ).toBe(400);
    // A draft FlightDeck may hold stays as it was sent.
    devDb((db) =>
      db
        .prepare(
          "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,state,setup_state,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `op-${created.id}`,
          created.id,
          6,
          crypto.randomUUID(),
          "hr-de",
          qa("Scoped Save"),
          "linked",
          "complete",
          "qa",
          new Date().toISOString(),
        ),
    );
    const locked = await scoped({
      scope: "onboarding",
      baseRevision: 6,
      onboarding: { countryCode: "DE" },
    });
    expect(locked).toMatchObject({
      status: 409,
      body: { code: "draft_locked" },
    });
  } finally {
    devDb((db) =>
      db
        .prepare("DELETE FROM atlas_flightdeck_operations WHERE id=?")
        .run(`op-${created.id}`),
    );
    await removeProject(page, created.id);
  }
});

// onb-atlas-ask-persistence. The flag is read from this process's
// environment, which is the one the dev server under test was started with
// (run both with or without ATLAS_REQUESTER_REQUESTS=true).
test("the send request marker: refused 400 on both save paths while ATLAS_REQUESTER_REQUESTS is off; stored, kept and marked stale in the same write while it is on", async ({
  page,
}) => {
  const on = process.env.ATLAS_REQUESTER_REQUESTS?.trim() === "true";
  await page.goto("/");
  const created = await createProject(page, {
    name: qa("Send Request"),
    onboarding: { countryCode: "DE" },
  });
  const put = (body: Record<string, unknown>) =>
    page.evaluate(
      async ({ id, body }) => {
        const r = await fetch(`/api/projects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return {
          status: r.status,
          body: (await r.json()) as {
            project?: Project;
            code?: string;
          },
        };
      },
      { id: created.id, body },
    );
  const ask = {
    revision: 1,
    by: "seedy@sites.test",
    at: "2026-09-25T10:00:00.000Z",
  };
  try {
    if (!on) {
      const scoped = await put({
        scope: "onboarding",
        baseRevision: 1,
        onboarding: { countryCode: "DE", sendRequest: ask },
      });
      expect(scoped).toMatchObject({
        status: 400,
        body: { code: "requester_requests_off" },
      });
      const whole = await put({
        ...created,
        activity: undefined,
        onboarding: { countryCode: "DE", sendRequest: ask },
      });
      expect(whole).toMatchObject({
        status: 400,
        body: { code: "requester_requests_off" },
      });
      // Nothing was written.
      const after = await put({
        scope: "onboarding",
        baseRevision: 1,
        onboarding: { countryCode: "DE" },
      });
      expect(after.status).toBe(200);
      expect(after.body.project?.onboarding?.sendRequest).toBeUndefined();
      return;
    }
    // Asking in someone else's name is refused.
    expect(
      (
        await put({
          scope: "onboarding",
          baseRevision: 1,
          onboarding: {
            countryCode: "DE",
            sendRequest: { ...ask, by: "someone@else.test" },
          },
        })
      ).body.code,
    ).toBe("send_request_actor");
    const asked = await put({
      scope: "onboarding",
      baseRevision: 1,
      onboarding: { countryCode: "DE", sendRequest: { ...ask, stale: true } },
    });
    expect(asked.status).toBe(200);
    expect(asked.body.project?.onboarding?.sendRequest).toEqual(ask);
    // A later onboarding-scoped save that omits the marker keeps it and
    // marks it stale in the same write.
    const edited = await put({
      scope: "onboarding",
      baseRevision: asked.body.project!.revision,
      onboarding: { countryCode: "FR" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.project?.onboarding).toEqual({
      countryCode: "FR",
      sendRequest: { ...ask, stale: true },
    });
  } finally {
    await removeProject(page, created.id);
  }
});

// onb-atlas-ask-persistence, fix round 2: creating a project applies the
// same marker rules as a save (flag, asker, server-owned stale), and a
// whole-project save that changes only the FlightDeck draft label marks an
// open ask stale.
test("the send request marker on project creation follows the save rules, and a label-only whole save marks the ask stale", async ({
  page,
}) => {
  const on = process.env.ATLAS_REQUESTER_REQUESTS?.trim() === "true";
  await page.goto("/");
  const ask = {
    revision: 1,
    by: "seedy@sites.test",
    at: "2026-09-25T10:00:00.000Z",
  };
  const post = (fields: Partial<Project>) =>
    page.evaluate(
      async (body) => {
        const r = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return {
          status: r.status,
          body: (await r.json()) as { project?: Project; code?: string },
        };
      },
      { ...examples[0], tasks: [], name: qa("Send Request Create"), ...fields },
    );
  const made: string[] = [];
  try {
    if (!on) {
      const refused = await post({
        onboarding: { countryCode: "DE", sendRequest: ask },
      });
      if (refused.body.project) made.push(refused.body.project.id);
      expect(refused).toMatchObject({
        status: 400,
        body: { code: "requester_requests_off" },
      });
      return;
    }
    const impersonated = await post({
      onboarding: {
        countryCode: "DE",
        sendRequest: { ...ask, by: "someone@else.test" },
      },
    });
    if (impersonated.body.project) made.push(impersonated.body.project.id);
    expect(impersonated).toMatchObject({
      status: 400,
      body: { code: "send_request_actor" },
    });
    const created = await post({
      flightdeckDraft: { label: "Acme rollout", workspaceHint: "acme" },
      onboarding: { countryCode: "DE", sendRequest: { ...ask, stale: true } },
    });
    if (created.body.project) made.push(created.body.project.id);
    expect(created.status).toBe(201);
    // `stale` is the server's: a client-sent value is dropped on create.
    expect(created.body.project?.onboarding?.sendRequest).toEqual(ask);
    const project = created.body.project!;
    const relabelled = await page.evaluate(
      async (body) => {
        const r = await fetch(`/api/projects/${body.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return {
          status: r.status,
          body: (await r.json()) as { project?: Project },
        };
      },
      {
        ...project,
        activity: undefined,
        flightdeckDraft: { label: "Acme rollout 2", workspaceHint: "acme" },
      },
    );
    expect(relabelled.status).toBe(200);
    expect(relabelled.body.project?.onboarding?.sendRequest).toEqual({
      ...ask,
      stale: true,
    });
  } finally {
    for (const id of made) await removeProject(page, id);
  }
});

test("a whole-project save that changes only a sent profile field marks the ask stale", async ({
  page,
}) => {
  test.skip(
    process.env.ATLAS_REQUESTER_REQUESTS?.trim() !== "true",
    "Needs ATLAS_REQUESTER_REQUESTS=true on the server under test.",
  );
  await page.goto("/");
  const ask = {
    revision: 1,
    by: "seedy@sites.test",
    at: "2026-09-25T10:00:00.000Z",
  };
  const project = await createProject(page, {
    name: qa("Send Request Profile"),
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    flightdeckDraft: { label: "Acme rollout", workspaceHint: "acme" },
    onboarding: { countryCode: "DE", sendRequest: ask },
  });
  try {
    expect(project.onboarding?.sendRequest).toEqual(ask);
    // buildOnboardingPayload sends description as profile.summary: the
    // onboarding details and the FlightDeck draft stay exactly as they were.
    const saved = await page.evaluate(
      async (body) => {
        const r = await fetch(`/api/projects/${body.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return {
          status: r.status,
          body: (await r.json()) as { project?: Project },
        };
      },
      { ...project, activity: undefined, description: "Summary, rewritten" },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.project?.onboarding?.sendRequest).toEqual({
      ...ask,
      stale: true,
    });
  } finally {
    await removeProject(page, project.id);
  }
});

test("the timeline shows an answered request, every step labels the panel it shows, and Review & send states the open Legal question", async ({
  page,
}) => {
  await mockContext(page);
  await page.goto("/?view=connection");
  const project = await createProject(page, {
    name: qa("Answered"),
    description: "Summary",
    benefit: "Measure",
    functionArea: "HR",
    onboardingStage: "Ready for FlightDeck",
    flightdeckDraft: { label: qa("Answered"), workspaceHint: "" },
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
    await openToFlightDeck(page);
    const row = page.locator("article.bridge-project", {
      hasText: qa("Answered"),
    });
    await row.getByRole("button", { name: "Edit draft", exact: true }).click();
    // An answered request reads as sent and answered, not as never sent.
    const timeline = row.getByRole("list", { name: "FlightDeck status" });
    await expect(timeline.locator("li.done")).toHaveText(["Submitted"]);
    await expect(timeline.locator('li[aria-current="step"]')).toHaveText(
      "Needs more info",
    );
    // Every step, once chosen, is the only current one and names the
    // panel shown; no tab semantics are left without their panel.
    for (const name of [
      "Basics",
      "FlightDeck details",
      "Apps (optional)",
      "AI agents (locked)",
      "Review & send",
    ]) {
      await stepButton(row, name).click();
      await expect(stepButton(row, name)).toHaveAttribute(
        "aria-current",
        "step",
      );
      await expect(row.locator('[aria-current="step"]')).toHaveCount(2);
      await expect(row.getByRole("group", { name })).toBeVisible();
      await expect(row.locator('[role="tab"], [role="tabpanel"]')).toHaveCount(
        0,
      );
    }
    // Where the Super Admin authorises the send, the open Legal question is
    // stated as open, not answered.
    const legal = row.getByRole("note", { name: "Open Legal question" });
    await expect(legal).toBeVisible();
    await expect(legal).toContainText("decision 6");
    await expect(legal).toContainText("Summary and Success measure");
    await expect(legal).toContainText(/not answered/i);
    await expect(
      row.getByRole("button", { name: "Send to FlightDeck" }),
    ).toHaveAccessibleDescription(/decision 6/);
    await legal.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("review-legal-1440.png") });
  } finally {
    await removeProject(page, project.id);
  }
});
