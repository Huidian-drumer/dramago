CREATE TABLE `story_memory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`version_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`memory_json` text NOT NULL,
	`memory_status` text NOT NULL,
	`extraction_source` text NOT NULL,
	`source_version_id` text,
	`validation_run_id` text,
	`provider` text,
	`model_name` text,
	`validator_version` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_memory_snapshots_version_id_unique` ON `story_memory_snapshots` (`version_id`);
--> statement-breakpoint
CREATE INDEX `idx_story_memory_work_version` ON `story_memory_snapshots` (`work_id`,`version_id`);
--> statement-breakpoint
CREATE INDEX `idx_story_memory_source_version` ON `story_memory_snapshots` (`source_version_id`);
