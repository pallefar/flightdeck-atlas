import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  createContextClient,
  createSubmissionClient,
  createWhoamiReader,
  type Fetcher,
} from "../lib/flightdeck/context-client";
import {
  buildOnboardingPayload,
  onboardingEnvelope,
  type PayloadProject,
} from "../lib/flightdeck/onboarding";
import {
  FLIGHTDECK_CONTRACT_HEADER,
  FLIGHTDECK_CONTRACT_RANGE,
} from "../lib/flightdeck/contract";

// upd-atlas-contract-advert (plan 2026-09-25 admin/updates; D-035): every
// call Atlas makes to the OS inbound API advertises the contract range Atlas
// supports, so the OS can record last-seen per credential. Nothing here
// contacts FlightDeck OS: a fake fetch captures what would be sent.
const FAKE_CREDENTIAL = "fake-credential-for-tests-0123456789";
const config = { baseUrl: "http://127.0.0.1:4173", token: FAKE_CREDENTIAL };

test("the advertised range is the v1 inbound contract", () => {
  expect(FLIGHTDECK_CONTRACT_HEADER).toBe("X-FlightDeck-Contract");
  expect(FLIGHTDECK_CONTRACT_RANGE).toBe(">=1 <2");
});

test("every inbound call carries X-FlightDeck-Contract and still no workspace or cookie header", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const send: Fetcher = async (url, init) => {
    seen.push({ url, init });
    return new Response("{}", {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };
  const options = { fetch: send, timeoutMs: 50 };
  const context = createContextClient(config, options);
  await context.workspaces();
  await context.projects("hr-de");
  await context.apps!("hr-de");

  const submissions = createSubmissionClient(config, options);
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
  } as unknown as PayloadProject;
  const envelope = onboardingEnvelope(
    buildOnboardingPayload({
      project,
      destinationWorkspaceId: "hr-de",
      idempotencyKey: "0b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d",
      installationId: "atlas-test",
      requestedBy: createHash("sha256").update("u").digest("hex"),
    }),
  );
  await submissions.submit(envelope);
  await submissions.readSubmission("0123456789abcdef01234567");

  await createWhoamiReader(config, new Map(), options)();

  expect(seen.map((s) => `${s.init.method} ${new URL(s.url).pathname}`)).toEqual([
    "GET /api/inbound/v1/context/workspaces",
    "GET /api/inbound/v1/context/workspaces/hr-de/projects",
    "GET /api/inbound/v1/context/workspaces/hr-de/apps",
    "POST /api/inbound/v1/submissions",
    "GET /api/inbound/v1/submissions/0123456789abcdef01234567",
    "GET /api/inbound/v1/whoami",
  ]);
  for (const { init } of seen) {
    const headers = init.headers as Record<string, string>;
    expect(headers[FLIGHTDECK_CONTRACT_HEADER]).toBe(">=1 <2");
    expect(headers.Authorization).toBe(`Bearer ${FAKE_CREDENTIAL}`);
    const names = Object.keys(headers).map((k) => k.toLowerCase());
    expect(names).not.toContain("x-workspace-id");
    expect(names).not.toContain("cookie");
  }
});
