CREATE TABLE `work_edit_drafts` (
	`work_id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`based_on_version_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_operation_drafts` (
	`work_id` text NOT NULL,
	`operation` text NOT NULL,
	`draft_id` text NOT NULL,
	`source_version_id` text,
	`instruction` text DEFAULT '' NOT NULL,
	`form_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`consumed_at` text,
	PRIMARY KEY(`work_id`, `operation`)
);
--> statement-breakpoint
CREATE INDEX `idx_work_operation_drafts_updated` ON `work_operation_drafts` (`work_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `story_memory_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`version_id` text NOT NULL,
	`memory_item_id` text NOT NULL,
	`action` text NOT NULL,
	`value_json` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memory_annotations_work_version` ON `story_memory_annotations` (`work_id`,`version_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `candidate_check_decisions` (
	`candidate_version_id` text NOT NULL,
	`finding_key` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`candidate_version_id`, `finding_key`)
);
