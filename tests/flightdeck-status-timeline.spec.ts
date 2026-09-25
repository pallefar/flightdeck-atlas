// The waiting view (plan 2026-09-25 J4, onb-atlas-status-timeline): the
// timeline shows what Atlas SAW and when (backfilled sends read "before
// tracking"), earlier sends of the project are a linked correction history,
// three failed checks in a row read "Could not reach FlightDeck since <t>"
// without moving the stage, every stage says what happens next, no ETA
// appears unless the owner set ONB_RESPONSE_POLICY_DAYS, and an editor sees
// "Last update seen <t>" (their view never checks FlightDeck).
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Project } from "../lib/projects";
import {
  onboardingStages,
  onboardingStatusSchema,
  type OnboardingStatus,
} from "../lib/flightdeck/onboarding";
import {
  createOnboardRoute,
  type OnboardDb,
} from "../lib/flightdeck/onboard-route";
import type {
  ContextReader,
  SubmissionClient,
} from "../lib/flightdeck/context-client";
import * as waiting from "../lib/flightdeck/waiting";
import { en } from "../lib/i18n/en";
import { de } from "../lib/i18n/de";

const ATLAS_ID = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const ORIGIN = "http://localhost:5173";
const T0 = "2026-09-22T09:00:00.000Z";

const api = waiting as unknown as {
  responsePolicyDaysFrom?: (value: string | undefined) => number | null;
  waitingView?: (
    status: OnboardingStatus,
    options: {
      superAdmin: boolean;
      locale: "en" | "de";
      when: (iso: string) => string;
    },
  ) => {
    rows: { stage: string; text: string }[];
    history: string[];
    outage: string | null;
    next: string | null;
    eta: string | null;
    freshness: string | null;
  };
};

function store() {
  const dir = new URL("../drizzle/", import.meta.url);
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (statement.trim()) sqlite.exec(statement);
  const db: OnboardDb = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);
          const args = values as SQLInputValue[];
          return {
            async first<T>() {
              return (statement.get(...args) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: statement.all(...args) as T[] };
            },
            async run() {
              return {
                meta: { changes: Number(statement.run(...args).changes) },
              };
            },
          };
        },
      };
    },
  };
  sqlite
    .prepare(
      "INSERT INTO atlas_projects (id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?)",
    )
    .run(ATLAS_ID, "user-1", "{}", "atlas", T0, 7);
  return { db, sqlite };
}

function addSend(
  sqlite: DatabaseSync,
  id: string,
  v: {
    state: string;
    reason?: string | null;
    revision: number;
    updatedAt: string;
    checkedAt?: string | null;
  },
) {
  sqlite
    .prepare(
      "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,proposed_project_id,state,submission_id,received_at,payload_sha256,reason_code,setup_state,created_by,updated_at,checked_at,request_body,adopted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      ATLAS_ID,
      v.revision,
      crypto.randomUUID(),
      "hr-de",
      "Payroll rollout",
      "payroll-rollout",
      v.state,
      `sub-${id}`,
      v.updatedAt,
      "a".repeat(64),
      v.reason ?? null,
      null,
      "user-0",
      v.updatedAt,
      v.checkedAt ?? null,
      null,
      0,
    );
}
function addTransition(
  sqlite: DatabaseSync,
  sendId: string,
  seq: number,
  stage: string,
  observedAt: string | null,
  source: string,
) {
  sqlite
    .prepare(
      "INSERT INTO atlas_flightdeck_transitions (send_id,seq,stage,observed_at,source) VALUES (?,?,?,?,?)",
    )
    .run(sendId, seq, stage, observedAt, source);
}

function route(
  s: ReturnType<typeof store>,
  viewer: "admin" | "editor",
  opts: {
    clock?: { now: Date };
    read?: SubmissionClient["readSubmission"];
    policyDays?: number | null;
  } = {},
) {
  const clock = opts.clock ?? { now: new Date(T0) };
  const r = createOnboardRoute({
    async authorize() {
      return { access: { userId: "user-2", superAdmin: viewer === "admin" } };
    },
    async loadProject(_access, id) {
      return id === ATLAS_ID
        ? { project: { id } as Project, canEdit: true }
        : null;
    },
    async visibleProjectIds() {
      return [ATLAS_ID];
    },
    reader: () => ({}) as ContextReader,
    submissions: () =>
      ({
        submit: async () => {
          throw new Error("no submit here");
        },
        readSubmission:
          opts.read ??
          (async () => {
            throw new Error("no read here");
          }),
      }) as SubmissionClient,
    db: () => s.db,
    installationId: () => "atlas-test",
    now: () => clock.now,
    responsePolicyDays: () => opts.policyDays ?? null,
  } as Parameters<typeof createOnboardRoute>[0]);
  return async (refresh = false) =>
    onboardingStatusSchema.parse(
      await (
        await r.GET(
          new Request(
            `${ORIGIN}/api/flightdeck/onboard/${ATLAS_ID}${refresh ? "?refresh=1" : ""}`,
            { headers: { "Sec-Fetch-Site": "same-origin" } },
          ),
          ATLAS_ID,
        )
      ).json(),
    ) as OnboardingStatus & Record<string, unknown>;
}

test.describe("waiting view: what the status carries", () => {
  test("the current send's observed transitions, oldest first; a backfilled row has no time", async () => {
    const s = store();
    addSend(s.sqlite, "op-1", {
      state: "promoted",
      revision: 7,
      updatedAt: T0,
      checkedAt: T0,
    });
    addTransition(s.sqlite, "op-1", 1, "submitted", null, "backfill");
    addTransition(s.sqlite, "op-1", 2, "linked", "2026-09-22T10:00:00.000Z", "poll");
    for (const viewer of ["admin", "editor"] as const) {
      const body = await route(s, viewer)();
      expect(body.transitions, viewer).toEqual([
        { stage: "submitted", observedAt: null },
        { stage: "linked", observedAt: "2026-09-22T10:00:00.000Z" },
      ]);
    }
  });

  test("an earlier send of the project is the correction history, linked to the send that followed it", async () => {
    const s = store();
    addSend(s.sqlite, "op-old", {
      state: "rejected",
      reason: "needs-more-info",
      revision: 5,
      updatedAt: "2026-09-20T09:00:00.000Z",
    });
    addTransition(s.sqlite, "op-old", 1, "submitted", "2026-09-19T09:00:00.000Z", "atlas");
    addTransition(s.sqlite, "op-old", 2, "needs-more-info", "2026-09-20T09:00:00.000Z", "poll");
    addSend(s.sqlite, "op-new", {
      state: "filed",
      revision: 7,
      updatedAt: T0,
      checkedAt: T0,
    });
    addTransition(s.sqlite, "op-new", 1, "submitted", T0, "atlas");
    for (const viewer of ["admin", "editor"] as const) {
      const body = await route(s, viewer)();
      expect(body.history, viewer).toEqual([
        {
          revision: 5,
          stage: "needs-more-info",
          transitions: [
            { stage: "submitted", observedAt: "2026-09-19T09:00:00.000Z" },
            { stage: "needs-more-info", observedAt: "2026-09-20T09:00:00.000Z" },
          ],
        },
      ]);
      // No destination, submission or send id in the history.
      const text = JSON.stringify(body.history);
      for (const secret of ["hr-de", "sub-", "op-old"])
        expect(text, `${viewer}: ${secret}`).not.toContain(secret);
    }
  });

  test("three failed checks in a row set unreachableSince to the first failure; the stage is unchanged; an answer clears it", async () => {
    const s = store();
    addSend(s.sqlite, "op-1", {
      state: "filed",
      revision: 7,
      updatedAt: T0,
      checkedAt: null,
    });
    const clock = { now: new Date(T0) };
    let reachable = false;
    const get = route(s, "admin", {
      clock,
      read: async (id) =>
        reachable
          ? {
              state: "ok",
              data: {
                submissionId: id,
                kind: "project-onboarding",
                subject: `atlas-${ATLAS_ID}`,
                receivedAt: T0,
                payloadSha256: "a".repeat(64),
                state: "filed",
                promoted: null,
                reasonCode: null,
                outcomeWithheld: null,
              },
            }
          : { state: "os_unreachable" },
    });
    const minute = () =>
      (clock.now = new Date(clock.now.getTime() + 61_000));
    const first = await get(true);
    expect(first.unreachableSince).toBeNull();
    expect(first.operation!.stage).toBe("submitted");
    minute();
    expect((await get(true)).unreachableSince).toBeNull();
    minute();
    const third = await get(true);
    expect(third.unreachableSince).toBe(T0);
    expect(third.operation!.stage).toBe("submitted");
    // The editor sees the same outage (a read of the stored status).
    expect((await route(s, "editor")()).unreachableSince).toBe(T0);
    reachable = true;
    minute();
    const back = await get(true);
    expect(back.unreachableSince).toBeNull();
    expect(back.operation!.stage).toBe("submitted");
  });

  test("the response policy is null unless configured, then its number of working days", async () => {
    const s = store();
    addSend(s.sqlite, "op-1", { state: "filed", revision: 7, updatedAt: T0 });
    expect((await route(s, "editor")()).responsePolicyDays).toBeNull();
    expect(
      (await route(s, "editor", { policyDays: 5 })()).responsePolicyDays,
    ).toBe(5);
  });

  test("ONB_RESPONSE_POLICY_DAYS: only a whole number of days from 1 to 60 counts; anything else is unset", () => {
    const from = api.responsePolicyDaysFrom!;
    expect(from(undefined)).toBeNull();
    for (const bad of ["", " ", "0", "-3", "5.5", "abc", "61", "5 days", "1e1"])
      expect(from(bad), bad).toBeNull();
    expect(from("5")).toBe(5);
    expect(from(" 10 ")).toBe(10);
    expect(from("60")).toBe(60);
  });
});

const when = (iso: string) => `@${iso.slice(11, 16)}`;
function status(
  over: Partial<OnboardingStatus> & Record<string, unknown>,
  stage: OnboardingStatus["operation"] extends infer O
    ? O extends { stage: infer S }
      ? S
      : never
    : never = "submitted",
): OnboardingStatus {
  return {
    operation: {
      state: "filed",
      stage,
      destinationWorkspaceId: null,
      submittedAt: T0,
      reasonCode: null,
      setupState: null,
      atlasRevision: 7,
      adopted: false,
      updatedAt: T0,
      checkedAt: "2026-09-22T12:04:00.000Z",
    },
    link: null,
    pendingPayload: null,
    canSend: false,
    canClose: false,
    retryPending: false,
    pollable: true,
    notice: null,
    retryAfter: null,
    transitions: [],
    history: [],
    unreachableSince: null,
    responsePolicyDays: null,
    ...over,
  } as OnboardingStatus;
}

test.describe("waiting view: what it says", () => {
  test("transition rows read 'seen <t>'; a backfilled row reads 'before tracking'", () => {
    const view = api.waitingView!(
      status({
        transitions: [
          { stage: "submitted", observedAt: null },
          { stage: "linked", observedAt: "2026-09-22T10:30:00.000Z" },
        ],
      }),
      { superAdmin: false, locale: "en", when },
    );
    expect(view.rows).toEqual([
      { stage: "submitted", text: "Submitted: before tracking" },
      { stage: "linked", text: "Linked: seen @10:30" },
    ]);
  });

  test("resubmitted sends show as a linked history", () => {
    const view = api.waitingView!(
      status({
        history: [
          {
            revision: 5,
            stage: "needs-more-info",
            transitions: [
              { stage: "needs-more-info", observedAt: "2026-09-20T09:00:00.000Z" },
            ],
          },
          { revision: 3, stage: "rejected", transitions: [] },
        ],
      }),
      { superAdmin: false, locale: "en", when },
    );
    expect(view.history).toEqual([
      "Revision 5: Needs more info (seen @09:00). Sent again as revision 7.",
      "Revision 3: Declined (before tracking). Sent again as revision 5.",
    ]);
  });

  test("an outage reads 'Could not reach FlightDeck since <t>', and the stage line stays", () => {
    const view = api.waitingView!(
      status({ unreachableSince: "2026-09-22T11:00:00.000Z" }),
      { superAdmin: false, locale: "en", when },
    );
    expect(view.outage).toBe("Could not reach FlightDeck since @11:00.");
    expect(view.next).toBe(en["onb.next.submitted"]);
    expect(
      api.waitingView!(status({}), { superAdmin: true, locale: "en", when })
        .outage,
    ).toBeNull();
  });

  test("every stage has its own 'Next: …' line, in English and German", () => {
    for (const stage of onboardingStages) {
      const key = `onb.next.${stage}` as keyof typeof en;
      expect(en[key], stage).toMatch(/^Next: /);
      expect(de[key], stage).toMatch(/^Als Nächstes: /);
      const view = api.waitingView!(status({}, stage), {
        superAdmin: false,
        locale: "en",
        when,
      });
      expect(view.next, stage).toBe(en[key]);
    }
  });

  test("no ETA without the owner's response policy; with it, only while FlightDeck reviews", () => {
    const opts = { superAdmin: false, locale: "en" as const, when };
    const none = api.waitingView!(status({}), opts);
    expect(none.eta).toBeNull();
    expect(JSON.stringify(Object.values(none))).not.toMatch(
      /usually|within|working day/i,
    );
    expect(
      api.waitingView!(status({ responsePolicyDays: 5 }), opts).eta,
    ).toBe("Usually answered within 5 working days.");
    expect(
      api.waitingView!(status({ responsePolicyDays: 1 }), opts).eta,
    ).toBe("Usually answered within 1 working day.");
    expect(
      api.waitingView!(status({ responsePolicyDays: 5 }, "linked"), opts).eta,
    ).toBeNull();
  });

  test("an editor sees 'Last update seen <t>'; the Super Admin keeps 'Last checked'", () => {
    const editor = api.waitingView!(status({}), {
      superAdmin: false,
      locale: "en",
      when,
    });
    expect(editor.freshness).toBe("Last update seen @12:04");
    const none = api.waitingView!(
      status({
        operation: { ...status({}).operation!, checkedAt: null },
      }),
      { superAdmin: false, locale: "en", when },
    );
    expect(none.freshness).toBe("No update seen yet");
    const admin = api.waitingView!(status({}), {
      superAdmin: true,
      locale: "en",
      when,
    });
    expect(admin.freshness).toBe("Last checked with FlightDeck: @12:04");
    // A status FlightDeck can no longer move has no freshness line.
    expect(
      api.waitingView!(status({ pollable: false }, "rejected"), {
        superAdmin: false,
        locale: "en",
        when,
      }).freshness,
    ).toBeNull();
  });
});
