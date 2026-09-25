CREATE TABLE `atlas_onboarding_metrics` (
	`draft_hash` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT "atlas_onboarding_metrics_kind" CHECK("atlas_onboarding_metrics"."kind" IN ('draft-opened','draft-saved','asked','sent','correction'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_onboarding_metrics_draft_kind` ON `atlas_onboarding_metrics` (`draft_hash`,`kind`);