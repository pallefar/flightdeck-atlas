import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  STARTER_FIELDS,
  applyStarter,
  approvedStarters,
  loadStarters,
  prefillLabel,
  starterChoices,
  starterPlan,
  starterSchema,
  starterSource,
  starterView,
  undoStarter,
  type Starter,
  type StarterTarget,
} from "../lib/flightdeck/starters";
import { onboardingSchema, settlePrefill } from "../lib/flightdeck/onboarding";

// Starter choice machinery (onb-starter-choice-machinery). Starter content is
// human-owned (plan 2026-09-25 §6, GATE legal/protected content): the list
// ships empty, a starter carries only label-free descriptive fields, and
// with none approved the choice is skipped.

const starter: Starter = {
  id: "pilot-intake",
  version: 2,
  owner: "Process office",
  approvedAt: "2026-09-25T09:00:00.000Z",
  name: "Pilot intake",
  fields: {
    summary: "Starter summary",
    successMeasure: "Starter measure",
    functionArea: "Operations",
    category: "Pilot",
  },
};
const target: StarterTarget = {
  functionArea: "",
  description: "",
  benefit: "Our own measure",
  category: "",
  onboarding: {
    worksCouncilRelevant: "unknown",
    ownerRoles: { process: "Process owner" },
  },
};
const AT = "2026-09-25T10:00:00.000Z";

test("the shipped starter list is empty until the owner approves content", () => {
  const raw = JSON.parse(
    readFileSync("lib/flightdeck/starters.v1.json", "utf8"),
  ) as unknown;
  expect(raw).toEqual([]);
  expect(approvedStarters).toEqual([]);
});

test("a starter holds only descriptive fields; every protected field is refused", () => {
  expect(starterSchema.safeParse(starter).success).toBe(true);
  expect([...STARTER_FIELDS].sort()).toEqual(
    ["category", "functionArea", "successMeasure", "summary"].sort(),
  );
  const protectedFields = {
    worksCouncilRelevant: "yes",
    legalEntity: "Acme GmbH",
    headcountBand: "1-49",
    accessRequested: [{ system: "SAP", level: "read" }],
    ownerRoles: { process: "Owner" },
    countryCode: "DE",
    dataSources: ["HR"],
    coworkRequested: true,
    clause: "Any legal text",
    label: "A name",
  };
  for (const [key, value] of Object.entries(protectedFields)) {
    expect(
      starterSchema.safeParse({
        ...starter,
        fields: { ...starter.fields, [key]: value },
      }).success,
      `fields.${key}`,
    ).toBe(false);
    expect(
      starterSchema.safeParse({ ...starter, [key]: value }).success,
      key,
    ).toBe(false);
  }
  // Version, owner and approval are required; an empty starter is refused.
  for (const drop of ["id", "version", "owner", "approvedAt", "name"]) {
    const copy: Record<string, unknown> = { ...starter };
    delete copy[drop];
    expect(starterSchema.safeParse(copy).success, drop).toBe(false);
  }
  expect(starterSchema.safeParse({ ...starter, fields: {} }).success).toBe(
    false,
  );
  expect(starterSchema.safeParse({ ...starter, version: 0 }).success).toBe(
    false,
  );
  expect(
    starterSchema.safeParse({ ...starter, approvedAt: "yesterday" }).success,
  ).toBe(false);
});

test("a malformed or duplicated list offers no starter at all (fails closed)", () => {
  expect(loadStarters([starter])).toEqual([starter]);
  expect(loadStarters([starter, { ...starter, version: 3 }])).toEqual([]);
  expect(
    loadStarters([
      starter,
      { ...starter, id: "x", fields: { legalEntity: "Acme" } },
    ]),
  ).toEqual([]);
  expect(loadStarters({ starters: [starter] })).toEqual([]);
  expect(loadStarters(null)).toEqual([]);
});

test("the choice is 'Start blank' plus approved starters; with none it is skipped", () => {
  expect(starterChoices([])).toEqual([]);
  expect(starterChoices([starter])).toEqual(["blank", "pilot-intake"]);
  // No approved starter: nothing is shown at all.
  expect(starterView([], target, "blank", null)).toBeNull();
  expect(starterView(approvedStarters, target, "blank", null)).toBeNull();
  // 'Start blank' is the default and fills nothing.
  expect(starterView([starter], target, "blank", null)).toEqual({
    kind: "choose",
    starters: [starter],
    chosen: null,
    plan: [],
  });
  // An id that is not an approved starter chooses nothing.
  expect(starterView([starter], target, "legal-pack", null)).toMatchObject({
    chosen: null,
    plan: [],
  });
  // The component renders from this view (its file imports it).
  expect(readFileSync("app/flightdeck-starter-choice.tsx", "utf8")).toContain(
    "starterView(starters, target, choice, applied)",
  );
  expect(readFileSync("app/flightdeck-onboarding.tsx", "utf8")).toContain(
    "starters={approvedStarters}",
  );
});

test("the preview lists exactly the fields that will fill; a starter never replaces text", () => {
  const plan = [
    { field: "summary", before: "", after: "Starter summary" },
    { field: "functionArea", before: "", after: "Operations" },
    { field: "category", before: "", after: "Pilot" },
  ];
  expect(starterPlan(target, starter)).toEqual(plan);
  expect(starterView([starter], target, "pilot-intake", null)).toEqual({
    kind: "choose",
    starters: [starter],
    chosen: starter,
    plan,
  });
  // The success measure the user wrote is not listed and never replaced.
  expect(starterPlan(target, starter).map((p) => p.field)).not.toContain(
    "successMeasure",
  );
  const full = {
    ...target,
    description: "a",
    functionArea: "b",
    category: "c",
  };
  expect(starterPlan(full, starter)).toEqual([]);
  expect(applyStarter(full, starter, AT).next).toEqual(full);
});

test("applying records provenance starter:<id>@<version>; human facts stay untouched", () => {
  expect(starterSource(starter)).toBe("starter:pilot-intake@2");
  const { next } = applyStarter(target, starter, AT);
  expect(next.description).toBe("Starter summary");
  expect(next.benefit).toBe("Our own measure");
  expect(next.functionArea).toBe("Operations");
  expect(next.category).toBe("Pilot");
  expect(next.onboarding.prefill).toEqual({
    summary: {
      source: "starter:pilot-intake@2",
      at: AT,
      value: "Starter summary",
    },
    functionArea: {
      source: "starter:pilot-intake@2",
      at: AT,
      value: "Operations",
    },
    category: { source: "starter:pilot-intake@2", at: AT, value: "Pilot" },
  });
  expect(next.onboarding.worksCouncilRelevant).toBe("unknown");
  expect(next.onboarding.ownerRoles).toEqual({ process: "Process owner" });
  // The stored draft accepts the entries, and a save keeps them while the
  // fields hold the starter's text.
  expect(onboardingSchema.safeParse(next.onboarding).success).toBe(true);
  expect(
    onboardingSchema.safeParse({
      prefill: { summary: { source: "starter:Bad Id@x", at: AT } },
    }).success,
  ).toBe(false);
  expect(settlePrefill(target, next).onboarding?.prefill).toEqual(
    next.onboarding.prefill,
  );
  expect(prefillLabel("starter:pilot-intake@2", "en")).toContain(
    "pilot-intake",
  );
  expect(prefillLabel("checklist", "en")).toBe(
    "Suggested from the onboarding checklist",
  );
});

test("undo restores the previous values and keeps a field edited since", () => {
  const withEntry = {
    ...target,
    onboarding: {
      ...target.onboarding,
      prefill: {
        summary: { source: "checklist" as const, at: AT },
      },
    },
  };
  const { next, applied } = applyStarter(withEntry, starter, AT);
  expect(undoStarter(next, applied)).toEqual(withEntry);
  // The user rewrote the summary after applying: undo keeps their words.
  const edited = { ...next, description: "Mine now" };
  const undone = undoStarter(edited, applied);
  expect(undone.description).toBe("Mine now");
  expect(undone.benefit).toBe("Our own measure");
  expect(undone.category).toBe("");
  expect(undone.functionArea).toBe("");
});
