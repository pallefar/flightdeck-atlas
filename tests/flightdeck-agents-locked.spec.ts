import { test, expect } from "@playwright/test";
import * as onboarding from "../lib/flightdeck/onboarding";
import { meterFor, readinessFor } from "../lib/flightdeck/onboarding";
import { en } from "../lib/i18n/en";
import { de } from "../lib/i18n/de";

// onb-aiagents-locked-atlas: the 'AI agents' step stays locked. It lists the
// prerequisites each capability needs (docs/EPIC-BEDROCK-AGENTS-2026-09-24.md
// "Stays closed until a person acts"), grouped by capability, each Open with
// the role that owns it. It has no inputs, a save carrying aiAgents is
// refused (never stripped), and nothing on the step is counted. A flag alone
// never unlocks it: unlocking needs the epic slices bedrock-onboarding-payload,
// atlas-onboarding-agents-step and atlas-onboarding-agents-status plus OS
// enforcement per capability.

type Prerequisite = { id: string; owner: string; status: string };
type Group = { capability: string; items: readonly Prerequisite[] };
const api = onboarding as unknown as {
  AI_AGENT_PREREQUISITES?: readonly Group[];
  AI_AGENTS_COPY_REVIEW_STATUS?: string;
  aiAgentsRefusal?: (
    body: unknown,
  ) => { status: number; code: string; error: string } | null;
};

test("prerequisites are grouped by capability, as the epic assigns them, each Open with an owner role", () => {
  const groups = api.AI_AGENT_PREREQUISITES;
  expect(groups).toBeDefined();
  expect(
    groups!.map((g) => [g.capability, g.items.map((i) => [i.id, i.owner])]),
  ).toEqual([
    [
      "bedrock",
      [
        ["providerDpaRegion", "ownerAndDpo"],
        ["aiHold", "owner"],
        ["iam", "operator"],
      ],
    ],
    [
      "employeeData",
      [
        ["worksCouncil", "worksCouncil"],
        ["retention", "legal"],
      ],
    ],
    ["studio", [["ruling8", "owner"]]],
    ["cowork", [["promptWording", "owner"]]],
  ]);
  for (const g of groups!) for (const i of g.items) expect(i.status).toBe("open");
  // Every label exists in both languages.
  const keys = [
    "onb.agents.heading",
    "onb.agents.status.open",
    ...groups!.map((g) => `onb.agents.cap.${g.capability}`),
    ...groups!.flatMap((g) => g.items.map((i) => `onb.agents.pre.${i.id}`)),
    ...new Set(
      groups!.flatMap((g) => g.items.map((i) => `onb.agents.owner.${i.owner}`)),
    ),
  ];
  for (const key of keys) {
    expect((en as Record<string, string>)[key], key).toBeTruthy();
    expect((de as Record<string, string>)[key], key).toBeTruthy();
  }
  expect(en["onb.agents.cap.bedrock" as keyof typeof en]).toBe(
    "Use Bedrock at all",
  );
  // The wording is a draft until the owner reviews it.
  expect(api.AI_AGENTS_COPY_REVIEW_STATUS).toBe("needs owner review");
});

test("the step stays locked and optional; nothing on it counts", () => {
  expect(
    onboarding.ONBOARDING_STEPS.find((s) => s.id === "agents"),
  ).toEqual({ id: "agents", optional: true, locked: true });
  const project = {
    flightdeckDraft: undefined,
    functionArea: "",
    category: "",
    description: "",
    benefit: "",
    onboarding: undefined,
    onboardingStage: undefined,
    aiAgents: [{ purpose: "x" }],
  } as unknown as Parameters<typeof readinessFor>[0];
  expect(meterFor(project, null, "requester", "agents").total).toBe(8);
  expect(meterFor(project, null, "superAdmin", "review").total).toBe(9);
});

test("a save carrying aiAgents anywhere is refused 400 AI_AGENTS_LOCKED, never stripped", () => {
  const refuse = api.aiAgentsRefusal;
  expect(typeof refuse).toBe("function");
  for (const body of [
    { name: "P", aiAgents: [{ purpose: "triage" }] },
    { name: "P", aiAgents: [] },
    { name: "P", aiAgents: null },
    { name: "P", aiAgents: false },
    { name: "P", onboarding: { countryCode: "DE", aiAgents: [] } },
    { name: "P", flightdeckDraft: { label: "L", aiAgents: [] } },
    { scope: "onboarding", baseRevision: 3, aiAgents: [] },
    { scope: "onboarding", baseRevision: 3, onboarding: { aiAgents: [] } },
  ])
    expect(refuse!(body), JSON.stringify(body)).toMatchObject({
      status: 400,
      code: "AI_AGENTS_LOCKED",
    });
  for (const body of [
    { name: "P" },
    { name: "P", onboarding: { countryCode: "DE" } },
    { scope: "onboarding", baseRevision: 3, onboarding: {} },
    { name: "aiAgents", description: "aiAgents" },
    null,
    "aiAgents",
    [],
  ])
    expect(refuse!(body), JSON.stringify(body)).toBeNull();
});
