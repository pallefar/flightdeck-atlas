CREATE TABLE `atlas_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`classification` text NOT NULL,
	`scan_state` text NOT NULL,
	`findings` text DEFAULT '[]' NOT NULL,
	`reviewer` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`retention_delete_after` text,
	`os_ref` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_evidence_scan_state" CHECK("atlas_evidence"."scan_state" IN ('clear','review','blocked')),
	CONSTRAINT "atlas_evidence_status" CHECK("atlas_evidence"."status" IN ('pending','accepted','rejected','redacted')),
	CONSTRAINT "atlas_evidence_classification" CHECK("atlas_evidence"."classification" IN ('public','internal','confidential','export-restricted','itar','cui','customer-pii'))
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_evidence_project` ON `atlas_evidence` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `atlas_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`direction` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_body` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`receipt` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_handoffs_kind" CHECK("atlas_handoffs"."kind" IN ('kg','diagramforge','studio','companion')),
	CONSTRAINT "atlas_handoffs_status" CHECK("atlas_handoffs"."status" IN ('reserved','sent','filed','refused','abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_handoffs_idempotency_key_unique` ON `atlas_handoffs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_atlas_handoffs_project` ON `atlas_handoffs` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `atlas_onboarding` (
	`project_id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'intake' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_onboarding_status" CHECK("atlas_onboarding"."status" IN ('active','retired'))
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_onboarding_stage` ON `atlas_onboarding` (`stage`,`updated_at`);--> statement-breakpoint
CREATE TABLE `atlas_reuse_checks` (
	`project_id` text PRIMARY KEY NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`matches` text DEFAULT '[]' NOT NULL,
	`decided_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `atlas_value` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`basis` text NOT NULL,
	`period` text NOT NULL,
	`tier` text,
	`figures` text DEFAULT '{}' NOT NULL,
	`target` text DEFAULT '{}' NOT NULL,
	`method` text NOT NULL,
	`method_version` text NOT NULL,
	`confidence` text NOT NULL,
	`source_ref` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_value_basis" CHECK("atlas_value"."basis" IN ('estimate','measured','not-tracked')),
	CONSTRAINT "atlas_value_measured_source" CHECK("atlas_value"."basis" <> 'measured' OR ("atlas_value"."source_ref" IS NOT NULL AND "atlas_value"."source_ref" <> ''))
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_value_project` ON `atlas_value` (`project_id`,`period`,`created_at`);