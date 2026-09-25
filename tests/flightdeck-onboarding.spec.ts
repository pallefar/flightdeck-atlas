import { test, expect } from "@playwright/test";
import * as onboarding from "../lib/flightdeck/onboarding";
import { readiness } from "../lib/flightdeck/onboarding";

// One requirement definition with an owning actor per item (plan 2026-09-25
// §7, onb-requirements-by-actor). readiness() keeps its exact output; the
// per-actor count ('n of N for you') is derived from the same definition.

type ReadinessInput = Parameters<typeof readiness>[0];
type Requirement = {
  id: string;
  actor: "requester" | "superAdmin";
  optional: boolean;
  check: (project: ReadinessInput, dest: string | null) => boolean;
};
type ReadinessFor = (
  project: ReadinessInput,
  dest: string | null,
  actor: "requester" | "superAdmin",
  requirements?: readonly Requirement[],
) => {
  items: { key: string; done: boolean }[];
  done: number;
  total: number;
  ready: boolean;
};
const api = onboarding as unknown as {
  REQUIREMENTS?: readonly Requirement[];
  readinessFor?: ReadinessFor;
};

const complete: ReadinessInput = {
  flightdeckDraft: { label: "Harbour pilot" } as ReadinessInput["flightdeckDraft"],
  functionArea: "Operations",
  category: "Automation",
  description: "Automate berth planning",
  benefit: "Fewer idle hours",
  onboarding: {
    countryCode: "DE",
    worksCouncilRelevant: "no",
  } as ReadinessInput["onboarding"],
  onboardingStage: "Ready for FlightDeck",
};
const empty: ReadinessInput = {
  flightdeckDraft: undefined,
  functionArea: "",
  category: "",
  description: "",
  benefit: "",
  onboarding: undefined,
  onboardingStage: undefined,
} as unknown as ReadinessInput;

// Golden: the meter's items, in order, exactly as readiness() returned them
// before the requirement definition existed.
const META = [
  ["label", "Proposed OS project name", "basics", "fd-label"],
  ["destination", "Destination workspace", "review", "fd-destination"],
  ["functionArea", "Function area", "basics", "fd-function"],
  ["category", "Category", "basics", "fd-category"],
  ["summary", "Summary", "basics", "fd-summary"],
  ["successMeasure", "Success measure", "basics", "fd-success"],
  ["countryCode", "Country", "details", "fd-country"],
  ["worksCouncilRelevant", "Works council relevance", "details", "fd-works-council"],
  ["ready", "Marked Ready for FlightDeck", "details", "fd-ready"],
] as const;
const golden = (doneKeys: string[]) => {
  const items = META.map(([key, label, tab, field]) => ({
    key,
    label,
    tab,
    field,
    done: doneKeys.includes(key),
  }));
  const done = items.filter((i) => i.done).length;
  return { items, done, total: 9, ready: done === 9 };
};
const ALL = META.map(([key]) => key as string);

const fixtures: [string, ReadinessInput, string | null, string[]][] = [
  ["empty draft, no destination", empty, null, []],
  ["complete draft, destination chosen", complete, "work-a", ALL],
  [
    "complete draft, destination withheld",
    complete,
    null,
    ALL.filter((k) => k !== "destination"),
  ],
  [
    "whitespace-only text counts as missing",
    {
      ...complete,
      flightdeckDraft: { label: "   " } as ReadinessInput["flightdeckDraft"],
      description: "  ",
    },
    "work-a",
    ALL.filter((k) => k !== "label" && k !== "summary"),
  ],
  [
    "not yet marked ready, no country",
    {
      ...complete,
      onboarding: {
        worksCouncilRelevant: "unknown",
      } as ReadinessInput["onboarding"],
      onboardingStage: "Pilot",
    },
    "work-b",
    ALL.filter((k) => k !== "ready" && k !== "countryCode"),
  ],
];

for (const [name, project, dest, doneKeys] of fixtures)
  test(`readiness() golden output is unchanged: ${name}`, () => {
    expect(readiness(project, dest)).toEqual(golden(doneKeys));
  });

test("REQUIREMENTS is one definition with an owning actor per item", () => {
  const reqs = api.REQUIREMENTS;
  expect(Array.isArray(reqs)).toBe(true);
  expect(reqs!.map((r) => r.id)).toEqual(ALL);
  for (const r of reqs!) {
    expect(["requester", "superAdmin"]).toContain(r.actor);
    expect(typeof r.optional).toBe("boolean");
    expect(typeof r.check).toBe("function");
  }
  // Only the Super Admin picks the destination; editors never see workspaces.
  expect(reqs!.filter((r) => r.actor === "superAdmin").map((r) => r.id)).toEqual([
    "destination",
  ]);
});

test("AI agents and Apps are never requirements", () => {
  const reqs = api.REQUIREMENTS!;
  expect(reqs.length).toBeGreaterThan(0);
  for (const r of reqs)
    expect(r.id).not.toMatch(/agent|app|cowork|subapp/i);
});

test("readinessFor counts only the viewing actor's non-optional items", () => {
  const readinessFor = api.readinessFor!;
  expect(typeof readinessFor).toBe("function");
  const requester = readinessFor(empty, null, "requester");
  expect(requester.total).toBe(8);
  expect(requester.done).toBe(0);
  expect(requester.items.map((i) => i.key)).not.toContain("destination");
  const admin = readinessFor(empty, null, "superAdmin");
  expect(admin.total).toBe(1);
  expect(admin.items.map((i) => i.key)).toEqual(["destination"]);
  expect(readinessFor(complete, null, "requester")).toMatchObject({
    done: 8,
    total: 8,
    ready: true,
  });
  expect(readinessFor(complete, null, "superAdmin").ready).toBe(false);
  expect(readinessFor(complete, "work-a", "superAdmin")).toMatchObject({
    done: 1,
    total: 1,
    ready: true,
  });
  // Send gating still needs every item: the requester being done is not
  // enough while the destination is missing.
  expect(readiness(complete, null).ready).toBe(false);
});

test("adding a requirement changes N with no UI edit; optional items never count", () => {
  const readinessFor = api.readinessFor!;
  const base = api.REQUIREMENTS!;
  const extra: Requirement = {
    id: "legalEntity",
    actor: "requester",
    optional: false,
    check: (p) => !!p.onboarding?.legalEntity,
  };
  const optional: Requirement = {
    id: "headcountBand",
    actor: "requester",
    optional: true,
    check: () => false,
  };
  const withExtra = readinessFor(complete, "work-a", "requester", [
    ...base,
    extra,
    optional,
  ]);
  expect(withExtra.total).toBe(9);
  expect(withExtra.done).toBe(8);
  expect(withExtra.ready).toBe(false);
  expect(withExtra.items.map((i) => i.key)).not.toContain("headcountBand");
  expect(
    readinessFor(complete, "work-a", "superAdmin", [...base, extra]).total,
  ).toBe(1);
});

// Guided stepper (onb-atlas-stepper, plan 2026-09-25 §7 J2): named steps,
// the meter a viewer sees on each step, and the errors 'Next' reports.
type Step = "basics" | "details" | "apps" | "agents" | "review";
const stepper = onboarding as unknown as {
  ONBOARDING_STEPS?: readonly { id: Step; optional: boolean; locked: boolean }[];
  meterFor?: (
    project: ReadinessInput,
    dest: string | null,
    viewer: "requester" | "superAdmin",
    step: Step,
  ) => {
    items: { key: string; tab: string; field: string; done: boolean }[];
    done: number;
    total: number;
    ready: boolean;
  };
  stepErrors?: (
    project: ReadinessInput,
    dest: string | null,
    viewer: "requester" | "superAdmin",
    step: Step,
  ) => { key: string; tab: string; field: string }[];
};

test("the stepper names Basics, Details, Apps (optional), AI agents (locked) and Review", () => {
  expect(stepper.ONBOARDING_STEPS).toEqual([
    { id: "basics", optional: false, locked: false },
    { id: "details", optional: false, locked: false },
    { id: "apps", optional: true, locked: false },
    { id: "agents", optional: true, locked: true },
    { id: "review", optional: false, locked: false },
  ]);
  // Every requirement lives on a step the stepper shows.
  const ids = stepper.ONBOARDING_STEPS!.map((s) => s.id as string);
  for (const r of api.REQUIREMENTS!)
    expect(ids).toContain((r as unknown as { tab: string }).tab);
});

test("an editor's meter is 'n of 8 for you' on every step; the Super Admin adds the destination on Review only", () => {
  const meterFor = stepper.meterFor!;
  expect(typeof meterFor).toBe("function");
  for (const step of ["basics", "details", "apps", "agents", "review"] as const) {
    const editor = meterFor(empty, null, "requester", step);
    expect({ step, total: editor.total }).toEqual({ step, total: 8 });
    expect(editor.items.map((i) => i.key)).not.toContain("destination");
  }
  for (const step of ["basics", "details", "apps", "agents"] as const) {
    const admin = meterFor(complete, null, "superAdmin", step);
    expect({ step, total: admin.total, ready: admin.ready }).toEqual({
      step,
      total: 8,
      ready: true,
    });
  }
  const review = meterFor(complete, null, "superAdmin", "review");
  expect(review).toEqual(readiness(complete, null));
  expect(review.total).toBe(9);
  expect(review.items.find((i) => i.key === "destination")?.done).toBe(false);
  expect(meterFor(complete, "work-a", "superAdmin", "review").ready).toBe(true);
});

test("'Next' reports only the viewer's missing items on the current step", () => {
  const stepErrors = stepper.stepErrors!;
  expect(typeof stepErrors).toBe("function");
  expect(stepErrors(empty, null, "requester", "basics").map((e) => e.key)).toEqual(
    ["label", "functionArea", "category", "summary", "successMeasure"],
  );
  expect(stepErrors(empty, null, "requester", "details").map((e) => e.key)).toEqual(
    ["countryCode", "worksCouncilRelevant", "ready"],
  );
  // Optional and locked steps never block, and an editor is never told to
  // pick the Super Admin's destination.
  expect(stepErrors(empty, null, "requester", "apps")).toEqual([]);
  expect(stepErrors(empty, null, "requester", "agents")).toEqual([]);
  expect(stepErrors(empty, null, "requester", "review")).toEqual([]);
  expect(
    stepErrors(complete, null, "superAdmin", "review").map((e) => e.key),
  ).toEqual(["destination"]);
  expect(stepErrors(complete, null, "requester", "basics")).toEqual([]);
  expect(stepErrors(empty, null, "requester", "basics")[0]).toMatchObject({
    tab: "basics",
    field: "fd-label",
  });
});

// The reviewer note's field pointers (onb-atlas-decision-note; D-037 item 5).
// FlightDeck names the payload's own fields (its published contract,
// features.decisionNote.fieldPointers); each one outlines its form fields and
// badges the step they live on.
test.describe("reviewer field pointers", () => {
  const api = onboarding as unknown as {
    FIELD_POINTERS: readonly string[];
    flaggedFields?: (fields: readonly unknown[] | undefined) => {
      ids: Set<string>;
      steps: Set<string>;
      pointers: { pointer: string; label: string; step: string; field: string }[];
    };
  };

  test("the allowlist is the OS contract's, exactly", () => {
    expect([...api.FIELD_POINTERS]).toEqual([
      "summary",
      "successMeasure",
      "functionArea",
      "category",
      "status",
      "priority",
      "targetDate",
      "site",
      "countryCode",
      "legalEntity",
      "headcountBand",
      "worksCouncilRelevant",
      "ownerRoles",
      "dataSources",
      "accessRequested",
      "coworkRequested",
    ]);
  });

  test("each pointer outlines its fields and badges its step; unknown pointers are ignored", () => {
    expect(typeof api.flaggedFields).toBe("function");
    const flagged = api.flaggedFields!([
      "site",
      "ownerRoles",
      "requestedBy",
      "profile.site",
      7,
    ]);
    expect([...flagged.ids].sort()).toEqual([
      "fd-role-data",
      "fd-role-process",
      "fd-role-support",
      "fd-site",
    ]);
    expect([...flagged.steps].sort()).toEqual(["basics", "details"]);
    expect(flagged.pointers).toEqual([
      { pointer: "site", label: "Site", step: "basics", field: "fd-site" },
      {
        pointer: "ownerRoles",
        label: "Owner roles",
        step: "details",
        field: "fd-role-process",
      },
    ]);
    // Every allowlisted pointer maps to a form field on a real step.
    const all = api.flaggedFields!(api.FIELD_POINTERS);
    expect(all.pointers).toHaveLength(api.FIELD_POINTERS.length);
    for (const p of all.pointers)
      expect(["basics", "details"]).toContain(p.step);
    expect(api.flaggedFields!(undefined).ids.size).toBe(0);
  });
});
