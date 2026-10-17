CREATE TABLE `generation_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`source_version_id` text,
	`creative_brief_json` text NOT NULL,
	`source_hash` text,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`provider` text,
	`model_name` text,
	`usage_json` text,
	`cost_state` text DEFAULT 'unknown' NOT NULL,
	`result_version_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_work_created` ON `generation_tasks` (`work_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `generation_tasks` (`status`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`parent_version_id` text,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`generated_segment` text,
	`creative_brief_json` text NOT NULL,
	`change_summary` text,
	`checks_json` text,
	`model_name` text,
	`usage_json` text,
	`adopted_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_versions_work_created` ON `versions` (`work_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_versions_parent` ON `versions` (`parent_version_id`);--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '未命名短剧' NOT NULL,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
