import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Project } from "../lib/projects";
import {
  FIELD_POINTERS,
  buildOnboardingPayload,
  parseSubmissionStatus,
  type PayloadProject,
} from "../lib/flightdeck/onboarding";
import {
  FEATURES_MAX_AGE_MS,
  FEATURE_PAYLOAD_FIELDS,
  INBOUND_FEATURES,
  NO_FEATURES,
  createFeatureReader,
  parseWhoamiFeatures,
  type InboundFeatures,
} from "../lib/flightdeck/features";
import {
  WHOAMI_PATH,
  createWhoamiLoader,
} from "../lib/flightdeck/context-client";

// Contract tolerance (plan 2026-09-25 §7 lane A, onb-atlas-contract-tolerance;
// D-035 delegation, D-037). Atlas must parse what the OS advertises and reads
// back BEFORE the OS emits it, and must never send a field whose feature is
// off for its credential (the OS answers 400 FEATURE_OFF, never strips).
//
// The contract fixture is docs/developers/inbound-contract.json copied byte
// for byte from the OS repo at commit c1cb3e5f48284db4a1cc69667cb70650c569c29b
// (onb-contract-capabilities: features.* on GET /v1/whoami). Nothing here
// contacts FlightDeck OS.
const SOURCE_COMMIT = "c1cb3e5f48284db4a1cc69667cb70650c569c29b";
const contract = JSON.parse(
  readFileSync(
    new URL("./fixtures/os-inbound-contract.json", import.meta.url),
    "utf8",
  ),
);
const legacy = JSON.parse(
  readFileSync(
    new URL("./fixtures/os-project-onboarding.json", import.meta.url),
    "utf8",
  ),
);
const whoamiExample = () =>
  structuredClone(
    contract.routes
      .find((r: { operationId: string }) => r.operationId === "whoami")
      .responses.find((r: { status: number }) => r.status === 200).example,
  ) as Record<string, unknown>;
const readBack = (extra: Record<string, unknown>) => ({
  ...legacy.readBack.base,
  ...extra,
});
const SUB = "0a1b2c3d4e5f60718293a4b5";
const PRED = "ffeeddccbbaa998877665544";

test.describe("contract fixture provenance", () => {
  test("the fixture is the OS contract that advertises features, and Atlas knows exactly its flags", () => {
    expect(contract.contract).toBe("flightdeck-inbound-contract/1");
    // Recorded source: the commit that added the features section.
    expect(SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(contract.features.flags)).toEqual([...INBOUND_FEATURES]);
    const payloadFields = Object.fromEntries(
      Object.entries(
        contract.features.flags as Record<string, { payloadField: string }>,
      )
        .filter(([, flag]) => flag.payloadField)
        .map(([name, flag]) => [name, flag.payloadField]),
    );
    expect(FEATURE_PAYLOAD_FIELDS).toEqual(payloadFields);
    expect(
      contract.components.schemas.WhoamiResponse.properties.features.required,
    ).toEqual([...INBOUND_FEATURES]);
  });
});

test.describe("whoami features", () => {
  test("the contract's whoami parses; every flag it advertises today is false", () => {
    expect(parseWhoamiFeatures(whoamiExample())).toEqual(NO_FEATURES);
    const on = whoamiExample();
    on.features = { ...(on.features as object), decisionNote: true };
    expect(parseWhoamiFeatures(on)).toEqual({
      ...NO_FEATURES,
      decisionNote: true,
    });
  });

  test("an older OS without features parses, and a missing or odd flag means false", () => {
    const old = whoamiExample();
    delete old.features;
    delete old.bridgeMediaCrossOrigin;
    expect(parseWhoamiFeatures(old)).toEqual(NO_FEATURES);
    const partial = whoamiExample();
    partial.features = {
      supersedes: true,
      aiAgents: "true",
      somethingNew: true,
    };
    expect(parseWhoamiFeatures(partial)).toEqual({
      ...NO_FEATURES,
      supersedes: true,
    });
    const junk = whoamiExample();
    junk.features = "all";
    expect(parseWhoamiFeatures(junk)).toEqual(NO_FEATURES);
    // Not a whoami answer at all: no features can be read from it.
    expect(parseWhoamiFeatures(null)).toBeNull();
    expect(parseWhoamiFeatures({ error: "nope" })).toBeNull();
  });

  test("features are re-read when older than five minutes, and a failed read turns every flag off", async () => {
    expect(FEATURES_MAX_AGE_MS).toBe(5 * 60_000);
    let clock = 0;
    let loads = 0;
    let answer: unknown = {
      ...whoamiExample(),
      features: { ...NO_FEATURES, supersedes: true },
    };
    const reader = createFeatureReader(
      async () => {
        loads++;
        return answer;
      },
      { now: () => clock },
    );
    expect((await reader.read()).supersedes).toBe(true);
    clock += FEATURES_MAX_AGE_MS; // exactly five minutes: still fresh
    expect((await reader.read()).supersedes).toBe(true);
    expect(loads).toBe(1);
    clock += 1; // stale: read again before the send
    answer = whoamiExample();
    expect((await reader.read()).supersedes).toBe(false);
    expect(loads).toBe(2);
    // A failed read is never cached and never turns a flag on.
    clock += FEATURES_MAX_AGE_MS + 1;
    answer = null;
    expect(await reader.read()).toEqual(NO_FEATURES);
    const failing = createFeatureReader(
      async () => {
        throw new Error("down");
      },
      { now: () => clock },
    );
    expect(await failing.read()).toEqual(NO_FEATURES);
    answer = {
      ...whoamiExample(),
      features: { ...NO_FEATURES, aiAgents: true },
    };
    expect((await reader.read()).aiAgents).toBe(true);
    expect(loads).toBe(4);
  });
});

test.describe("whoami transport", () => {
  test("whoami is a bearer-only GET, a non-200 is no answer, and a 429 blocks the credential's other calls", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    let reply = () =>
      new Response(JSON.stringify(whoamiExample()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const cache = new Map<string, { until: number }>();
    const clock = 1_000;
    const load = createWhoamiLoader(
      {
        baseUrl: "http://127.0.0.1:4173",
        token: "fake-credential-for-tests-0123456789",
      },
      cache,
      {
        fetch: async (url, init) => {
          seen.push({ url, init });
          return reply();
        },
        now: () => clock,
      },
    );
    expect(parseWhoamiFeatures(await load())).toEqual(NO_FEATURES);
    expect(seen[0].url).toBe(`http://127.0.0.1:4173${WHOAMI_PATH}`);
    expect(seen[0].init.method).toBe("GET");
    expect(Object.keys(seen[0].init.headers as object).sort()).toEqual([
      "Accept",
      "Authorization",
    ]);
    reply = () =>
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    expect(await load()).toBeNull();
    reply = () =>
      new Response(JSON.stringify({ retryAfterSeconds: 42 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    expect(await load()).toBeNull();
    expect(cache.get("rate-limit")?.until).toBe(clock + 42_000);
    // While blocked, no request leaves at all.
    const before = seen.length;
    expect(await load()).toBeNull();
    expect(seen.length).toBe(before);
  });
});

test.describe("read-back tolerance", () => {
  test("an old read-back still parses, with none of the new optionals", () => {
    for (const name of ["filed", "promoted", "rejected"]) {
      const body = readBack(legacy.readBack[name] ?? { state: name });
      const parsed = parseSubmissionStatus(body);
      expect(parsed).not.toBeNull();
      for (const key of [
        "note",
        "fields",
        "supersedes",
        "supersededBy",
        "decidedAt",
      ])
        expect(parsed).not.toHaveProperty(key);
    }
  });

  test("a read-back with note, fields, supersedes, supersededBy and decidedAt parses into typed optionals", () => {
    const parsed = parseSubmissionStatus(
      readBack({
        state: "rejected",
        outcome: { reasonCode: "needs-more-info" },
        note: "Please name the data owner's role.",
        fields: ["facts.ownerRoles.data", "profile.summary"],
        supersedes: PRED,
        supersededBy: SUB.replace("0a", "1b"),
        decidedAt: "2026-09-23T10:00:00.000Z",
      }),
    );
    expect(parsed).toMatchObject({
      state: "rejected",
      reasonCode: "needs-more-info",
      note: "Please name the data owner's role.",
      fields: ["facts.ownerRoles.data", "profile.summary"],
      supersedes: PRED,
      supersededBy: "1b1b2c3d4e5f60718293a4b5",
      decidedAt: "2026-09-23T10:00:00.000Z",
    });
    // The OS may carry the note with the decision's outcome instead.
    const inOutcome = parseSubmissionStatus(
      readBack({
        state: "rejected",
        outcome: {
          reasonCode: "needs-more-info",
          note: "Which site?",
          fields: ["profile.site"],
        },
      }),
    );
    expect(inOutcome).toMatchObject({
      reasonCode: "needs-more-info",
      note: "Which site?",
      fields: ["profile.site"],
    });
  });

  test("a malformed optional is dropped without failing the read-back", () => {
    const parsed = parseSubmissionStatus(
      readBack({
        state: "filed",
        note: "x".repeat(501),
        fields: "profile.site",
        supersedes: "not-an-id",
        supersededBy: 42,
        decidedAt: "yesterday",
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.state).toBe("filed");
    for (const key of [
      "note",
      "fields",
      "supersedes",
      "supersededBy",
      "decidedAt",
    ])
      expect(parsed).not.toHaveProperty(key);
  });

  test("an unknown field-pointer value is dropped and logged as a count only", () => {
    expect(FIELD_POINTERS).toContain("facts.ownerRoles.data");
    expect(FIELD_POINTERS).not.toContain("requestedBy");
    const logged: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void logged.push(args);
    try {
      const parsed = parseSubmissionStatus(
        readBack({
          state: "rejected",
          outcome: { reasonCode: "needs-more-info" },
          fields: [
            "profile.site",
            "sponsor.secretName",
            "requestedBy",
            7,
            "profile.site",
          ],
        }),
      );
      expect(parsed!.fields).toEqual(["profile.site"]);
    } finally {
      console.warn = warn;
    }
    expect(logged).toHaveLength(1);
    const line = logged[0].map(String).join(" ");
    expect(line).toContain("3");
    expect(line).not.toContain("sponsor");
    expect(line).not.toContain("requestedBy");
    // An injected sink receives the count and nothing else.
    const counts: number[] = [];
    parseSubmissionStatus(
      readBack({ state: "filed", fields: ["nope", "profile.site"] }),
      { onUnknownFieldPointers: (count) => counts.push(count) },
    );
    expect(counts).toEqual([1]);
  });
});

test.describe("send path gating", () => {
  const project = {
    id: "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6",
    revision: 3,
    description: "Move payroll approvals into one reviewed flow.",
    benefit: "Approval time halves.",
    functionArea: "HR",
    category: "Pilot",
    status: "In progress",
    priority: "High",
    dueDate: "",
    location: "",
    flightdeckDraft: { label: "Payroll rollout" },
    onboarding: { countryCode: "DE", worksCouncilRelevant: "no" },
    tasks: [],
  } as unknown as PayloadProject satisfies Partial<Project>;
  const base = {
    project,
    destinationWorkspaceId: "hr-de",
    idempotencyKey: "0b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d",
    installationId: "atlas-test",
    requestedBy: createHash("sha256").update("u").digest("hex"),
  };
  const gated = {
    supersedes: PRED,
    requestedSubapps: ["maps"],
    aiAgents: [{ id: "a" }],
  };

  test("the payload builder omits every field whose flag is false", () => {
    const today = buildOnboardingPayload(base);
    const off = buildOnboardingPayload({
      ...base,
      features: NO_FEATURES,
      gated,
    });
    // Flags off: byte-identical to the payload without any optional input.
    expect(JSON.stringify(off)).toBe(JSON.stringify(today));
    for (const field of Object.values(FEATURE_PAYLOAD_FIELDS))
      expect(off).not.toHaveProperty(field);
    // No features read at all: fail closed, nothing gated is sent.
    expect(JSON.stringify(buildOnboardingPayload({ ...base, gated }))).toBe(
      JSON.stringify(today),
    );
    const some: InboundFeatures = { ...NO_FEATURES, supersedes: true };
    const on = buildOnboardingPayload({ ...base, features: some, gated });
    expect(on).toMatchObject({ supersedes: PRED });
    expect(on).not.toHaveProperty("requestedSubapps");
    expect(on).not.toHaveProperty("aiAgents");
    // A flag that gates no payload field never adds one.
    const noteOnly = buildOnboardingPayload({
      ...base,
      features: { ...NO_FEATURES, decisionNote: true, appDiscovery: true },
      gated,
    });
    expect(JSON.stringify(noteOnly)).toBe(JSON.stringify(today));
  });
});
