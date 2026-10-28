CREATE TABLE `atlas_gate_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`seq` integer NOT NULL,
	`stage` text NOT NULL,
	`from_stage` text,
	`to_stage` text,
	`actor` text NOT NULL,
	`role` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`evidence_ref` text,
	`material_digest` text,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_gate_events_decision" CHECK("atlas_gate_events"."decision" IN ('pass','reject','reopen'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_gate_events_project_seq` ON `atlas_gate_events` (`project_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_atlas_gate_events_project` ON `atlas_gate_events` (`project_id`,`created_at`);