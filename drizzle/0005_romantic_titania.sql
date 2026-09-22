ALTER TABLE `atlas_flightdeck_operations` ADD `request_body` text;--> statement-breakpoint
ALTER TABLE `atlas_flightdeck_operations` ADD `adopted` integer DEFAULT false NOT NULL;