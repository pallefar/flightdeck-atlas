import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as card from "../lib/flightdeck/project-card";
import {
  projectStatus,
  type OnboardLinkRow,
  type OnboardSendRow,
} from "../lib/flightdeck/onboard-route";
import type { ReadinessProject } from "../lib/flightdeck/onboarding";
import { en } from "../lib/i18n/en";
import { de } from "../lib/i18n/de";

// The requester-first FlightDeck card on the Atlas project page
// (onb-atlas-project-entry-card, plan 2026-09-25 J1): one card whose state
// follows the draft and the approved status projection, shown to the Super
// Admin always and to editors only with ATLAS_REQUESTER_REQUESTS on.

const api = card as unknown as {
  requesterRequestsOn?: (value: string | undefined) => boolean;
  cardVisible?: (v: {
    superAdmin: boolean;
    canEdit: boolean;
    requesterRequests: boolean;
    demo: boolean;
  }) => boolean;
  projectCardView?: (input: {
    project: ReadinessProject;
    status: ReturnType<typeof projectStatus>;
    failed: boolean;
    superAdmin: boolean;
    osOrigin: string;
  }) => Record<string, unknown> & { kind: string };
};

const blank = {
  flightdeckDraft: undefined,
  functionArea: "",
  category: "",
  description: "",
  benefit: "",
  onboarding: undefined,
  onboardingStage: undefined,
} as unknown as ReadinessProject;
const drafted = {
  ...blank,
  flightdeckDraft: { label: "Harbour pilot" },
  functionArea: "Operations",
  description: "Automate berth planning",
} as unknown as ReadinessProject;

const row = (over: Partial<OnboardSendRow>): OnboardSendRow => ({
  id: "op-1",
  atlas_project_id: "p1",
  atlas_revision: 3,
  idempotency_key: "k",
  destination_workspace_id: "ws-ops",
  proposed_label: "Harbour pilot",
  proposed_project_id: null,
  state: "filed",
  submission_id: "a".repeat(24),
  received_at: "2026-09-25T10:00:00.000Z",
  payload_sha256: null,
  reason_code: null,
  setup_state: null,
  created_by: "u",
  updated_at: "2026-09-25T10:00:00.000Z",
  checked_at: "2026-09-25T10:05:00.000Z",
  request_body: null,
  adopted: 0,
  ...over,
});
const link: OnboardLinkRow = {
  installation_id: "atlas-local",
  os_instance_id: "os-1",
  workspace_id: "ws-ops",
  os_project_id: "harbour-pilot",
  atlas_project_id: "p1",
  submission_id: null,
  linked_at: "2026-09-25T11:00:00.000Z",
  linked_by: "u",
  source_revision: 3,
  last_checked_at: "2026-09-25T11:00:00.000Z",
  access_state: "active",
};
const ADMIN = { superAdmin: true };
const EDITOR = { superAdmin: false };
const view = (
  project: ReadinessProject,
  viewer: { superAdmin: boolean },
  op: OnboardSendRow | null,
  withLink = false,
  osOrigin = "http://127.0.0.1:4173",
) =>
  api.projectCardView!({
    project,
    status: projectStatus(viewer, {
      operation: op,
      link: withLink ? link : null,
    }),
    failed: false,
    superAdmin: viewer.superAdmin,
    osOrigin,
  });

test("ATLAS_REQUESTER_REQUESTS is off unless set to true or 1", () => {
  expect(typeof api.requesterRequestsOn).toBe("function");
  for (const off of [undefined, "", "0", "false", "off", "no", "yes", " "])
    expect(api.requesterRequestsOn!(off), String(off)).toBe(false);
  for (const on of ["true", "1", " TRUE "])
    expect(api.requesterRequestsOn!(on), on).toBe(true);
});

test("flag off: only the Super Admin sees the card; flag on: rights.edit holders too", () => {
  expect(typeof api.cardVisible).toBe("function");
  const v = (
    superAdmin: boolean,
    canEdit: boolean,
    requesterRequests: boolean,
    demo = false,
  ) => api.cardVisible!({ superAdmin, canEdit, requesterRequests, demo });
  expect(v(true, true, false)).toBe(true);
  expect(v(true, true, true)).toBe(true);
  expect(v(false, true, false)).toBe(false);
  expect(v(false, true, true)).toBe(true);
  // View-only never sees it, whatever the flag says.
  expect(v(false, false, true)).toBe(false);
  expect(v(false, false, false)).toBe(false);
  // An example project has no server record to prepare.
  expect(v(true, true, true, true)).toBe(false);
});

test("the card state follows the draft and the projected status", () => {
  expect(typeof api.projectCardView).toBe("function");
  // Prepare: no draft and no send.
  expect(view(blank, EDITOR, null).kind).toBe("prepare");
  // Continue: a draft, counted for the requester (8 items; the destination
  // is the Super Admin's and never counted for anyone here).
  expect(view(drafted, EDITOR, null)).toMatchObject({
    kind: "continue",
    done: 3,
    total: 8,
  });
  expect(view(drafted, ADMIN, null)).toMatchObject({
    kind: "continue",
    done: 3,
    total: 8,
  });
  // Waiting for the Super Admin: a send FlightDeck has not confirmed.
  expect(view(drafted, EDITOR, row({ state: "reserved" }))).toMatchObject({
    kind: "waiting",
    on: "superAdmin",
  });
  // Waiting for FlightDeck review: filed or promoted, not linked.
  for (const state of ["filed", "promoted"] as const)
    expect(view(drafted, EDITOR, row({ state }))).toMatchObject({
      kind: "waiting",
      on: "flightdeck",
    });
  // Fix: needs more info.
  expect(
    view(
      drafted,
      EDITOR,
      row({ state: "rejected", reason_code: "needs-more-info" }),
    ),
  ).toMatchObject({ kind: "fix" });
  // Created: linked, in setup or set up.
  for (const setup_state of [null, "awaiting-cowork", "complete"] as const)
    expect(
      view(drafted, EDITOR, row({ state: "linked", setup_state })).kind,
    ).toBe("created");
  // A declined, refused or closed send reopens the draft: Continue, and the
  // card names the last stage so it is not read as never sent.
  expect(
    view(drafted, EDITOR, row({ state: "rejected", reason_code: "duplicate" })),
  ).toMatchObject({ kind: "continue", stage: "rejected" });
  expect(
    view(drafted, ADMIN, row({ state: "refused", reason_code: "abandoned" })),
  ).toMatchObject({ kind: "continue", stage: "closed" });
  // Refused with no draft left: Prepare again.
  expect(
    view(blank, ADMIN, row({ state: "refused", reason_code: "unauthorized" }))
      .kind,
  ).toBe("prepare");
  // Status not loaded yet / could not be read: never guessed.
  expect(
    api.projectCardView!({
      project: drafted,
      status: null,
      failed: false,
      superAdmin: false,
      osOrigin: "",
    }).kind,
  ).toBe("checking");
  expect(
    api.projectCardView!({
      project: drafted,
      status: null,
      failed: true,
      superAdmin: false,
      osOrigin: "",
    }).kind,
  ).toBe("unavailable");
});

test("Open in FlightDeck: fdWorkspace+fdProject for the Super Admin, hidden for editors the projection withholds the link from", () => {
  const linked = row({ state: "linked", setup_state: "complete" });
  expect(view(drafted, ADMIN, linked, true)).toMatchObject({
    kind: "created",
    openHref:
      "http://127.0.0.1:4173/console?fdWorkspace=ws-ops&fdProject=harbour-pilot",
  });
  // No OS origin configured: no link to nowhere.
  expect(view(drafted, ADMIN, linked, true, "")).toMatchObject({
    kind: "created",
    openHref: null,
  });
  // The editor projection never carries the link, so there is no link.
  expect(view(drafted, EDITOR, linked, true)).toMatchObject({
    kind: "created",
    openHref: null,
  });
  // If a projection ever allows the project id to an editor, the link names
  // the project only, never the workspace.
  const allowed = projectStatus(EDITOR, { operation: linked })!;
  allowed.link = {
    workspaceId: "ws-ops",
    osProjectId: "harbour-pilot",
    linkedAt: link.linked_at,
    accessState: "active",
  };
  expect(
    api.projectCardView!({
      project: drafted,
      status: allowed,
      failed: false,
      superAdmin: false,
      osOrigin: "http://127.0.0.1:4173",
    }),
  ).toMatchObject({
    openHref: "http://127.0.0.1:4173/console?fdProject=harbour-pilot",
  });
});

test("Open in FlightDeck goes to the app's origin + /console, whatever path, query or fragment the catalog URL carries", () => {
  const linked = row({ state: "linked", setup_state: "complete" });
  const href = (appUrl: string) =>
    view(drafted, ADMIN, linked, true, appUrl).openHref;
  const want =
    "https://fd.example.com/console?fdWorkspace=ws-ops&fdProject=harbour-pilot";
  expect(href("https://fd.example.com/console")).toBe(want);
  expect(href("https://fd.example.com/console/")).toBe(want);
  expect(href("https://fd.example.com/app/home?tab=1#top")).toBe(want);
  expect(href("https://fd.example.com")).toBe(want);
  // Not a usable web address: no link (fails closed, never a javascript: or relative href).
  expect(href("not a url")).toBeNull();
  expect(href("javascript:alert(1)")).toBeNull();
  expect(href("ftp://fd.example.com/")).toBeNull();
});

test("the local field is 'Readiness stage' / 'Reifegrad', and the card's words exist in both languages", () => {
  const keys = en as Record<string, string>;
  expect(keys["onb.readiness.label"]).toBe("Readiness stage");
  expect((de as Record<string, string>)["onb.readiness.label"]).toBe(
    "Reifegrad",
  );
  for (const key of [
    "onb.card.title",
    "onb.card.prepare",
    "onb.card.continue",
    "onb.card.waitingSuperAdmin",
    "onb.card.waitingFlightDeck",
    "onb.card.fix",
    "onb.card.created",
    "onb.card.open",
  ])
    expect(keys[key], key).toBeTruthy();
  // The project page and the edit form use it instead of "Onboarding".
  const workspace = readFileSync("app/project-workspace.tsx", "utf8");
  expect(workspace).not.toMatch(/<dt>Onboarding<\/dt>/);
  expect(workspace).toContain('"onb.readiness.label"');
  expect(workspace).toContain("<FlightDeckProjectCard");
  const atlas = readFileSync("app/atlas.tsx", "utf8");
  expect(atlas).not.toMatch(/^\s*Onboarding stage\s*$/m);
  expect(atlas).toContain('"onb.readiness.label"');
});

test("the connection page row links to the project's FlightDeck card", () => {
  const connection = readFileSync("app/flightdeck-connection.tsx", "utf8");
  expect(connection).toContain("#${CARD_ANCHOR}");
  expect(connection).toContain('"onb.card.rowLink"');
  expect(card.CARD_ANCHOR).toBe("flightdeck");
});
