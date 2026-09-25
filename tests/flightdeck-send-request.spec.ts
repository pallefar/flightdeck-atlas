import { test, expect } from "@playwright/test";
import {
  buildOnboardingPayload,
  onboardingSchema,
  resolveSendRequest,
  requesterRequestsEnabled,
  sendRequestAction,
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

test("with the flag on, a save still cannot write the marker: asking and withdrawing are their own actions", () => {
  // onb-atlas-ask-withdraw: an ask is bound to the revision the asker saw,
  // and only the asker or the Super Admin withdraws. A save could otherwise
  // name any revision or withdraw anyone's ask, so a save that writes a
  // marker (new ask, changed ask, withdrawal) is refused, in anyone's name.
  for (const [previous, next, actor] of [
    [{ countryCode: "DE" }, { countryCode: "DE", sendRequest: ask }, EDITOR],
    [{ countryCode: "DE" }, { countryCode: "DE", sendRequest: ask }, ADMIN],
    [{}, { sendRequest: { ...ask, stale: true } }, EDITOR],
    [
      { sendRequest: ask },
      { sendRequest: { ...ask, revision: 9, at: "2026-09-25T12:00:00.000Z" } },
      EDITOR,
    ],
    [
      { sendRequest: ask },
      { sendRequest: { ...ask, withdrawnAt: "2026-09-25T11:00:00.000Z" } },
      ADMIN,
    ],
    [undefined, { sendRequest: ask }, EDITOR],
  ] as [OnboardingDraft | undefined, OnboardingDraft, string][])
    expect(
      resolveSendRequest({ previous, next, enabled: true, actor }),
      JSON.stringify({ previous, next, actor }),
    ).toMatchObject({ ok: false, status: 400, code: "send_request_action" });
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
  // Asking again goes through the ask action (see below), never a save.
  const again = { ...ask, revision: 9, at: "2026-09-25T12:00:00.000Z" };
  expect(
    resolveSendRequest({
      previous: stalePrev,
      next: { countryCode: "FR", sendRequest: again },
      enabled: true,
      actor: EDITOR,
    }),
  ).toMatchObject({ ok: false, code: "send_request_action" });
});

test("a withdrawn ask stays withdrawn and is not marked stale", () => {
  const withdrawn = { ...ask, withdrawnAt: "2026-09-25T11:00:00.000Z" };
  // Echoing the withdrawn marker is not a write.
  expect(
    resolveSendRequest({
      previous: { sendRequest: withdrawn },
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

test("a whole-project save that changes only the FlightDeck draft label marks the ask stale", () => {
  const previous: OnboardingDraft = { countryCode: "DE", sendRequest: ask };
  const draft = { label: "Acme rollout", workspaceHint: "acme" };
  // The onboarding details are echoed unchanged; only the requested label
  // moves, and buildOnboardingPayload sends that label as target.label.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "DE", sendRequest: ask },
      enabled: true,
      actor: EDITOR,
      flightdeckDraft: {
        before: draft,
        after: { ...draft, label: "Acme rollout 2" },
      },
    }),
  ).toEqual({
    ok: true,
    onboarding: { countryCode: "DE", sendRequest: { ...ask, stale: true } },
  });
  // Clearing the draft (null) is a change too.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "DE", sendRequest: ask },
      enabled: false,
      actor: EDITOR,
      flightdeckDraft: { before: draft, after: null },
    }),
  ).toMatchObject({ ok: true, onboarding: { sendRequest: { stale: true } } });
  // An unchanged draft (key order aside) leaves a fresh ask fresh.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "DE", sendRequest: ask },
      enabled: true,
      actor: EDITOR,
      flightdeckDraft: {
        before: draft,
        after: { workspaceHint: "acme", label: "Acme rollout" },
      },
    }),
  ).toEqual({ ok: true, onboarding: previous });
});

test("a whole-project save that changes a sent profile field marks the ask stale", () => {
  // buildOnboardingPayload sends description, benefit, functionArea and
  // category as profile.summary, successMeasure, functionArea and category,
  // so a change to any of them changes what the Super Admin would send.
  const previous: OnboardingDraft = { countryCode: "DE", sendRequest: ask };
  const profile = {
    description: "Roll out Atlas to the Berlin site.",
    benefit: "Fewer manual handovers.",
    functionArea: "Operations",
    category: "Rollout",
  };
  for (const field of Object.keys(profile) as (keyof typeof profile)[])
    expect(
      resolveSendRequest({
        previous,
        next: { countryCode: "DE", sendRequest: ask },
        enabled: true,
        actor: EDITOR,
        profile: {
          before: profile,
          after: { ...profile, [field]: `${profile[field]} (changed)` },
        },
      }),
      field,
    ).toEqual({
      ok: true,
      onboarding: { countryCode: "DE", sendRequest: { ...ask, stale: true } },
    });
  // Surrounding whitespace is trimmed before sending, so it is no change;
  // neither is key order.
  expect(
    resolveSendRequest({
      previous,
      next: { countryCode: "DE", sendRequest: ask },
      enabled: true,
      actor: EDITOR,
      profile: {
        before: profile,
        after: {
          category: "Rollout ",
          functionArea: " Operations",
          benefit: profile.benefit,
          description: profile.description,
        },
      },
    }),
  ).toEqual({ ok: true, onboarding: previous });
});

// onb-atlas-ask-withdraw: the ask and withdraw actions, decided on the server
// (the onboarding-scoped PUT with `action`). Plan J3: the editor asks the
// Super Admin to send one exact revision; the requester or the Super Admin
// can withdraw it. Only the Super Admin ever sends (D-033 decision 7).
const NOW = "2026-09-25T15:00:00.000Z";
const act = (
  over: Partial<Parameters<typeof sendRequestAction>[0]> = {},
): ReturnType<typeof sendRequestAction> =>
  sendRequestAction({
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
    ...over,
  });

test("ask succeeds only for the revision the asker saw; otherwise 409 with the current revision", () => {
  expect(act()).toEqual({
    ok: true,
    onboarding: {
      countryCode: "DE",
      sendRequest: { revision: 7, by: EDITOR, at: NOW },
    },
  });
  for (const revision of [6, 8])
    expect(act({ revision }), String(revision)).toEqual({
      ok: false,
      status: 409,
      code: "revision_changed",
      revision: 7,
      error: expect.any(String),
    });
  // No onboarding draft yet: the ask still lands on the onboarding JSON.
  expect(act({ onboarding: undefined })).toEqual({
    ok: true,
    onboarding: { sendRequest: { revision: 7, by: EDITOR, at: NOW } },
  });
  // The signed-in asker is stored lower-cased as the session names them.
  expect(act({ actor: "Editor@Example.com" })).toMatchObject({
    ok: true,
    onboarding: { sendRequest: { by: EDITOR } },
  });
});

test("asking again after the ask went stale (or was withdrawn) replaces the marker", () => {
  const stale = { ...ask, revision: 5, stale: true };
  expect(
    act({ onboarding: { countryCode: "DE", sendRequest: stale } }),
  ).toEqual({
    ok: true,
    onboarding: {
      countryCode: "DE",
      sendRequest: { revision: 7, by: EDITOR, at: NOW },
    },
  });
  const withdrawn = { ...ask, revision: 5, withdrawnAt: NOW };
  expect(
    act({ onboarding: { sendRequest: withdrawn }, actor: "other@example.com" }),
  ).toEqual({
    ok: true,
    onboarding: {
      sendRequest: { revision: 7, by: "other@example.com", at: NOW },
    },
  });
});

test("withdraw by the asker or the Super Admin succeeds; another editor gets 403", () => {
  const open: OnboardingDraft = { countryCode: "DE", sendRequest: ask };
  const withdrawn = {
    ok: true,
    onboarding: {
      countryCode: "DE",
      sendRequest: { ...ask, withdrawnAt: NOW },
    },
  };
  // The asker (any case of their sign-in).
  expect(act({ onboarding: open, action: "withdraw", revision: 7 })).toEqual(
    withdrawn,
  );
  expect(
    act({
      onboarding: open,
      action: "withdraw",
      revision: 7,
      actor: "EDITOR@example.com",
    }),
  ).toEqual(withdrawn);
  // The Super Admin, whatever the project-level rights say.
  expect(
    act({
      onboarding: open,
      action: "withdraw",
      revision: 7,
      actor: ADMIN,
      superAdmin: true,
      canEdit: false,
    }),
  ).toEqual(withdrawn);
  // Another editor of the same project.
  expect(
    act({
      onboarding: open,
      action: "withdraw",
      revision: 7,
      actor: "other@example.com",
    }),
  ).toMatchObject({ ok: false, status: 403, code: "send_request_not_yours" });
  // The asker who lost edit rights on the project.
  expect(
    act({ onboarding: open, action: "withdraw", revision: 7, canEdit: false }),
  ).toMatchObject({ ok: false, status: 403 });
  // A stale ask is still withdrawable (and stays stale).
  expect(
    act({
      onboarding: { sendRequest: { ...ask, stale: true } },
      action: "withdraw",
      revision: 7,
    }),
  ).toEqual({
    ok: true,
    onboarding: { sendRequest: { ...ask, stale: true, withdrawnAt: NOW } },
  });
});

test("withdraw names the ask it withdraws; nothing open to withdraw is 409", () => {
  const open: OnboardingDraft = { sendRequest: ask };
  // A newer ask replaced the one this client saw.
  expect(
    act({ onboarding: open, action: "withdraw", revision: 6 }),
  ).toMatchObject({
    ok: false,
    status: 409,
    code: "revision_changed",
    revision: 7,
  });
  for (const onboarding of [
    undefined,
    {},
    { sendRequest: { ...ask, withdrawnAt: NOW } },
  ])
    expect(
      act({ onboarding, action: "withdraw", revision: 7 }),
      JSON.stringify(onboarding),
    ).toMatchObject({ ok: false, status: 409, code: "send_request_none" });
});

test("asking or withdrawing a locked (sent) draft is 409; the flag off is 400; a viewer cannot ask", () => {
  expect(act({ held: true })).toMatchObject({
    ok: false,
    status: 409,
    code: "draft_locked",
  });
  expect(
    act({
      onboarding: { sendRequest: ask },
      action: "withdraw",
      revision: 7,
      held: true,
    }),
  ).toMatchObject({ ok: false, status: 409, code: "draft_locked" });
  expect(act({ enabled: false })).toMatchObject({
    ok: false,
    status: 400,
    code: "requester_requests_off",
  });
  expect(
    act({
      onboarding: { sendRequest: ask },
      action: "withdraw",
      revision: 7,
      enabled: false,
    }),
  ).toMatchObject({ ok: false, status: 400, code: "requester_requests_off" });
  expect(act({ canEdit: false })).toMatchObject({ ok: false, status: 403 });
});
