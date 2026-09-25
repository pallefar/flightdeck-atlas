ALTER TABLE `atlas_flightdeck_operations` ADD `check_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `atlas_flightdeck_operations` ADD `unreachable_since` text;