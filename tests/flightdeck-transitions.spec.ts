// The D1 transition log (plan 2026-09-25 §7, onb-atlas-transition-log): one
// row per stage Atlas saw a send move to, with the time Atlas saw it. Built
// over node:sqlite from the real drizzle migrations, so the fresh and the
// upgrade path are both the SQL D1 runs.
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  onboardingStages,
  operationStates,
  rejectionReasons,
  setupStates,
  stageFor,
  type OnboardingStage,
  type OperationState,
} from "../lib/flightdeck/onboarding";
import type { OnboardDb } from "../lib/flightdeck/onboard-route";
import {
  BEFORE_TRACKING,
  applyObservedStage,
  clearProjectNotes,
  decisionNoteOf,
  mayFollow,
  observedAtText,
  transitionsOf,
} from "../lib/flightdeck/transitions";

const dir = new URL("../drizzle/", import.meta.url);
const migrations = () =>
  readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort();
function apply(sqlite: DatabaseSync, name: string) {
  for (const statement of readFileSync(new URL(name, dir), "utf8").split(
    "--> statement-breakpoint",
  ))
    if (statement.trim()) sqlite.exec(statement);
}
function d1(sqlite: DatabaseSync): OnboardDb {
  return {
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
}
function database(upTo?: string) {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of migrations()) {
    if (upTo && name > upTo) break;
    apply(sqlite, name);
  }
  return sqlite;
}
let n = 0;
function addSend(
  sqlite: DatabaseSync,
  state: OperationState,
  reasonCode: string | null = null,
  setupState: string | null = null,
) {
  const id = `op-${++n}`;
  sqlite
    .prepare(
      "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,state,reason_code,setup_state,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      `project-${n}`,
      1,
      `key-${n}`,
      "hr-de",
      "Payroll",
      state,
      reasonCode,
      setupState,
      "user-1",
      "2026-09-20T09:00:00.000Z",
    );
  return id;
}
const rows = (sqlite: DatabaseSync, sendId?: string) =>
  sqlite
    .prepare(
      sendId
        ? "SELECT send_id,seq,stage,observed_at,source FROM atlas_flightdeck_transitions WHERE send_id=? ORDER BY seq"
        : "SELECT send_id,seq,stage,observed_at,source FROM atlas_flightdeck_transitions ORDER BY send_id,seq",
    )
    .all(...(sendId ? [sendId] : [])) as Record<string, unknown>[];
const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 25, 9, minute)).toISOString();

test("(a) a fresh D1 gets the transition table, keyed (send_id, seq), from the journalled migrations", () => {
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", dir), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  // wrangler applies the files; drizzle-kit's journal must list the same ones.
  expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(migrations());
  expect(migrations()[6]).toMatch(/^0006_/);
  const sqlite = database();
  const columns = sqlite
    .prepare("PRAGMA table_info(atlas_flightdeck_transitions)")
    .all() as { name: string; notnull: number; type: string }[];
  expect(
    columns.map(({ name, notnull, type }) => ({
      name,
      notnull,
      type: type.toLowerCase(),
    })),
  ).toEqual([
    { name: "send_id", notnull: 1, type: "text" },
    { name: "seq", notnull: 1, type: "integer" },
    { name: "stage", notnull: 1, type: "text" },
    { name: "observed_at", notnull: 0, type: "text" },
    { name: "source", notnull: 1, type: "text" },
    // Migration 0010: the reviewer note, on a needs-more-info row only.
    { name: "note", notnull: 0, type: "text" },
    { name: "fields", notnull: 0, type: "text" },
  ]);
  const send = addSend(sqlite, "filed");
  const insert = sqlite.prepare(
    "INSERT INTO atlas_flightdeck_transitions (send_id,seq,stage,observed_at,source) VALUES (?,?,?,?,?)",
  );
  insert.run(send, 1, "submitted", at(0), "poll");
  expect(() => insert.run(send, 1, "linked", at(1), "poll")).toThrow(/UNIQUE/);
  // Only the named sources: 'seen by Atlas' has to say how it was seen.
  expect(() => insert.run(send, 2, "linked", at(1), "guess")).toThrow(/CHECK/);
  // A transition belongs to a send, and goes with it.
  expect(() => insert.run("no-such-send", 1, "linked", at(1), "poll")).toThrow(
    /FOREIGN KEY/,
  );
  sqlite
    .prepare("DELETE FROM atlas_flightdeck_operations WHERE id=?")
    .run(send);
  expect(rows(sqlite)).toEqual([]);
  // A fresh database has no sends, so the backfill writes nothing.
  expect(rows(database())).toEqual([]);
});

test("(b) upgrading a D1 at 0005 backfills one 'backfill' row per existing send, at stageFor's stage, observed 'before tracking'", async () => {
  const sqlite = database("0005_romantic_titania.sql");
  const filed = addSend(sqlite, "filed");
  const linked = addSend(sqlite, "linked", null, "awaiting-cowork");
  const declined = addSend(sqlite, "rejected", "duplicate");
  for (const name of migrations().filter(
    (m) => m > "0005_romantic_titania.sql",
  ))
    apply(sqlite, name);
  expect(rows(sqlite)).toEqual([
    {
      send_id: filed,
      seq: 1,
      stage: "submitted",
      observed_at: null,
      source: "backfill",
    },
    {
      send_id: linked,
      seq: 1,
      stage: "setup-in-progress",
      observed_at: null,
      source: "backfill",
    },
    {
      send_id: declined,
      seq: 1,
      stage: "rejected",
      observed_at: null,
      source: "backfill",
    },
  ]);
  const log = await transitionsOf(d1(sqlite), linked);
  expect(log.map((t) => observedAtText(t.observedAt))).toEqual([
    BEFORE_TRACKING,
  ]);
  expect(BEFORE_TRACKING).toBe("before tracking");
  expect(observedAtText(at(3))).toBe(at(3));
  // The next observation follows the backfilled row.
  expect(
    await applyObservedStage(
      d1(sqlite),
      linked,
      "setup-complete",
      at(5),
      "poll",
    ),
  ).toBe(true);
  expect(rows(sqlite, linked).map((r) => [r.seq, r.stage])).toEqual([
    [1, "setup-in-progress"],
    [2, "setup-complete"],
  ]);
});

test("(b) the backfill's SQL stage is stageFor's, for every stored state, reason and setup state", () => {
  const sqlite = database("0005_romantic_titania.sql");
  const expected: Record<string, OnboardingStage> = {};
  for (const state of operationStates)
    for (const reason of [
      null,
      ...rejectionReasons,
      "abandoned",
      "rate_limited",
    ])
      for (const setup of [null, ...setupStates]) {
        const id = addSend(sqlite, state, reason, setup);
        expected[id] = stageFor({
          state,
          reasonCode: reason,
          setupState: setup,
        });
      }
  for (const name of migrations().filter(
    (m) => m > "0005_romantic_titania.sql",
  ))
    apply(sqlite, name);
  const got = Object.fromEntries(
    rows(sqlite).map((r) => [r.send_id as string, r.stage]),
  );
  expect(got).toEqual(expected);
});

test("(c) applyObservedStage appends seq max+1 only when the stage differs from the latest", async () => {
  const sqlite = database();
  const db = d1(sqlite);
  const send = addSend(sqlite, "filed");
  expect(await applyObservedStage(db, send, "submitted", at(0), "atlas")).toBe(
    true,
  );
  expect(await applyObservedStage(db, send, "submitted", at(1), "poll")).toBe(
    false,
  );
  expect(await applyObservedStage(db, send, "linked", at(2), "poll")).toBe(
    true,
  );
  expect(await applyObservedStage(db, send, "linked", at(3), "webhook")).toBe(
    false,
  );
  expect(
    await applyObservedStage(db, send, "setup-in-progress", at(4), "webhook"),
  ).toBe(true);
  expect(rows(sqlite, send)).toEqual([
    {
      send_id: send,
      seq: 1,
      stage: "submitted",
      observed_at: at(0),
      source: "atlas",
    },
    {
      send_id: send,
      seq: 2,
      stage: "linked",
      observed_at: at(2),
      source: "poll",
    },
    {
      send_id: send,
      seq: 3,
      stage: "setup-in-progress",
      observed_at: at(4),
      source: "webhook",
    },
  ]);
  expect((await transitionsOf(db, send)).map((t) => t.stage)).toEqual([
    "submitted",
    "linked",
    "setup-in-progress",
  ]);
  // Each send has its own sequence; an unknown send records nothing.
  const other = addSend(sqlite, "filed");
  expect(await applyObservedStage(db, other, "submitted", at(5), "poll")).toBe(
    true,
  );
  expect(rows(sqlite, other)[0]).toMatchObject({ seq: 1 });
  expect(
    await applyObservedStage(db, "no-such-send", "submitted", at(5), "poll"),
  ).toBe(false);
  // The whole rule is one conditional INSERT…SELECT.
  const statements: string[] = [];
  const spy: OnboardDb = {
    prepare(sql) {
      statements.push(sql);
      return db.prepare(sql);
    },
  };
  await applyObservedStage(spy, other, "linked", at(6), "poll");
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatch(
    /^INSERT INTO atlas_flightdeck_transitions [^]* SELECT /,
  );
});

test("(d) monotonic: a created or declined send never steps back from a late poll or webhook; needs-more-info may reopen to submitted", async () => {
  const sqlite = database();
  const db = d1(sqlite);
  const stagesOf = (send: string) => rows(sqlite, send).map((r) => r.stage);

  const created = addSend(sqlite, "linked");
  await applyObservedStage(db, created, "submitted", at(0), "poll");
  await applyObservedStage(db, created, "setup-in-progress", at(2), "webhook");
  // An older poll answer arrives after the webhook.
  for (const late of [
    "submitted",
    "not-confirmed",
    "linked",
    "needs-more-info",
    "rejected",
  ] as const)
    expect(await applyObservedStage(db, created, late, at(3), "poll")).toBe(
      false,
    );
  expect(
    await applyObservedStage(db, created, "setup-complete", at(4), "poll"),
  ).toBe(true);
  expect(
    await applyObservedStage(
      db,
      created,
      "setup-in-progress",
      at(5),
      "webhook",
    ),
  ).toBe(false);
  expect(stagesOf(created)).toEqual([
    "submitted",
    "setup-in-progress",
    "setup-complete",
  ]);

  const declined = addSend(sqlite, "rejected", "duplicate");
  await applyObservedStage(db, declined, "rejected", at(0), "webhook");
  for (const late of onboardingStages.filter((s) => s !== "rejected"))
    expect(await applyObservedStage(db, declined, late, at(1), "poll")).toBe(
      false,
    );
  expect(stagesOf(declined)).toEqual(["rejected"]);

  const reopened = addSend(sqlite, "filed");
  await applyObservedStage(db, reopened, "submitted", at(0), "atlas");
  await applyObservedStage(db, reopened, "needs-more-info", at(1), "poll");
  expect(
    await applyObservedStage(db, reopened, "not-confirmed", at(2), "poll"),
  ).toBe(false);
  expect(
    await applyObservedStage(db, reopened, "submitted", at(2), "webhook"),
  ).toBe(true);
  expect(await applyObservedStage(db, reopened, "linked", at(3), "poll")).toBe(
    true,
  );
  expect(stagesOf(reopened)).toEqual([
    "submitted",
    "needs-more-info",
    "submitted",
    "linked",
  ]);

  // Closed or refused before FlightDeck confirmed: Atlas ended that send.
  for (const end of ["closed", "not-sent"] as const)
    for (const late of onboardingStages.filter((s) => s !== end))
      expect(mayFollow(end, late)).toBe(false);
  // The happy path only moves forward.
  expect(mayFollow("submitted", "not-confirmed")).toBe(false);
  expect(mayFollow("not-confirmed", "submitted")).toBe(true);
  expect(mayFollow("submitted", "closed")).toBe(true);
  expect(mayFollow(null, "setup-complete")).toBe(true);
});

test("(e) concurrent identical observations insert one row", async () => {
  const sqlite = database();
  const db = d1(sqlite);
  const send = addSend(sqlite, "filed");
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      applyObservedStage(db, send, "submitted", at(0), "poll"),
    ),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(rows(sqlite, send)).toHaveLength(1);
  // Two D1 writers that both computed the same max+1: the loser's INSERT
  // fails on UNIQUE(send_id, seq), which records nothing and is not an error.
  // Any other storage failure still surfaces.
  const failing = (message: string): OnboardDb => ({
    prepare(sql) {
      const real = db.prepare(sql);
      return {
        bind(...values) {
          return {
            ...real.bind(...values),
            async run(): Promise<{ meta: { changes: number } }> {
              throw new Error(message);
            },
          };
        },
      };
    },
  });
  expect(
    await applyObservedStage(
      failing(
        "D1_ERROR: UNIQUE constraint failed: atlas_flightdeck_transitions.send_id, atlas_flightdeck_transitions.seq",
      ),
      send,
      "linked",
      at(1),
      "poll",
    ),
  ).toBe(false);
  await expect(
    applyObservedStage(
      failing("D1_ERROR: disk I/O"),
      send,
      "linked",
      at(1),
      "poll",
    ),
  ).rejects.toThrow(/disk/);
  expect(rows(sqlite, send)).toHaveLength(1);
});

test("(f) a late observation of a superseded send records its stage but never restores its reviewer note", async () => {
  const sqlite = database();
  const db = d1(sqlite);
  // A poll saw the old send rejected (needs more info), then paused before
  // it logged the stage. Meanwhile the corrected send was reserved and the
  // project's notes were cleared. The poll now resumes.
  const old = addSend(sqlite, "rejected", "needs-more-info");
  const project = (
    sqlite
      .prepare(
        "SELECT atlas_project_id FROM atlas_flightdeck_operations WHERE id=?",
      )
      .get(old) as { atlas_project_id: string }
  ).atlas_project_id;
  sqlite
    .prepare(
      "INSERT INTO atlas_flightdeck_operations (id,atlas_project_id,atlas_revision,idempotency_key,destination_workspace_id,proposed_label,state,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "op-corrected",
      project,
      2,
      "key-corrected",
      "hr-de",
      "Payroll",
      "reserved",
      "user-1",
      at(1),
    );
  await clearProjectNotes(db, project);
  expect(
    await applyObservedStage(db, old, "needs-more-info", at(2), "poll", undefined, {
      note: "Please name the site.",
      fields: ["site"],
    }),
  ).toBe(true);
  expect(
    sqlite
      .prepare(
        "SELECT stage,note,fields FROM atlas_flightdeck_transitions WHERE send_id=?",
      )
      .all(old),
  ).toEqual([{ stage: "needs-more-info", note: null, fields: null }]);
  expect(await decisionNoteOf(db, old)).toEqual({});
  // The current send of a project keeps its note.
  const current = addSend(sqlite, "rejected", "needs-more-info");
  await applyObservedStage(db, current, "needs-more-info", at(3), "poll", undefined, {
    note: "Please name the site.",
    fields: ["site"],
  });
  expect(await decisionNoteOf(db, current)).toEqual({
    note: "Please name the site.",
    fields: ["site"],
  });
});
