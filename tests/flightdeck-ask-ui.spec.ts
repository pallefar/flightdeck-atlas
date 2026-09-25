import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as askLib from "../lib/flightdeck/ask";
import {
  onboardingSchema,
  sendRequestAction,
  type ReadinessProject,
} from "../lib/flightdeck/onboarding";
import { projectCardView } from "../lib/flightdeck/project-card";
import { projectStatus } from "../lib/flightdeck/onboard-route";
import { examples, type Project } from "../lib/projects";
import { en } from "../lib/i18n/en";
import { de } from "../lib/i18n/de";

// onb-atlas-request-ui (plan 2026-09-25 J3, behind ATLAS_REQUESTER_REQUESTS,
// D-037 item 4): the editor's "Ask Super Admin to send revision r", the card
// reading "Waiting for Super Admin" / "Changed since you asked", the Super
// Admin's "Waiting for you (n)" list, and the field diff a stale ask shows
// before Send. Only the Super Admin sends (D-033 decision 7); with the flag
// off nothing here shows.

const api = askLib as unknown as Partial<typeof askLib>;
const NOW = "2026-09-25T15:00:00.000Z";
const EDITOR = "editor@example.com";

const project = (over: Partial<Project> = {}): Project =>
  ({
    ...examples[0],
    id: "p1",
    revision: 7,
    source: "atlas",
    archived: false,
    description: "Automate berth planning",
    benefit: "Berths planned a day ahead",
    functionArea: "Operations",
    category: "Automation",
    flightdeckDraft: { label: "Harbour pilot" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
    ...over,
  }) as Project;

test("the ask may carry a bounded snapshot of the asked fields", () => {
  const ask = { revision: 7, by: EDITOR, at: NOW };
  expect(
    onboardingSchema.safeParse({
      sendRequest: { ...ask, fields: { "profile.summary": "Automate" } },
    }).success,
  ).toBe(true);
  for (const fields of [
    { "profile.summary": 3 },
    Object.fromEntries(
      Array.from({ length: 41 }, (_, i) => [`f${i}`, "x"]),
    ),
    { "profile.summary": "x".repeat(4001) },
  ])
    expect(
      onboardingSchema.safeParse({ sendRequest: { ...ask, fields } }).success,
    ).toBe(false);
});

test("an ask stores the snapshot it is given; a withdraw keeps it", () => {
  const fields = { "profile.summary": "Automate berth planning" };
  const asked = sendRequestAction({
    onboarding: { countryCode: "DE" },
    projectRevision: 7,
    action: "ask",
    revision: 7,
    enabled: true,
    actor: EDITOR,
    superAdmin: false,
    canEdit: true,
    held: false,
    at: NOW,
    fields,
  });
  expect(asked).toEqual({
    ok: true,
    onboarding: {
      countryCode: "DE",
      sendRequest: { revision: 7, by: EDITOR, at: NOW, fields },
    },
  });
  const withdrawn = sendRequestAction({
    onboarding: asked.ok ? asked.onboarding : undefined,
    projectRevision: 8,
    action: "withdraw",
    revision: 7,
    enabled: true,
    actor: EDITOR,
    superAdmin: false,
    canEdit: true,
    held: false,
    at: NOW,
  });
  expect(withdrawn.ok && withdrawn.onboarding.sendRequest?.fields).toEqual(
    fields,
  );
});

test("the snapshot holds what the editor wrote, never the destination or technical values", () => {
  const snap = api.askSnapshot!(project());
  expect(snap["target.label"]).toBe("Harbour pilot");
  expect(snap["profile.summary"]).toBe("Automate berth planning");
  expect(snap["facts.countryCode"]).toBe("Germany (DE)");
  for (const path of [
    "target.workspaceId",
    "atlasProjectId",
    "atlasRevision",
    "installationId",
    "requestedBy",
    "idempotencyKey",
    "schema",
    "progress",
  ])
    expect(snap, path).not.toHaveProperty(path);
  expect(onboardingSchema.safeParse({
    sendRequest: { revision: 7, by: EDITOR, at: NOW, fields: snap },
  }).success).toBe(true);
});

test("the diff lists each changed field, asked versus now; no snapshot is null", () => {
  const before = api.askSnapshot!(project());
  const after = api.askSnapshot!(
    project({
      description: "Automate berth and crane planning",
      onboarding: {
        countryCode: "DE",
        worksCouncilRelevant: "no",
        legalEntity: "Harbour GmbH",
      },
    }),
  );
  expect(api.askDiff!(undefined, after)).toBeNull();
  expect(api.askDiff!(before, before)).toEqual([]);
  expect(api.askDiff!(before, after)).toEqual([
    {
      path: "profile.summary",
      label: "Summary",
      asked: "Automate berth planning",
      now: "Automate berth and crane planning",
    },
    {
      path: "facts.legalEntity",
      label: "Legal entity",
      asked: "",
      now: "Harbour GmbH",
    },
  ]);
});

test("the editor's ask state: none, waiting for revision r, or changed since asked", () => {
  const view = api.requesterAsk!;
  expect(view(undefined, null)).toEqual({ kind: "none" });
  expect(view({ countryCode: "DE" }, null)).toEqual({ kind: "none" });
  const ask = { revision: 7, by: EDITOR, at: NOW };
  expect(view({ sendRequest: ask }, null)).toEqual({
    kind: "waiting",
    revision: 7,
    by: EDITOR,
    at: NOW,
  });
  expect(view({ sendRequest: { ...ask, stale: true } }, "not-sent")).toEqual({
    kind: "changed",
    revision: 7,
    by: EDITOR,
    at: NOW,
  });
  expect(view({ sendRequest: { ...ask, withdrawnAt: NOW } }, null)).toEqual({
    kind: "none",
  });
  // Once FlightDeck may hold the draft, the ask is over: the send shows.
  expect(view({ sendRequest: ask }, "submitted")).toEqual({ kind: "none" });
});

test("Waiting for you: open asks on Atlas projects, oldest first; none with the flag off", () => {
  const list = api.waitingForYou!;
  const ask = (at: string, extra = {}) => ({
    countryCode: "DE",
    sendRequest: { revision: 3, by: EDITOR, at, ...extra },
  });
  const projects = [
    project({ id: "a", onboarding: ask("2026-09-25T12:00:00.000Z") }),
    project({
      id: "b",
      onboarding: ask("2026-09-25T09:00:00.000Z", { stale: true }),
    }),
    project({
      id: "c",
      onboarding: ask("2026-09-25T08:00:00.000Z", { withdrawnAt: NOW }),
    }),
    project({ id: "d", archived: true, onboarding: ask(NOW) }),
    project({ id: "e", source: "flightdeck", onboarding: ask(NOW) }),
    project({ id: "f", onboarding: ask("2026-09-25T07:00:00.000Z") }),
    project({ id: "g" }),
  ];
  const stages = { f: "submitted" as const };
  expect(list(projects, stages, false)).toEqual([]);
  expect(list(projects, stages, true).map((w) => [w.project.id, w.stale])).toEqual([
    ["b", true],
    ["a", false],
  ]);
  // Before the stages load, an open ask still waits.
  expect(list(projects, null, true).map((w) => w.project.id)).toEqual([
    "f",
    "b",
    "a",
  ]);
});

test("the card: an open ask reads Waiting for Super Admin, a stale one Changed since you asked; flag off unchanged", () => {
  const status = (superAdmin: boolean) =>
    projectStatus({ superAdmin }, { operation: null, link: null });
  const withAsk = (extra = {}) =>
    ({
      ...project(),
      onboarding: {
        countryCode: "DE",
        sendRequest: { revision: 7, by: EDITOR, at: NOW, ...extra },
      },
    }) as unknown as ReadinessProject;
  const cardView = (p: ReadinessProject, requesterRequests: boolean) =>
    projectCardView({
      project: p,
      status: status(false),
      failed: false,
      superAdmin: false,
      osOrigin: "",
      requesterRequests,
    } as Parameters<typeof projectCardView>[0]);
  expect(cardView(withAsk(), true)).toEqual({
    kind: "asked",
    revision: 7,
    stale: false,
  });
  expect(cardView(withAsk({ stale: true }), true)).toEqual({
    kind: "asked",
    revision: 7,
    stale: true,
  });
  expect(cardView(withAsk(), false).kind).toBe("continue");
  expect(cardView(withAsk({ withdrawnAt: NOW }), true).kind).toBe("continue");
});

test("the words exist in both languages", () => {
  for (const key of [
    "onb.ask.button",
    "onb.ask.waiting",
    "onb.ask.waiting.text",
    "onb.ask.changed",
    "onb.ask.changed.text",
    "onb.ask.withdraw",
    "onb.ask.asked",
    "onb.ask.withdrawn",
    "onb.ask.saveFirst",
    "onb.ask.notReady",
    "onb.ask.failed",
    "onb.waiting.title",
    "onb.waiting.row",
    "onb.waiting.changed",
    "onb.waiting.review",
    "onb.waiting.card",
    "onb.diff.title",
    "onb.diff.field",
    "onb.diff.asked",
    "onb.diff.now",
    "onb.diff.none",
    "onb.diff.unknown",
    "onb.diff.empty",
  ]) {
    expect(en[key as keyof typeof en], key).toBeTruthy();
    expect(de[key as keyof typeof de], key).toBeTruthy();
  }
  expect(en["onb.ask.button" as keyof typeof en]).toBe(
    "Ask Super Admin to send revision {revision}",
  );
  expect(en["onb.waiting.title" as keyof typeof en]).toBe(
    "Waiting for you ({count})",
  );
});

test("the UI is wired: the editor asks, the card and the connection page read the flag, the ask route stores the snapshot", () => {
  const editor = readFileSync("app/flightdeck-onboarding.tsx", "utf8");
  expect(editor).toContain('askAction("ask")');
  expect(editor).toContain('askAction("withdraw")');
  expect(editor).toContain('scope: "onboarding", action, revision');
  expect(editor).toContain("askDiff(");
  const cardUi = readFileSync("app/flightdeck-project-card.tsx", "utf8");
  expect(cardUi).toContain("requesterRequests={requesterRequests}");
  // The editor never sees workspaces: only the Super Admin's form gets them.
  expect(cardUi).toContain("workspaces={superAdmin ? context.workspaces : []}");
  const connection = readFileSync("app/flightdeck-connection.tsx", "utf8");
  expect(connection).toContain("waitingForYou(");
  expect(readFileSync("app/atlas.tsx", "utf8")).toMatch(
    /<FlightDeckConnection[\s\S]*?requesterRequests=\{requesterRequests\}/,
  );
  expect(readFileSync("app/api/projects/[id]/route.ts", "utf8")).toContain(
    "askSnapshot(",
  );
});

// Fix round 2 (review P1): an ask or a withdraw adopts the server's copy of
// the whole draft, so it must never run over local work nobody saved, and
// nothing may be edited while it is on its way. Fails closed: with unsaved
// or held work both buttons are off; while one runs the form is frozen.
test("ask and withdraw wait for saved work; the form is frozen while one runs", () => {
  const controls = api.askControls;
  expect(typeof controls).toBe("function");
  const idle = { unsaved: false, held: false, asking: false, busy: false, saving: false };
  expect(controls!(idle)).toEqual({ withdrawDisabled: false, freeze: false });
  for (const over of [
    { unsaved: true },
    { held: true },
    { asking: true },
    { busy: true },
    { saving: true },
  ])
    expect(controls!({ ...idle, ...over }).withdrawDisabled).toBe(true);
  expect(controls!({ ...idle, asking: true }).freeze).toBe(true);
  expect(controls!({ ...idle, unsaved: true }).freeze).toBe(false);

  const editor = readFileSync("app/flightdeck-onboarding.tsx", "utf8");
  // The withdraw button and the handler both honour the rule.
  expect(editor).toContain("disabled={askLock.withdrawDisabled}");
  expect(editor).toMatch(/async function askAction[\s\S]*?if \(unsavedRef\.current \|\| held\) \{/);
  // The step form, the starter choice and the checklist suggestions freeze.
  expect(editor).toContain("disabled={frozen || busy || saving || askLock.freeze}");
  expect(editor).toContain("disabled={busy || saving || askLock.freeze}");
  expect(editor).toContain("disabled={saving || askLock.freeze}");
});
