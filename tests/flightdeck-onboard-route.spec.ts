import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Project } from "../lib/projects";
import { onboardingStatusSchema } from "../lib/flightdeck/onboarding";
import {
  createOnboardRoute,
  projectStatus,
  type OnboardDb,
  type OnboardLinkRow,
  type OnboardSendRow,
} from "../lib/flightdeck/onboard-route";

// The approved status projection per viewer (plan 2026-09-25 J4,
// onb-requester-status-projection): the Atlas Super Admin keeps today's
// status body byte for byte; an editor with view rights gets an allowlisted
// projection with no destination, no workspace, no link and no credential
// detail; a viewer without view rights gets 404; and no non-Super Admin read
// ever reaches FlightDeck OS. Nothing here contacts FlightDeck OS.
const ATLAS_ID = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const ORIGIN = "http://localhost:5173";
const AT = "2026-09-22T09:00:00.000Z";
const CHECKED = "2026-09-22T08:00:00.000Z";

function store() {
  const dir = new URL("../drizzle/", import.meta.url);
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
      sqlite.exec(statement);
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
  return { db, sqlite };
}

type Send = {
  state: string;
  reason?: string | null;
  setup?: string | null;
  adopted?: 0 | 1;
  checkedAt?: string | null;
  link?: boolean;
};
function harness(send: Send | null, viewer: "admin" | "editor" | "none") {
  const s = store();
  s.sqlite
    .prepare(
      "INSERT INTO atlas_projects (id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?)",
    )
    .run(ATLAS_ID, "user-1", "{}", "atlas", AT, 7);
  if (send) {
    s.sqlite
      .prepare(
        "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,proposed_project_id,state,submission_id,received_at,payload_sha256,reason_code,setup_state,created_by,updated_at,checked_at,request_body,adopted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "op-1",
        ATLAS_ID,
        7,
        "0b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d",
        "hr-de",
        "Payroll rollout",
        "payroll-rollout",
        send.state,
        send.state === "reserved" ? null : "sub-123",
        send.state === "reserved" ? null : AT,
        send.state === "reserved" ? null : "a".repeat(64),
        send.reason ?? null,
        send.setup ?? null,
        "user-0",
        AT,
        send.checkedAt === undefined ? CHECKED : send.checkedAt,
        null,
        send.adopted ?? 0,
      );
    if (send.link)
      s.sqlite
        .prepare(
          "INSERT INTO atlas_project_links (installation_id,os_instance_id,workspace_id,os_project_id,atlas_project_id,submission_id,linked_at,linked_by,source_revision,last_checked_at,access_state) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "atlas-test",
          "os-inst-1",
          "hr-de",
          "payroll-rollout",
          ATLAS_ID,
          "sub-123",
          AT,
          "user-0",
          7,
          AT,
          "active",
        );
  }
  const outbound: string[] = [];
  const route = createOnboardRoute({
    async authorize() {
      return {
        access: { userId: "user-2", superAdmin: viewer === "admin" },
      };
    },
    async loadProject(_access, id) {
      return viewer !== "none" && id === ATLAS_ID
        ? { project: { id } as Project, canEdit: viewer === "admin" }
        : null;
    },
    async visibleProjectIds() {
      return viewer === "none" ? [] : [ATLAS_ID];
    },
    reader() {
      outbound.push("reader");
      throw new Error("an OS reader was requested");
    },
    submissions() {
      outbound.push("submissions");
      throw new Error("an OS submission client was requested");
    },
    db: () => s.db,
    installationId: () => "atlas-test",
    now: () => new Date(AT),
  });
  const get = (refresh: boolean) =>
    route.GET(
      new Request(
        `${ORIGIN}/api/flightdeck/onboard/${ATLAS_ID}${refresh ? "?refresh=1" : ""}`,
        { headers: { "Sec-Fetch-Site": "same-origin" } },
      ),
      ATLAS_ID,
    );
  const rows = () => ({
    operation: s.sqlite
      .prepare("SELECT * FROM atlas_flightdeck_operations")
      .get() as OnboardSendRow | undefined,
    link: s.sqlite.prepare("SELECT * FROM atlas_project_links").get() as
      OnboardLinkRow | undefined,
  });
  return { route, get, outbound, rows };
}

/** Every key path of a JSON value, arrays collapsed. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [
    `${prefix}${k}`,
    ...keyPaths(v, `${prefix}${k}.`),
  ]);
}
const EDITOR_KEYS = [
  "operation",
  "operation.state",
  "operation.stage",
  "operation.destinationWorkspaceId",
  "operation.submittedAt",
  "operation.reasonCode",
  "operation.setupState",
  "operation.atlasRevision",
  "operation.adopted",
  "operation.updatedAt",
  "operation.checkedAt",
  "link",
  "pendingPayload",
  "canSend",
  "canClose",
  "retryPending",
  "pollable",
  "notice",
  "retryAfter",
];

test.describe("onboarding status projection per viewer", () => {
  test("the Super Admin's status body is byte-identical to today's", async () => {
    const linked = harness(
      { state: "linked", setup: "awaiting-cowork", link: true },
      "admin",
    );
    const response = await linked.get(false);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      JSON.stringify({
        operation: {
          state: "linked",
          stage: "setup-in-progress",
          destinationWorkspaceId: "hr-de",
          submittedAt: AT,
          reasonCode: null,
          setupState: "awaiting-cowork",
          atlasRevision: 7,
          adopted: false,
          updatedAt: AT,
          checkedAt: CHECKED,
        },
        link: {
          workspaceId: "hr-de",
          osProjectId: "payroll-rollout",
          linkedAt: AT,
          accessState: "active",
        },
        pendingPayload: null,
        canSend: false,
        canClose: false,
        retryPending: false,
        pollable: true,
        notice: null,
        retryAfter: null,
      }),
    );
    // A filed send the Super Admin sees with its credential detail as today.
    const filed = harness(
      { state: "filed", reason: "credential_scope" },
      "admin",
    );
    const body = onboardingStatusSchema.parse(
      await (await filed.get(false)).json(),
    );
    expect(body.operation).toMatchObject({
      stage: "submitted",
      reasonCode: "credential_scope",
      destinationWorkspaceId: "hr-de",
    });
  });

  test("an editor gets only the allowlisted projection: no destination, workspace, link or credential detail", async () => {
    for (const send of [
      { state: "linked", setup: "result-landed", link: true },
      { state: "filed", reason: "credential_scope" },
      { state: "promoted", reason: "destination_not_shared" },
      { state: "reserved", reason: "unauthorized" },
      { state: "refused", reason: "refused" },
      { state: "linked", reason: "instance_unknown", link: true },
    ] satisfies Send[]) {
      const h = harness(send, "editor");
      const response = await h.get(false);
      expect(response.status).toBe(200);
      const text = await response.text();
      const body = onboardingStatusSchema.parse(JSON.parse(text));
      expect(keyPaths(body).sort()).toEqual([...EDITOR_KEYS].sort());
      expect(body.operation!.destinationWorkspaceId).toBeNull();
      expect(body.link).toBeNull();
      expect(body.pendingPayload).toBeNull();
      expect(body.canClose).toBe(false);
      expect(body.notice).toBeNull();
      expect(body.retryAfter).toBeNull();
      // Neither the destination workspace, the OS project, the submission
      // nor anything about Atlas's credential is in the bytes.
      for (const secret of [
        "hr-de",
        "payroll-rollout",
        "sub-123",
        "os-inst-1",
        "credential",
      ])
        expect(text, `${send.state}: ${secret}`).not.toContain(secret);
      // The Super Admin's reason codes (credential, workspace sharing,
      // operator faults) are projected as no reason at all.
      expect([
        "unauthorized",
        "refused",
        "destination_not_shared",
        "instance_unknown",
      ]).not.toContain(body.operation!.reasonCode);
      // Revision and stage stay: the requester's own facts.
      expect(body.operation!.atlasRevision).toBe(7);
    }
  });

  test("an editor keeps the decision reasons FlightDeck gives the requester", async () => {
    const declined = harness(
      { state: "rejected", reason: "duplicate" },
      "editor",
    );
    const body = onboardingStatusSchema.parse(
      await (await declined.get(false)).json(),
    );
    expect(body.operation).toMatchObject({
      stage: "rejected",
      reasonCode: "duplicate",
    });
    const more = harness(
      { state: "rejected", reason: "needs-more-info" },
      "editor",
    );
    expect(
      onboardingStatusSchema.parse(await (await more.get(false)).json())
        .operation,
    ).toMatchObject({
      stage: "needs-more-info",
      reasonCode: "needs-more-info",
    });
  });

  test("a send not yet linked shows the editor 'submitted', waiting to be filed", async () => {
    for (const state of ["filed", "promoted"]) {
      const h = harness({ state, reason: null }, "editor");
      const body = onboardingStatusSchema.parse(
        await (await h.get(false)).json(),
      );
      expect(body.operation).toMatchObject({
        stage: "submitted",
        reasonCode: "waiting_to_be_filed",
      });
    }
  });

  test("a viewer without view rights gets 404, and projectStatus projects nothing for them", async () => {
    const h = harness({ state: "linked", link: true }, "none");
    const response = await h.get(false);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain("hr-de");
    const { operation, link } = h.rows();
    expect(projectStatus(null, { operation, link })).toBeNull();
  });

  test("projectStatus: the Super Admin sees the link and destination, an editor never does", async () => {
    const h = harness({ state: "linked", link: true }, "admin");
    const send = h.rows();
    const admin = projectStatus({ superAdmin: true }, send)!;
    expect(admin.link).toMatchObject({ workspaceId: "hr-de" });
    expect(admin.operation!.destinationWorkspaceId).toBe("hr-de");
    const editor = projectStatus(
      { superAdmin: false },
      send,
      "FlightDeck refused Atlas's credential.",
      30,
    )!;
    expect(editor.link).toBeNull();
    expect(editor.operation!.destinationWorkspaceId).toBeNull();
    expect(editor.notice).toBeNull();
    expect(editor.retryAfter).toBeNull();
  });

  test("no non-Super Admin read contacts FlightDeck, even a due refresh", async () => {
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      throw new Error("outbound fetch");
    }) as typeof fetch;
    try {
      for (const viewer of ["editor", "none"] as const) {
        // Never checked: a Super Admin refresh would read it back now.
        const h = harness({ state: "filed", checkedAt: null }, viewer);
        await h.get(true);
        await h.get(false);
        await h.route.LIST(
          new Request(`${ORIGIN}/api/flightdeck/onboard?refresh=1`, {
            headers: { "Sec-Fetch-Site": "same-origin" },
          }),
        );
        expect(h.outbound).toEqual([]);
      }
      expect(fetched).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// Review round 3 (onb-atlas-decision-note; D-037 item 5): the earlier send's
// reviewer note is kept only until the corrected send. A fresh send clears it
// right after it reserves the new key; if that cleanup failed (503), the
// retry takes the reserved row as is, so it must finish the cleanup before it
// sends, or the corrected request completes with the old note still stored.
test("a retry of a reserved corrected send clears the earlier send's reviewer note before it sends", async () => {
  const { buildOnboardingPayload, onboardingEnvelope } =
    await import("../lib/flightdeck/onboarding");
  const { examples } = await import("../lib/projects");
  const s = store();
  s.sqlite
    .prepare(
      "INSERT INTO atlas_projects (id,owner_id,data,source,updated_at,revision) VALUES (?,?,?,?,?,?)",
    )
    .run(ATLAS_ID, "user-1", "{}", "atlas", AT, 8);
  const insertOp = s.sqlite.prepare(
    "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,proposed_project_id,state,submission_id,received_at,payload_sha256,reason_code,setup_state,created_by,updated_at,checked_at,request_body,adopted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  // The earlier send, answered needs-more-info with a note.
  insertOp.run(
    "op-old",
    ATLAS_ID,
    7,
    "0b5c6d7e-8f90-4a1b-9c2d-3e4f5a6b7c8d",
    "hr-de",
    "Payroll rollout",
    "payroll-rollout",
    "rejected",
    "sub-old",
    AT,
    "a".repeat(64),
    "needs-more-info",
    null,
    "user-0",
    AT,
    CHECKED,
    null,
    0,
  );
  s.sqlite
    .prepare(
      "INSERT INTO atlas_flightdeck_transitions (send_id,seq,stage,observed_at,source,note,fields) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      "op-old",
      1,
      "needs-more-info",
      AT,
      "poll",
      "Please name the site.",
      '["site"]',
    );
  // The corrected send, reserved, whose note cleanup failed (the POST said
  // 503 and left the reservation in place).
  const project = {
    ...examples[0],
    id: ATLAS_ID,
    source: "atlas",
    revision: 8,
  } as Project;
  const key = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const envelope = onboardingEnvelope(
    buildOnboardingPayload({
      project,
      destinationWorkspaceId: "hr-de",
      idempotencyKey: key,
      installationId: "atlas-test",
      requestedBy: "b".repeat(64),
    }),
  );
  // The stored bytes of a send that passed readiness when it was reserved.
  envelope.payload.target.label = "Payroll rollout";
  envelope.payload.profile.functionArea = "HR";
  envelope.payload.facts.countryCode = "DE";
  envelope.payload.facts.worksCouncilRelevant = "unknown";
  insertOp.run(
    "op-new",
    ATLAS_ID,
    8,
    key,
    "hr-de",
    envelope.payload.target.label,
    envelope.payload.target.projectId ?? null,
    "reserved",
    null,
    null,
    null,
    null,
    null,
    "user-2",
    AT,
    null,
    JSON.stringify(envelope),
    0,
  );
  let notesAtSubmit: unknown[] = [];
  const route = createOnboardRoute({
    async authorize() {
      return { access: { userId: "user-2", superAdmin: true } };
    },
    async loadProject() {
      return { project, canEdit: true };
    },
    async visibleProjectIds() {
      return [ATLAS_ID];
    },
    reader() {
      return {} as never;
    },
    submissions() {
      return {
        async submit(sent) {
          expect(sent.payload.idempotencyKey).toBe(key);
          notesAtSubmit = s.sqlite
            .prepare(
              "SELECT note FROM atlas_flightdeck_transitions WHERE note IS NOT NULL OR fields IS NOT NULL",
            )
            .all();
          return {
            state: "ok",
            data: {
              submissionId: "sub-new",
              receivedAt: AT,
              payloadSha256: "c".repeat(64),
            },
          } as never;
        },
        async readSubmission() {
          throw new Error("not expected");
        },
      };
    },
    db: () => s.db,
    installationId: () => "atlas-test",
    now: () => new Date(AT),
  });
  const response = await route.POST(
    new Request(`${ORIGIN}/api/flightdeck/onboard/${ATLAS_ID}`, {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ destinationWorkspaceId: "hr-de", revision: 8 }),
    }),
    ATLAS_ID,
  );
  expect(`${response.status} ${await response.clone().text()}`).toMatch(
    /^202 /,
  );
  // Cleared before the corrected request left Atlas, and still cleared.
  expect(notesAtSubmit).toEqual([]);
  expect(
    s.sqlite
      .prepare(
        "SELECT note,fields FROM atlas_flightdeck_transitions WHERE send_id='op-old'",
      )
      .all()
      .map((r) => ({ ...r })),
  ).toEqual([{ note: null, fields: null }]);
});
