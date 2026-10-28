import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
export const projects = sqliteTable(
  "atlas_projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    data: text("data").notNull(),
    source: text("source").notNull().default("atlas"),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [index("idx_atlas_projects_owner").on(t.ownerId)],
);

export const roles = sqliteTable("atlas_roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  permissions: text("permissions").notNull(),
  builtin: integer("builtin").notNull().default(0),
});
export const members = sqliteTable("atlas_members", {
  email: text("email").primaryKey(),
  userId: text("user_id"),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  disabled: integer("disabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export const accessEvents = sqliteTable("atlas_access_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: text("created_at").notNull(),
});

export const teams = sqliteTable("atlas_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const projectShares = sqliteTable("atlas_project_shares", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const apps = sqliteTable("atlas_apps", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const collaboration = sqliteTable(
  "atlas_collaboration",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    author: text("author").notNull(),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [index("idx_atlas_collaboration_project").on(t.projectId)],
);
export const notifications = sqliteTable(
  "atlas_notifications",
  {
    id: text("id").primaryKey(),
    recipient: text("recipient").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
    read: integer("read").notNull().default(0),
    /** The FlightDeck send and transition seq a notice reports (lib/
     * flightdeck/notices.ts); null for every other notice. No foreign key:
     * the notice goes with its project, not with the send's log. */
    sendId: text("send_id"),
    seq: integer("seq"),
  },
  (t) => [
    index("idx_atlas_notifications_recipient").on(t.recipient, t.createdAt),
    uniqueIndex("uniq_atlas_notifications_send_seq_recipient").on(
      t.sendId,
      t.seq,
      t.recipient,
    ),
  ],
);
export const files = sqliteTable(
  "atlas_files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    author: text("author").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_atlas_files_project").on(t.projectId)],
);
export const decks = sqliteTable(
  "atlas_decks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    data: text("data").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_atlas_decks_owner").on(t.ownerId)],
);
export const preferences = sqliteTable("atlas_preferences", {
  userId: text("user_id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});

export const workRecords = sqliteTable(
  "atlas_work_records",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    owner: text("owner").notNull(),
    data: text("data").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
    availableAt: text("available_at").notNull().default(""),
    closed: integer("closed").notNull().default(0),
  },
  (t) => [
    index("idx_atlas_work_project").on(t.projectId, t.kind),
    index("idx_atlas_work_owner_due").on(t.owner, t.availableAt),
  ],
);

/** Atlas -> FlightDeck OS onboarding sends (plan §4.7). A row is reserved
 * with a fresh idempotency key BEFORE the remote call; a lost response keeps
 * the row and its key, so a retry can never file a second request. At most
 * one open send per Atlas project (reserved, filed, promoted or linked).
 * `setup_state` and `checked_at` extend the §4.7 list: the status timeline
 * and the server-side one-read-a-minute throttle need them. Migration 0005
 * adds `request_body` and `adopted` (see below). */
export const flightdeckOperations = sqliteTable(
  "atlas_flightdeck_operations",
  {
    id: text("id").primaryKey(),
    atlasProjectId: text("atlas_project_id").notNull(),
    atlasRevision: integer("atlas_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    destinationWorkspaceId: text("destination_workspace_id").notNull(),
    proposedLabel: text("proposed_label").notNull(),
    proposedProjectId: text("proposed_project_id"),
    state: text("state").notNull(),
    submissionId: text("submission_id"),
    receivedAt: text("received_at"),
    payloadSha256: text("payload_sha256"),
    reasonCode: text("reason_code"),
    setupState: text("setup_state"),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
    checkedAt: text("checked_at"),
    /** The exact envelope reserved with the key. A retry resends these bytes
     * and never rebuilds them, because FlightDeck keeps what the key first
     * filed. Held only while the send is unconfirmed; cleared once FlightDeck
     * files or refuses it, or once the Super Admin closes the send, so Atlas
     * keeps no second copy of the free text. Deleting the project cannot
     * strand it either: the project delete refuses while a send is
     * unconfirmed, and takes this row with the project once it is not. */
    requestBody: text("request_body"),
    /** FlightDeck already held a request for this project that Atlas had no
     * record of, and Atlas adopted it after the read-back matched the
     * subject. Its destination and revision are FlightDeck's, not this
     * row's, so Atlas never shows or links them as its own. */
    adopted: integer("adopted", { mode: "boolean" }).notNull().default(false),
    /** Read-backs in a row that could not reach FlightDeck (plan 2026-09-25
     * J4, the honest outage). Any answer from FlightDeck resets it. */
    checkFailures: integer("check_failures").notNull().default(0),
    /** When the first of those failed read-backs happened; null once
     * FlightDeck answers again. The status shows it from the third. */
    unreachableSince: text("unreachable_since"),
    /** onb-resubmit-atlas: a sha256 per reviewer-pointable field of what
     * this send carried (JSON), never the values, so 'Fix and resubmit'
     * can tell whether a field the reviewer named changed. */
    fieldDigests: text("field_digests"),
    /** The earlier needs-more-info send this one resubmits (Atlas's own
     * link, kept whether or not FlightDeck links them). */
    supersedesSendId: text("supersedes_send_id"),
    /** The earlier request's FlightDeck id this send named in
     * payload.supersedes; null when FlightDeck was not asked to link. */
    supersedesSubmissionId: text("supersedes_submission_id"),
    /** The reviewer's field pointers (JSON) this resubmission was compared
     * against; null when none were named. Kept apart from the note, which
     * the send clears, so a refused attempt leaves the next one gated by
     * the same fields. */
    compareFields: text("compare_fields"),
  },
  (t) => [
    index("idx_atlas_fd_operations_project").on(t.atlasProjectId, t.updatedAt),
    uniqueIndex("uniq_atlas_fd_operations_open")
      .on(t.atlasProjectId)
      .where(sql`state IN ('reserved','filed','promoted','linked')`),
  ],
);
/** The transition log of a send (plan 2026-09-25 §7): one row per stage
 * Atlas SAW the send move to, numbered per send. `observed_at` means "seen
 * by Atlas" (its own send's answer, a read-back poll or a webhook), and is
 * null only on the one 'backfill' row migration 0006 writes for a send that
 * predates the log. Written only through applyObservedStage
 * (lib/flightdeck/transitions.ts), which keeps the log monotonic. Goes with
 * its send (ON DELETE CASCADE), so a project delete takes it too. */
export const flightdeckTransitions = sqliteTable(
  "atlas_flightdeck_transitions",
  {
    sendId: text("send_id")
      .notNull()
      .references(() => flightdeckOperations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stage: text("stage").notNull(),
    observedAt: text("observed_at"),
    source: text("source").notNull(),
    /** The reviewer's plain-text note (D-037 item 5), on a needs-more-info
     * row only, and the allowlisted field pointers with it (a JSON array).
     * This row is the note's only home in Atlas. Cleared once the send
     * moves on or a new send of the project is made, and deleted with the
     * send (the project delete). Written only through applyObservedStage. */
    note: text("note"),
    fields: text("fields"),
  },
  (t) => [
    uniqueIndex("uniq_atlas_fd_transitions_send_seq").on(t.sendId, t.seq),
    check(
      "atlas_fd_transitions_source",
      sql`${t.source} IN ('atlas','poll','webhook','backfill')`,
    ),
  ],
);
/** Onboarding measures (plan 2026-09-25 lane A "GATE metrics"; written only
 * while ONB_METRICS_ENABLED is "true", default off): one row per moment of a
 * draft, keyed by the sha256 of its Atlas project id, so time to first saved
 * draft, ask-to-send and the correction rate can be read off them. No field
 * value, id, label, user or workspace is stored, only {draft_hash, kind,
 * at}. Written only through recordOnboardingMetric (lib/flightdeck/
 * metrics.ts); the first of each moment wins. */
export const onboardingMetrics = sqliteTable(
  "atlas_onboarding_metrics",
  {
    draftHash: text("draft_hash").notNull(),
    kind: text("kind").notNull(),
    at: text("at").notNull(),
  },
  (t) => [
    uniqueIndex("uniq_atlas_onboarding_metrics_draft_kind").on(
      t.draftHash,
      t.kind,
    ),
    check(
      "atlas_onboarding_metrics_kind",
      sql`${t.kind} IN ('draft-opened','draft-saved','asked','sent','correction')`,
    ),
  ],
);
/** Confirmed Atlas <-> OS project links (PROJECT-BRIDGE-CONTRACT.md:27-32).
 * Written only after the OS read-back says promoted AND read:context lists
 * the project. Installation-scoped, outside the editable project JSON.
 * Deleted with its Atlas project: `uniq_atlas_project_links_os` would
 * otherwise hold the OS project against a project Atlas no longer has, and
 * every later promotion onto it would answer `link_conflict` for good. */
export const projectLinks = sqliteTable(
  "atlas_project_links",
  {
    installationId: text("installation_id").notNull(),
    osInstanceId: text("os_instance_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    osProjectId: text("os_project_id").notNull(),
    atlasProjectId: text("atlas_project_id").notNull(),
    submissionId: text("submission_id"),
    linkedAt: text("linked_at").notNull(),
    linkedBy: text("linked_by").notNull(),
    sourceRevision: integer("source_revision"),
    lastCheckedAt: text("last_checked_at").notNull(),
    accessState: text("access_state").notNull(),
  },
  (t) => [
    uniqueIndex("uniq_atlas_project_links_os").on(
      t.installationId,
      t.osInstanceId,
      t.workspaceId,
      t.osProjectId,
    ),
    uniqueIndex("uniq_atlas_project_links_atlas").on(
      t.installationId,
      t.atlasProjectId,
    ),
  ],
);
/** Latest committed delivery projection, retried until OS acknowledges it.
 * Written in the same D1 batch as its project revision; no private Vision data. */
export const visionDeliveryOutbox = sqliteTable("atlas_vision_delivery_outbox", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  atlasRevision: integer("atlas_revision").notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});
/** The onboarding audit chain (Atlas v1, PRD §6/§9 G-9). Append-only: one
 * row per gate decision or stage move, chained by hash to its predecessor, so
 * a deleted, reordered or edited row breaks verifyChain (lib/audit/chain.ts)
 * at a known seq instead of passing unnoticed. Written only through
 * appendGateEvent; nothing else may insert here, and no route updates or
 * deletes a row. `seq` starts at 1 per project; the pair is unique, which is
 * what makes a concurrent append fail loudly rather than fork the chain. */
export const gateEvents = sqliteTable(
  "atlas_gate_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    stage: text("stage").notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    actor: text("actor").notNull(),
    role: text("role").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull().default(""),
    evidenceRef: text("evidence_ref"),
    materialDigest: text("material_digest"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uniq_atlas_gate_events_project_seq").on(t.projectId, t.seq),
    index("idx_atlas_gate_events_project").on(t.projectId, t.createdAt),
    check(
      "atlas_gate_events_decision",
      sql`${t.decision} IN ('pass','reject','reopen')`,
    ),
  ],
);
/** The brain's own fields for one project (Atlas v1). One row per Atlas
 * project, created when a project enters the onboarding flow. `data` holds
 * the editable facts (lib/onboarding/model.ts, brainDataSchema); `stage` and
 * `status` are indexed copies the pipeline board reads without parsing JSON.
 * The revision is the concurrency token every save and gate must match, the
 * same rule the rest of Atlas uses. */
export const onboarding = sqliteTable(
  "atlas_onboarding",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("intake"),
    status: text("status").notNull().default("active"),
    data: text("data").notNull(),
    revision: integer("revision").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_atlas_onboarding_stage").on(t.stage, t.updatedAt),
    check("atlas_onboarding_status", sql`${t.status} IN ('active','retired')`),
  ],
);
/** Evidence metadata only (PRD §7.3, §9). The bytes live in the OS docstore;
 * this table keeps the reference, the hash and the verdict. A `blocked`
 * classification or scan never gets here at all — the upload path refuses it
 * before the insert — so a row existing is already a statement that it was
 * allowed. Findings are codes, never matched values. */
export const evidence = sqliteTable(
  "atlas_evidence",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    classification: text("classification").notNull(),
    scanState: text("scan_state").notNull(),
    findings: text("findings").notNull().default("[]"),
    reviewer: text("reviewer"),
    status: text("status").notNull().default("pending"),
    retentionDeleteAfter: text("retention_delete_after"),
    osRef: text("os_ref"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_atlas_evidence_project").on(t.projectId, t.createdAt),
    check(
      "atlas_evidence_scan_state",
      sql`${t.scanState} IN ('clear','review','blocked')`,
    ),
    check(
      "atlas_evidence_status",
      sql`${t.status} IN ('pending','accepted','rejected','redacted')`,
    ),
    check(
      "atlas_evidence_classification",
      sql`${t.classification} IN ('public','internal','confidential','export-restricted','itar','cui','customer-pii')`,
    ),
  ],
);
/** The reuse check (PRD FR-4..FR-6): what was searched, what matched, and the
 * decision with its reason. One row per project, replaced on a re-check but
 * the decision is also on the audit chain, so replacing the row never erases
 * what was decided before. */
export const reuseChecks = sqliteTable("atlas_reuse_checks", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  matches: text("matches").notNull().default("[]"),
  decidedBy: text("decided_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
/** A value record (PRD §7.7). Figures are JSON so adding a measure does not
 * need a migration; the basis is a column because every read filters on it.
 * A `measured` row always has a source_ref — the contract refuses otherwise
 * and this table repeats the rule as a CHECK. */
export const valueRecords = sqliteTable(
  "atlas_value",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    basis: text("basis").notNull(),
    period: text("period").notNull(),
    tier: text("tier"),
    figures: text("figures").notNull().default("{}"),
    target: text("target").notNull().default("{}"),
    method: text("method").notNull(),
    methodVersion: text("method_version").notNull(),
    confidence: text("confidence").notNull(),
    sourceRef: text("source_ref"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_atlas_value_project").on(t.projectId, t.period, t.createdAt),
    check("atlas_value_basis", sql`${t.basis} IN ('estimate','measured','not-tracked')`),
    check(
      "atlas_value_measured_source",
      sql`${t.basis} <> 'measured' OR (${t.sourceRef} IS NOT NULL AND ${t.sourceRef} <> '')`,
    ),
  ],
);
/** One hand-off to another tool (KG, DiagramForge, Studio, Companion), as a
 * durable outbox: reserved with an idempotency key and the exact body before
 * anything leaves Atlas, so a lost reply is retried with the same bytes and
 * can never file twice. The same discipline as
 * atlas_flightdeck_operations, which this deliberately mirrors. */
export const handoffs = sqliteTable(
  "atlas_handoffs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    direction: text("direction").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    requestBody: text("request_body").notNull(),
    status: text("status").notNull().default("reserved"),
    receipt: text("receipt"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_atlas_handoffs_project").on(t.projectId, t.updatedAt),
    check(
      "atlas_handoffs_kind",
      sql`${t.kind} IN ('kg','diagramforge','studio','companion')`,
    ),
    check(
      "atlas_handoffs_status",
      sql`${t.status} IN ('reserved','sent','filed','refused','abandoned')`,
    ),
  ],
);
