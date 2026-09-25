// Durable Atlas notices per recorded FlightDeck transition (plan 2026-09-25
// J5, onb-atlas-notifications): one notice per transition for the asker and
// the Super Admins, written in the same D1 batch as the transition, deduped
// by (send, seq, recipient), unread until read, access re-checked at read
// time, and never holding the reviewer's note. Built over node:sqlite from
// the real drizzle migrations.
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { OnboardingStage } from "../lib/flightdeck/onboarding";
import type { OnboardDb } from "../lib/flightdeck/onboard-route";
import { applyObservedStage } from "../lib/flightdeck/transitions";
import {
  NEEDS_CHANGES_TEXT,
  markNoticeRead,
  noticeText,
  noticesFor,
} from "../lib/flightdeck/notices";

const dir = new URL("../drizzle/", import.meta.url);
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (statement.trim()) sqlite.exec(statement);
  return sqlite;
}
type Bound = ReturnType<ReturnType<OnboardDb["prepare"]>["bind"]> & {
  runSync(): { meta: { changes: number } };
};
/** A D1 stand-in whose batch is one transaction, as D1's is. */
function d1(sqlite: DatabaseSync, log?: string[][]): OnboardDb {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const args = values as SQLInputValue[];
          const runSync = () => ({
            meta: {
              changes: Number(sqlite.prepare(sql).run(...args).changes),
            },
          });
          const bound: Bound & { sql: string } = {
            sql,
            async first<T>() {
              return (
                (sqlite.prepare(sql).get(...args) as T | undefined) ?? null
              );
            },
            async all<T>() {
              return { results: sqlite.prepare(sql).all(...args) as T[] };
            },
            async run() {
              return runSync();
            },
            runSync,
          };
          return bound;
        },
      };
    },
    async batch(statements) {
      log?.push(statements.map((s) => (s as unknown as { sql: string }).sql));
      sqlite.exec("BEGIN");
      try {
        const out = statements.map((s) => (s as Bound).runSync());
        sqlite.exec("COMMIT");
        return out;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
let n = 0;
function addProject(sqlite: DatabaseSync, ask?: Record<string, unknown>) {
  const id = `project-${++n}`;
  sqlite
    .prepare(
      "INSERT INTO atlas_projects (id,owner_id,data,updated_at) VALUES (?,?,?,?)",
    )
    .run(
      id,
      "user-1",
      JSON.stringify({
        name: "Payroll",
        onboarding: ask ? { sendRequest: ask } : {},
        // A reviewer's note as it could come back from FlightDeck.
        flightdeckReview: { note: "SECRET-REVIEWER-NOTE salary band wrong" },
      }),
      "2026-09-20T09:00:00.000Z",
    );
  return id;
}
function addSend(sqlite: DatabaseSync, projectId: string) {
  const id = `op-${++n}`;
  sqlite
    .prepare(
      "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,state,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      projectId,
      1,
      `key-${n}`,
      "hr-de",
      "Payroll",
      "filed",
      "user-1",
      "2026-09-20T09:00:00.000Z",
    );
  return id;
}
function addMember(
  sqlite: DatabaseSync,
  email: string,
  roleId: string,
  disabled = 0,
) {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO atlas_roles (id,name,permissions) VALUES (?,?,?)",
    )
    .run(roleId, roleId, "[]");
  sqlite
    .prepare(
      "INSERT INTO atlas_members (email,user_id,role_id,disabled,created_at) VALUES (?,?,?,?,?)",
    )
    .run(email, null, roleId, disabled, "2026-09-20T09:00:00.000Z");
}
const notices = (sqlite: DatabaseSync, sendId?: string) =>
  sqlite
    .prepare(
      `SELECT recipient,project_id,text,created_at,read,send_id,seq FROM atlas_notifications${sendId ? " WHERE send_id=?" : ""} ORDER BY seq,recipient`,
    )
    .all(...(sendId ? [sendId] : [])) as Record<string, unknown>[];
const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 25, 9, minute)).toISOString();
const ASK = {
  revision: 1,
  by: "Asker@Example.com",
  at: "2026-09-24T09:00:00.000Z",
};
const NOTIFY = { superAdmins: ["root@example.com"] };

test("(a) the notice table carries (send_id, seq) and one notice per (send, seq, recipient)", () => {
  const sqlite = database();
  const columns = (
    sqlite.prepare("PRAGMA table_info(atlas_notifications)").all() as {
      name: string;
    }[]
  ).map((c) => c.name);
  expect(columns).toEqual(expect.arrayContaining(["send_id", "seq", "read"]));
  const project = addProject(sqlite);
  const insert = sqlite.prepare(
    "INSERT INTO atlas_notifications (id,recipient,project_id,text,created_at,read,send_id,seq) VALUES (?,?,?,?,?,0,?,?)",
  );
  insert.run("n1", "a@example.com", project, "t", at(0), "op-x", 1);
  expect(() =>
    insert.run("n2", "a@example.com", project, "t", at(0), "op-x", 1),
  ).toThrow(/UNIQUE/);
  // Other notices (no send) are unaffected by the key.
  const plain = sqlite.prepare(
    "INSERT INTO atlas_notifications (id,recipient,project_id,text,created_at,read) VALUES (?,?,?,?,?,0)",
  );
  plain.run("p1", "a@example.com", project, "t", at(0));
  plain.run("p2", "a@example.com", project, "t", at(0));
});

test("(b) a recorded transition notifies the asker and every Super Admin, in the same batch", async () => {
  const sqlite = database();
  addMember(sqlite, "Boss@Example.com", "superadmin");
  addMember(sqlite, "gone@example.com", "superadmin", 1);
  addMember(sqlite, "editor@example.com", "editor");
  const project = addProject(sqlite, ASK);
  const send = addSend(sqlite, project);
  const batches: string[][] = [];
  const db = d1(sqlite, batches);
  expect(
    await applyObservedStage(db, send, "submitted", at(0), "atlas", {
      superAdmins: ["Root@example.com", "boss@example.com", ""],
    }),
  ).toBe(true);
  // The transition and its notices are one D1 batch: both or neither.
  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(2);
  expect(batches[0][0]).toMatch(/^INSERT INTO atlas_flightdeck_transitions /);
  expect(batches[0][1]).toMatch(/atlas_notifications/);
  expect(notices(sqlite, send)).toEqual(
    ["asker@example.com", "boss@example.com", "root@example.com"].map(
      (recipient) => ({
        recipient,
        project_id: project,
        text: noticeText("submitted"),
        created_at: at(0),
        read: 0,
        send_id: send,
        seq: 1,
      }),
    ),
  );
  // A repeat is not a transition, so it notifies nobody.
  expect(
    await applyObservedStage(db, send, "submitted", at(1), "poll", NOTIFY),
  ).toBe(false);
  expect(notices(sqlite, send)).toHaveLength(3);
});

test("(b) a withdrawn ask is not notified; a send nobody asked for notifies the Super Admins", async () => {
  const sqlite = database();
  const withdrawn = addProject(sqlite, {
    ...ASK,
    withdrawnAt: "2026-09-24T10:00:00.000Z",
  });
  const sendA = addSend(sqlite, withdrawn);
  await applyObservedStage(
    d1(sqlite),
    sendA,
    "submitted",
    at(0),
    "atlas",
    NOTIFY,
  );
  expect(notices(sqlite, sendA).map((r) => r.recipient)).toEqual([
    "root@example.com",
  ]);
  const unasked = addProject(sqlite);
  const sendB = addSend(sqlite, unasked);
  await applyObservedStage(
    d1(sqlite),
    sendB,
    "submitted",
    at(0),
    "atlas",
    NOTIFY,
  );
  expect(notices(sqlite, sendB).map((r) => r.recipient)).toEqual([
    "root@example.com",
  ]);
});

test("(c) poll and webhook racing or arriving out of order give one notice set and no stage regression", async () => {
  const sqlite = database();
  const project = addProject(sqlite, ASK);
  const send = addSend(sqlite, project);
  const db = d1(sqlite);
  const results = await Promise.all(
    (["poll", "webhook", "poll", "webhook"] as const).map((source) =>
      applyObservedStage(db, send, "submitted", at(0), source, NOTIFY),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(notices(sqlite, send)).toHaveLength(2);
  await applyObservedStage(
    db,
    send,
    "setup-in-progress",
    at(2),
    "webhook",
    NOTIFY,
  );
  // An older poll answer arrives after the webhook: no row, no notice.
  for (const late of ["submitted", "linked"] as const)
    expect(
      await applyObservedStage(db, send, late, at(3), "poll", NOTIFY),
    ).toBe(false);
  expect(
    notices(sqlite, send).map((r) => [r.seq, r.recipient, r.text]),
  ).toEqual([
    [1, "asker@example.com", noticeText("submitted")],
    [1, "root@example.com", noticeText("submitted")],
    [2, "asker@example.com", noticeText("setup-in-progress")],
    [2, "root@example.com", noticeText("setup-in-progress")],
  ]);
});

test("(c) a lost race records neither the transition nor its notices", async () => {
  const sqlite = database();
  const project = addProject(sqlite, ASK);
  const send = addSend(sqlite, project);
  const db = d1(sqlite);
  const failing: OnboardDb = {
    prepare: db.prepare,
    async batch() {
      throw new Error(
        "D1_ERROR: UNIQUE constraint failed: atlas_flightdeck_transitions.send_id, atlas_flightdeck_transitions.seq",
      );
    },
  };
  expect(
    await applyObservedStage(failing, send, "submitted", at(0), "poll", NOTIFY),
  ).toBe(false);
  // A notice write failing rolls the transition back with it, so the next
  // observation records both.
  sqlite.exec(
    "CREATE TRIGGER t_fail BEFORE INSERT ON atlas_notifications BEGIN SELECT RAISE(ABORT,'disk full'); END",
  );
  await expect(
    applyObservedStage(db, send, "submitted", at(0), "poll", NOTIFY),
  ).rejects.toThrow(/disk full/);
  expect(
    sqlite
      .prepare("SELECT COUNT(*) AS c FROM atlas_flightdeck_transitions")
      .get(),
  ).toEqual({ c: 0 });
  sqlite.exec("DROP TRIGGER t_fail");
  expect(
    await applyObservedStage(db, send, "submitted", at(1), "poll", NOTIFY),
  ).toBe(true);
  expect(notices(sqlite, send)).toHaveLength(2);
});

test("(d) a recurring stage notifies again, and the needs-changes notice never holds the reviewer's note", async () => {
  const sqlite = database();
  const project = addProject(sqlite, ASK);
  const send = addSend(sqlite, project);
  const db = d1(sqlite);
  const path: OnboardingStage[] = [
    "submitted",
    "needs-more-info",
    "submitted",
    "needs-more-info",
  ];
  for (const [i, stage] of path.entries())
    expect(
      await applyObservedStage(db, send, stage, at(i), "poll", NOTIFY),
    ).toBe(true);
  const asker = notices(sqlite, send).filter(
    (r) => r.recipient === "asker@example.com",
  );
  expect(asker.map((r) => [r.seq, r.text])).toEqual([
    [1, noticeText("submitted")],
    [2, NEEDS_CHANGES_TEXT],
    [3, noticeText("submitted")],
    [4, NEEDS_CHANGES_TEXT],
  ]);
  expect(NEEDS_CHANGES_TEXT).toBe("Your FlightDeck request needs changes");
  expect(noticeText("needs-more-info")).toBe(NEEDS_CHANGES_TEXT);
  for (const row of notices(sqlite))
    expect(String(row.text)).not.toMatch(/SECRET-REVIEWER-NOTE|salary/);
});

test("(e) the read re-checks project access and the unread flag persists", async () => {
  const sqlite = database();
  const kept = addProject(sqlite, ASK);
  const revoked = addProject(sqlite, ASK);
  const db = d1(sqlite);
  for (const project of [kept, revoked])
    await applyObservedStage(
      db,
      addSend(sqlite, project),
      "submitted",
      at(project === kept ? 1 : 2),
      "atlas",
      NOTIFY,
    );
  // The asker lost access to `revoked` after the notice was written.
  const canView = async (id: string) => id === kept;
  const first = await noticesFor(db, "asker@example.com", canView);
  expect(first.map((r) => [r.project_id, r.read])).toEqual([[kept, 0]]);
  // Nobody marks someone else's notice read.
  expect(
    await markNoticeRead(db, String(first[0].id), "root@example.com"),
  ).toBe(false);
  expect(
    await markNoticeRead(db, String(first[0].id), "asker@example.com"),
  ).toBe(true);
  const again = await noticesFor(db, "Asker@Example.com", canView);
  expect(again.map((r) => [r.project_id, r.read])).toEqual([[kept, 1]]);
  // The Super Admin's own copy is still unread.
  const admin = await noticesFor(db, "root@example.com", async () => true);
  expect(admin.map((r) => r.read)).toEqual([0, 0]);
});
