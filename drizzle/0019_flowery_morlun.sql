ALTER TABLE `atlas_gate_events` ADD `lane` text DEFAULT 'governed' NOT NULL;--> statement-breakpoint
ALTER TABLE `atlas_gate_events` ADD `deferred` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `atlas_onboarding` ADD `lane` text DEFAULT 'governed' NOT NULL;