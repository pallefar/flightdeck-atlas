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
