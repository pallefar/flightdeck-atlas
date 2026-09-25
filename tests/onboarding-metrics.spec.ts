// Atlas onboarding measures (plan 2026-09-25 lane A "GATE metrics", item
// onb-metrics-atlas; D-037 item 7 approves ONB_METRICS_ENABLED, default OFF).
// Time to first saved draft, ask-to-send and the correction rate are read off
// one event per moment and draft, {draft_hash, kind, at}: the draft's Atlas
// project id only as its sha256, never a field value. What this file pins,
// each a way a measure could leak or lie:
//   - the table has exactly the three columns, one row per (draft, kind);
//   - with the flag unset, or anything but the exact string "true", nothing
//     is written;
//   - a row holds the hash, never the id, and an unknown kind is refused;
//   - a draft save counts only when it wrote the onboarding field;
//   - the summary pairs moments per draft and never invents a duration.
// Literals, not imports, for the kind words and the table, so a rename fails
// here instead of redefining what was measured.
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { OnboardDb } from "../lib/flightdeck/onboard-route";
import {
  metricsFlagOn,
  onboardingMetricEvents,
  recordDraftSave,
  recordOnboardingMetric,
  summariseOnboardingMetrics,
} from "../lib/flightdeck/metrics";
import { withD1Batch } from "./fixtures/d1-batch";

const dir = new URL("../drizzle/", import.meta.url);
const migrations = () =>
  readdirSync(dir)
    .filter((n) => /^\d{4}_\w+\.sql$/.test(n))
    .sort();
function store() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of migrations())
    for (const statement of readFileSync(new URL(name, dir), "utf8").split(
      "--> statement-breakpoint",
    ))
      if (statement.trim()) sqlite.exec(statement);
  const db: OnboardDb = withD1Batch(sqlite, {
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
  });
  const rows = () =>
    sqlite
      .prepare("SELECT * FROM atlas_onboarding_metrics ORDER BY at, kind")
      .all() as Record<string, unknown>[];
  return { sqlite, db, rows };
}
const DRAFT = "4f7d1c2a-8b3e-4c5d-9e6f-a1b2c3d4e5f6";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const hash = (id: string) => createHash("sha256").update(id).digest("hex");
const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 25, 9, minute)).toISOString();

test("the measures table holds only {draft_hash, kind, at}, one row per draft and kind, and the journal lists it", () => {
  const journal = JSON.parse(
    readFileSync(new URL("meta/_journal.json", dir), "utf8"),
  ) as { entries: { tag: string }[] };
  expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(migrations());
  const { sqlite } = store();
  const columns = sqlite
    .prepare("PRAGMA table_info(atlas_onboarding_metrics)")
    .all() as { name: string; notnull: number }[];
  expect(columns.map(({ name, notnull }) => [name, notnull])).toEqual([
    ["draft_hash", 1],
    ["kind", 1],
    ["at", 1],
  ]);
  const insert = sqlite.prepare(
    "INSERT INTO atlas_onboarding_metrics (draft_hash,kind,at) VALUES (?,?,?)",
  );
  insert.run(hash(DRAFT), "sent", at(1));
  expect(() => insert.run(hash(DRAFT), "sent", at(2))).toThrow(/UNIQUE/);
  // The CHECK keeps the table to the five moments, whoever writes it.
  expect(() => insert.run(hash(DRAFT), "label", at(3))).toThrow(/CHECK/);
});

test("default off: nothing is written unless the flag is the exact string \"true\"", async () => {
  for (const value of [undefined, "", "1", "TRUE", "yes", " true", true])
    expect(metricsFlagOn(value)).toBe(false);
  expect(metricsFlagOn("true")).toBe(true);
  const { db, rows } = store();
  expect(
    await recordOnboardingMetric(db, false, DRAFT, "draft-opened", at(0)),
  ).toBe(false);
  expect(
    await recordDraftSave(
      db,
      false,
      DRAFT,
      { onboarding: undefined },
      { onboarding: { countryCode: "DE" } },
      at(1),
    ),
  ).toBe(false);
  expect(rows()).toEqual([]);
});

test("a moment is recorded once per draft, as the draft's hash, and an unknown kind is refused", async () => {
  const { db, rows } = store();
  expect(await recordOnboardingMetric(db, true, DRAFT, "sent", at(5))).toBe(
    true,
  );
  expect(await recordOnboardingMetric(db, true, DRAFT, "sent", at(9))).toBe(
    false,
  );
  expect(
    await recordOnboardingMetric(db, true, DRAFT, "label" as never, at(9)),
  ).toBe(false);
  expect(rows()).toEqual([
    { draft_hash: hash(DRAFT), kind: "sent", at: at(5) },
  ]);
  expect(JSON.stringify(rows())).not.toContain(DRAFT);
  // A storage failure never reaches the request it measures.
  const broken: OnboardDb = {
    prepare() {
      throw new Error("D1 unavailable");
    },
  };
  expect(await recordOnboardingMetric(broken, true, DRAFT, "sent", at(5))).toBe(
    false,
  );
});

test("a draft save counts only when it wrote the onboarding field, and records no value of it", async () => {
  const { db, rows } = store();
  const draft = {
    countryCode: "DE",
    legalEntity: "TE Connectivity Germany GmbH",
  };
  // Another field of the project changed; the draft did not.
  expect(
    await recordDraftSave(db, true, DRAFT, { onboarding: undefined }, {
      onboarding: undefined,
    }, at(1)),
  ).toBe(false);
  expect(
    await recordDraftSave(
      db,
      true,
      DRAFT,
      { onboarding: draft },
      { onboarding: { ...draft } },
      at(2),
    ),
  ).toBe(false);
  expect(
    await recordDraftSave(
      db,
      true,
      DRAFT,
      { onboarding: undefined },
      { onboarding: draft },
      at(3),
    ),
  ).toBe(true);
  // Only the first saved draft is the moment.
  expect(
    await recordDraftSave(
      db,
      true,
      DRAFT,
      { onboarding: draft },
      { onboarding: { ...draft, countryCode: "AT" } },
      at(4),
    ),
  ).toBe(false);
  expect(rows()).toEqual([
    { draft_hash: hash(DRAFT), kind: "draft-saved", at: at(3) },
  ]);
  const stored = JSON.stringify(rows());
  for (const value of [DRAFT, "DE", "TE Connectivity"])
    expect(stored).not.toContain(value);
});

test("the summary pairs each draft's moments: time to first saved draft, ask-to-send, correction rate", async () => {
  const { db } = store();
  const record = (id: string, kind: string, minute: number) =>
    recordOnboardingMetric(db, true, id, kind as never, at(minute));
  await record(DRAFT, "draft-opened", 0);
  await record(DRAFT, "draft-saved", 4);
  await record(DRAFT, "asked", 10);
  await record(DRAFT, "sent", 40);
  await record(DRAFT, "correction", 50);
  // A draft saved before the flag was on: no opened moment, no duration.
  await record(OTHER, "draft-saved", 1);
  await record(OTHER, "sent", 20);
  const events = await onboardingMetricEvents(db);
  expect(events.every((e) => Object.keys(e).sort().join() === "at,draftHash,kind")).toBe(true);
  expect(summariseOnboardingMetrics(events)).toEqual({
    timeToFirstSavedDraft: { count: 1, medianMs: 4 * 60_000 },
    askToSend: { count: 1, medianMs: 30 * 60_000 },
    correctionRate: { sent: 2, corrected: 1, rate: 0.5 },
  });
  // A moment out of order (clock skew, flag turned on midway) is skipped,
  // never counted as a negative or zero duration.
  expect(
    summariseOnboardingMetrics([
      { draftHash: "a", kind: "draft-opened", at: at(9) },
      { draftHash: "a", kind: "draft-saved", at: at(3) },
    ]),
  ).toEqual({
    timeToFirstSavedDraft: { count: 0, medianMs: null },
    askToSend: { count: 0, medianMs: null },
    correctionRate: { sent: 0, corrected: 0, rate: null },
  });
});
