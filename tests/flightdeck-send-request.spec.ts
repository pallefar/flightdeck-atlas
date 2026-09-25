import { test, expect } from "@playwright/test";
import {
  buildOnboardingPayload,
  onboardingSchema,
  resolveSendRequest,
  requesterRequestsEnabled,
  type OnboardingDraft,
} from "../lib/flightdeck/onboarding";
import { examples, projectSchema } from "../lib/projects";

// onb-atlas-ask-persistence: the "ask the Super Admin to send revision r"
// marker lives inside the onboarding JSON (no table, no migration), behind
// ATLAS_REQUESTER_REQUESTS (default off, D-037 item 4). Only the Super Admin
// sends (D-033 decision 7); this marker never sends anything.

const EDITOR = "editor@example.com";
const ADMIN = "admin@example.com";
const ask = {
  revision: 7,
  by: EDITOR,
  at: "2026-09-25T10:00:00.000Z",
};

test("the flag is on only for the exact string 'true'", () => {
  expect(requesterRequestsEnabled(undefined)).toBe(false);
  expect(requesterRequestsEnabled("")).toBe(false);
  expect(requesterRequestsEnabled("1")).toBe(false);
  expect(requesterRequestsEnabled("TRUE")).toBe(false);
  expect(requesterRequestsEnabled("yes")).toBe(false);
  expect(requesterRequestsEnabled("true")).toBe(true);
  expect(requesterRequestsEnabled(" true ")).toBe(true);
});

test("sendRequest is Zod-validated inside the onboarding JSON, strictly", () => {
  expect(
    onboardingSchema.safeParse({ countryCode: "DE", sendRequest: ask }).success,
  ).toBe(true);
  expect(
    onboardingSchema.safeParse({
      sendRequest: { ...ask, withdrawnAt: "2026-09-25T11:00:00.000Z" },
    }).success,
  ).toBe(true);
  // The whole project schema carries it through the onboarding field.
  const { id: _id, revision: _rev, ...example } = examples[0];
  void _id;
  void _rev;
  const project = projectSchema.safeParse({
    ...example,
    onboarding: { sendRequest: ask },
  });
  expect(project.success).toBe(true);
  expect(project.data?.onboarding?.sendRequest).toEqual(ask);
  for (const bad of [
    { ...ask, revision: 0 },
    { ...ask, revision: 1.5 },
    { ...ask, revision: "7" },
    { ...ask, by: "not an email" },
    { ...ask, by: "" },
    { ...ask, at: "yesterday" },
    { ...ask, withdrawnAt: "later" },
    { ...ask, note: "please hurry" },
    { revision: 7, by: EDITOR },
  ])
    expect(
      onboardingSchema.safeParse({ sendRequest: bad }).success,
      JSON.stringify(bad),
    ).toBe(false);
});

test("with the flag off, any save carrying a new or changed sendRequest is refused 400", () => {
  for (const flag of [undefined, "", "false", "1"]) {
    const r = resolveSendRequest({
      previous: { countryCode: "DE" },
      next: { countryCode: "DE", sendRequest: ask },
      enabled: requesterRequestsEnabled(flag),
      actor: EDITOR,
    });
    expect(r, String(flag)).toMatchObject({
      ok: false,
      status: 400,
      code: "requester_requests_off",
    });
  }
  // No previous onboarding at all: still refused.
  expect(
    resolveSendRequest({
      previous: undefined,
      next: { sendRequest: ask },
      enabled: false,
      actor: EDITOR,
    }),
  ).toMatchObject({ ok: false, status: 400 });
  // Withdrawing is a write too.
  expect(
    resolveSendRequest({
      previous: { sendRequest: ask },
      next: {
        sendRequest: { ...ask, withdrawnAt: "2026-09-25T11:00:00.000Z" },
      },
      enabled: false,
      actor: ADMIN,
    }),
  ).toMatchObject({ ok: false, status: 400 });
  // Saves without a marker are untouched.
  expect(
    resolveSendRequest({
      previous: { countryCode: "DE" },
      next: { countryCode: "FR" },
      enabled: false,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: { countryCode: "FR" } });
});

test("with the flag on, an ask is stored as asked and must name the asker", () => {
  const stored = resolveSendRequest({
    previous: { countryCode: "DE" },
    next: { countryCode: "DE", sendRequest: ask },
    enabled: true,
    actor: EDITOR,
  });
  expect(stored).toEqual({
    ok: true,
    onboarding: { countryCode: "DE", sendRequest: ask },
  });
  // Nobody asks on someone else's behalf.
  expect(
    resolveSendRequest({
      previous: { countryCode: "DE" },
      next: { countryCode: "DE", sendRequest: ask },
      enabled: true,
      actor: ADMIN,
    }),
  ).toMatchObject({ ok: false, status: 400, code: "send_request_actor" });
  // Case-insensitive identity.
  expect(
    resolveSendRequest({
      previous: {},
      next: { sendRequest: { ...ask, by: "Editor@Example.com" } },
      enabled: true,
      actor: EDITOR,
    }),
  ).toMatchObject({ ok: true });
  // A client cannot pre-set stale or fake freshness on a new ask: the
  // server owns `stale`.
  expect(
    resolveSendRequest({
      previous: {},
      next: { sendRequest: { ...ask, stale: true } },
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: { sendRequest: ask } });
});

test("a later onboarding save marks the ask stale in the same write, and stale sticks", () => {
  const previous: OnboardingDraft = { countryCode: "DE", sendRequest: ask };
  const edited = resolveSendRequest({
    previous,
    // The editing client echoes the marker back unchanged.
    next: { countryCode: "FR", sendRequest: ask },
    enabled: true,
    actor: EDITOR,
  });
  expect(edited).toEqual({
    ok: true,
    onboarding: { countryCode: "FR", sendRequest: { ...ask, stale: true } },
  });
  // A save that does not know about the marker keeps it (and stales it).
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "AT" },
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({
    ok: true,
    onboarding: { countryCode: "AT", sendRequest: { ...ask, stale: true } },
  });
  // The same holds with the flag off: a marker already stored is never
  // dropped by an ordinary save, and it still tells the truth.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "AT" },
      enabled: false,
      actor: EDITOR,
    }),
  ).toEqual({
    ok: true,
    onboarding: { countryCode: "AT", sendRequest: { ...ask, stale: true } },
  });
  // Echoing the stored marker unchanged with the flag off is not a write.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "DE", sendRequest: ask },
      enabled: false,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: previous });
  // Stale sticks: echoing stale:false for the same ask does not clear it.
  const stalePrev: OnboardingDraft = {
    countryCode: "FR",
    sendRequest: { ...ask, stale: true },
  };
  expect(
    resolveSendRequest({
      previous: stalePrev,
      next: { countryCode: "FR", sendRequest: { ...ask, stale: false } },
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: stalePrev });
  // A save that changes nothing in the draft leaves a fresh ask fresh.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "DE", sendRequest: ask },
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: previous });
  // Asking again (a new revision) is a fresh ask.
  const again = { ...ask, revision: 9, at: "2026-09-25T12:00:00.000Z" };
  expect(
    resolveSendRequest({
      previous: stalePrev,
      next: { countryCode: "FR", sendRequest: again },
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: { countryCode: "FR", sendRequest: again } });
});

test("a withdrawn ask stays withdrawn and is not marked stale", () => {
  const withdrawn = { ...ask, withdrawnAt: "2026-09-25T11:00:00.000Z" };
  // The Super Admin (or the requester) withdraws: same ask, withdrawnAt set.
  expect(
    resolveSendRequest({
      previous: { sendRequest: ask },
      next: { sendRequest: withdrawn },
      enabled: true,
      actor: ADMIN,
    }),
  ).toEqual({ ok: true, onboarding: { sendRequest: withdrawn } });
  // A later save cannot un-withdraw it, and editing does not stale it.
  expect(
    resolveSendRequest({
      previous: { sendRequest: withdrawn },
      next: { countryCode: "DE", sendRequest: ask },
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({
    ok: true,
    onboarding: { countryCode: "DE", sendRequest: withdrawn },
  });
});

test("removing the whole onboarding draft removes its marker", () => {
  expect(
    resolveSendRequest({
      previous: { countryCode: "DE", sendRequest: ask },
      next: undefined,
      enabled: true,
      actor: EDITOR,
    }),
  ).toEqual({ ok: true, onboarding: undefined });
});

test("the marker never travels to FlightDeck: the payload is built without it", () => {
  const payload = buildOnboardingPayload({
    project: {
      ...examples[0],
      onboarding: { countryCode: "DE", sendRequest: ask },
    },
    destinationWorkspaceId: "ws-1",
    idempotencyKey: "0123456789abcdef01234567",
    installationId: "atlas-local",
    requestedBy: "Super Admin",
  });
  const bytes = JSON.stringify(payload);
  expect(bytes).not.toContain("sendRequest");
  expect(bytes).not.toContain(EDITOR);
});
