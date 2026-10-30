import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  CONTRACT_IDS,
  stepsContract,
  workflowContract,
  parseSteps,
  parseWorkflow,
  evidenceContract,
  gateEventContract,
  parseEvidence,
  parseGateEvent,
  parseRecord,
  parseValue,
  recordContract,
  valueContract,
} from "../lib/domain/contracts";

// The four contracts Atlas v1 defines, checked two ways:
// 1. each recorded fixture parses, and its .sha256 matches the bytes;
// 2. the zod schema and schema/*.schema.json still describe the SAME object.
//
// (2) is the part that matters long term: the JSON Schema is what the macOS
// client is generated from, so a field added to zod without the schema would
// silently make the native client narrower than the web. This test fails
// instead. Nothing here contacts FlightDeck OS.
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** Peel the wrappers zod adds, remembering which ones were there. */
function peel(schema: z.ZodTypeAny) {
  let nullable = false;
  let optional = false;
  let current: z.ZodTypeAny = schema;
  for (;;) {
    const name = current._def.typeName;
    if (name === "ZodNullable") nullable = true;
    else if (name === "ZodOptional") optional = true;
    // A defaulted field is optional on the wire: the schema supplies it.
    else if (name === "ZodDefault") optional = true;
    else if (name !== "ZodEffects") break;
    current = (current._def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny })
      .innerType ?? (current._def as { schema: z.ZodTypeAny }).schema;
  }
  return { schema: current, nullable, optional };
}
type Shape =
  | { kind: "string" | "number" | "boolean" }
  | { kind: "const"; value: string | number | boolean | null }
  | { kind: "enum"; values: string[] }
  | { kind: "array"; items: Shape }
  | {
      kind: "object";
      properties: Record<string, Shape>;
      required: string[];
    };
/** What a zod schema says, in the same vocabulary as a JSON Schema node. */
function fromZod(schema: z.ZodTypeAny): { shape: Shape; nullable: boolean } {
  const { schema: inner, nullable, optional } = peel(schema);
  const def = inner._def;
  let shape: Shape;
  switch (def.typeName) {
    case "ZodString":
      shape = { kind: "string" };
      break;
    case "ZodNumber":
      shape = { kind: "number" };
      break;
    case "ZodBoolean":
      shape = { kind: "boolean" };
      break;
    case "ZodLiteral":
      shape = { kind: "const", value: (def as { value: string }).value };
      break;
    case "ZodEnum":
      shape = {
        kind: "enum",
        values: [...(def as { values: string[] }).values].sort(),
      };
      break;
    case "ZodArray":
      shape = {
        kind: "array",
        items: fromZod((def as { type: z.ZodTypeAny }).type).shape,
      };
      break;
    case "ZodObject": {
      const properties = Object.fromEntries(
        Object.entries(
          (def as { shape: () => Record<string, z.ZodTypeAny> }).shape(),
        ).map(([key, value]) => [key, fromZod(value).shape]),
      );
      const required = Object.entries(
        (def as { shape: () => Record<string, z.ZodTypeAny> }).shape(),
      )
        .filter(([, value]) => !value.isOptional())
        .map(([key]) => key)
        .sort();
      shape = { kind: "object", properties, required };
      break;
    }
    default:
      throw new Error(`unhandled zod type ${String(def.typeName)}`);
  }
  return { shape, nullable: nullable && !optional };
}
/** What the JSON Schema file says, in the same vocabulary. */
function fromJson(node: Record<string, unknown>): {
  shape: Shape;
  nullable: boolean;
} {
  const types = Array.isArray(node.type)
    ? (node.type as string[])
    : [node.type as string | undefined];
  const nullable =
    types.includes("null") ||
    (Array.isArray(node.enum) && (node.enum as unknown[]).includes(null));
  const nonNull = types.filter((t) => t && t !== "null")[0];
  if (node.const !== undefined)
    return {
      shape: { kind: "const", value: node.const as string },
      nullable,
    };
  if (Array.isArray(node.enum))
    return {
      shape: {
        kind: "enum",
        values: (node.enum as unknown[])
          .filter((v) => v !== null)
          .map(String)
          .sort(),
      },
      nullable,
    };
  if (nonNull === "array")
    return {
      shape: {
        kind: "array",
        items: fromJson(node.items as Record<string, unknown>).shape,
      },
      nullable,
    };
  if (nonNull === "object") {
    const properties = node.properties as Record<string, Record<string, unknown>>;
    return {
      shape: {
        kind: "object",
        properties: Object.fromEntries(
          Object.entries(properties).map(([key, child]) => [
            key,
            fromJson(child).shape,
          ]),
        ),
        required: [...((node.required as string[]) ?? [])].sort(),
      },
      nullable,
    };
  }
  if (nonNull === "number" || nonNull === "integer")
    return { shape: { kind: "number" }, nullable };
  if (nonNull === "boolean") return { shape: { kind: "boolean" }, nullable };
  return { shape: { kind: "string" }, nullable };
}
const schemaFile = (name: string) =>
  JSON.parse(
    readFileSync(`./schema/${name}`, "utf8"),
  ) as Record<string, unknown>;
const cases = [
  {
    name: "atlas-evidence",
    fixture: "atlas-evidence.v1.json",
    schema: evidenceContract as z.ZodTypeAny,
    id: CONTRACT_IDS.evidence,
  },
  {
    name: "atlas-gate-event",
    fixture: "atlas-gate-event.v1.json",
    schema: gateEventContract as z.ZodTypeAny,
    id: CONTRACT_IDS.gateEvent,
  },
  {
    name: "atlas-value",
    fixture: "atlas-value.v1.json",
    schema: valueContract as z.ZodTypeAny,
    id: CONTRACT_IDS.value,
  },
  {
    name: "atlas-onboarding-record",
    fixture: "atlas-onboarding-record.v1.json",
    schema: recordContract as z.ZodTypeAny,
    id: CONTRACT_IDS.record,
  },
  {
    name: "atlas-process-steps",
    fixture: "atlas-process-steps.v1.json",
    schema: stepsContract as z.ZodTypeAny,
    id: CONTRACT_IDS.steps,
  },
  {
    name: "atlas-workflow-draft",
    fixture: "atlas-workflow-draft.v1.json",
    schema: workflowContract as z.ZodTypeAny,
    id: CONTRACT_IDS.workflow,
  },
] as const;
test.describe("contract fixtures", () => {
  for (const testCase of cases) {
    test(`${testCase.id}: the fixture parses and its hash is the recorded one`, () => {
      const value = fixture(testCase.fixture);
      const expected = readFileSync(
        new URL(`./fixtures/${testCase.fixture.replace(/\.json$/, ".sha256")}`, import.meta.url),
        "utf8",
      ).trim();
      const bytes = readFileSync(
        new URL(`./fixtures/${testCase.fixture}`, import.meta.url),
        "utf8",
      );
      expect(digest(bytes)).toBe(expected);
      const parsed = testCase.schema.safeParse(value);
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(value.contract).toBe(testCase.id);
    });
    test(`${testCase.id}: an unknown version is refused, not coerced`, () => {
      const bad = { ...fixture(testCase.fixture), contract: "atlas-something/9" };
      const result =
        testCase.id === CONTRACT_IDS.evidence
          ? parseEvidence(bad)
          : testCase.id === CONTRACT_IDS.gateEvent
            ? parseGateEvent(bad)
            : testCase.id === CONTRACT_IDS.value
              ? parseValue(bad)
              : testCase.id === CONTRACT_IDS.steps
                ? parseSteps(bad)
                : testCase.id === CONTRACT_IDS.workflow
                  ? parseWorkflow(bad)
                  : parseRecord(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("wrong_version");
    });
    test(`${testCase.id}: an unknown key is refused as an unknown key`, () => {
      const bad = { ...fixture(testCase.fixture), surprise: 1 };
      const result =
        testCase.id === CONTRACT_IDS.evidence
          ? parseEvidence(bad)
          : testCase.id === CONTRACT_IDS.gateEvent
            ? parseGateEvent(bad)
            : testCase.id === CONTRACT_IDS.value
              ? parseValue(bad)
              : testCase.id === CONTRACT_IDS.steps
                ? parseSteps(bad)
                : testCase.id === CONTRACT_IDS.workflow
                  ? parseWorkflow(bad)
                  : parseRecord(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("unknown_key");
    });
  }
});
test.describe("the TS schema and the JSON Schema agree", () => {
  for (const testCase of cases) {
    test(`${testCase.id}: same properties, same required, same enums`, () => {
      const json = fromJson(schemaFile(`${testCase.name}.schema.json`));
      const zod = fromZod(testCase.schema);
      expect(zod.nullable).toBe(json.nullable);
      expect(zod.shape).toEqual(json.shape);
    });
    test(`${testCase.id}: the schema file names the contract it describes`, () => {
      expect(schemaFile(`${testCase.name}.schema.json`)["$id"]).toBe(testCase.id);
    });
  }
});
test.describe("refusals that carry a reason the caller can act on", () => {
  test("a measured value with no source is refused at sourceRef", () => {
    const bad = { ...fixture("atlas-value.v1.json"), sourceRef: null };
    const result = parseValue(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid");
      expect(result.problems.join(" ")).toContain("sourceRef");
    }
  });
  test("a not-tracked value may not carry figures", () => {
    const bad = {
      ...fixture("atlas-value.v1.json"),
      basis: "not-tracked",
      hours: 12,
    };
    expect(parseValue(bad).ok).toBe(false);
  });
  test("an evidence finding travels as a code, never as a value", () => {
    const bad = {
      ...fixture("atlas-evidence.v1.json"),
      findings: ["Found email: anna.schmidt@example.com"],
    };
    expect(parseEvidence(bad).ok).toBe(false);
  });
  test("a blocked classification is still a valid evidence body (the route refuses it)", () => {
    // The contract describes what is stored; the governance scan decides what
    // may be stored. Keeping these separate is what lets a reviewer read an
    // existing blocked row without the parser lying about the class.
    const body = { ...fixture("atlas-evidence.v1.json"), classification: "cui" };
    expect(parseEvidence(body).ok).toBe(true);
  });
  test("a test run may not have written anything", () => {
    const bad = {
      ...fixture("atlas-workflow-draft.v1.json"),
      testReport: {
        ranAt: "2026-10-30T09:10:00.000Z",
        cases: 1,
        wroteAnything: true,
        notes: "It wrote a case.",
      },
    };
    const result = parseWorkflow(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("writes nothing");
  });
  test("a step may name the suite app that does it, but only a real one", () => {
    const good = fixture("atlas-workflow-draft.v1.json");
    expect(parseWorkflow(good).ok).toBe(true);
    // The apps are the OS sub-app ids; anything else is a typo, not a system.
    const bad = {
      ...good,
      steps: good.steps.map((step: { action: string }, index: number) =>
        index === 0 ? { ...step, app: "sap" } : step,
      ),
    };
    expect(parseWorkflow(bad).ok).toBe(false);
  });
  test("a three-step workflow cannot claim to need Studio", () => {
    const bad = { ...fixture("atlas-workflow-draft.v1.json"), complexity: "studio" };
    const result = parseWorkflow(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("simple workflow");
  });
  test("process steps keep their source labels and refuse an empty action", () => {
    const good = fixture("atlas-process-steps.v1.json");
    expect(good.steps.map((step: { number: string }) => step.number)).toEqual(["10", "20"]);
    const bad = {
      ...good,
      steps: [{ ...good.steps[0], action: "" }],
    };
    expect(parseSteps(bad).ok).toBe(false);
  });
  test("a gate event whose hash is not sha256 is refused", () => {
    const bad = { ...fixture("atlas-gate-event.v1.json"), hash: "nope" };
    expect(parseGateEvent(bad).ok).toBe(false);
  });
});
