ALTER TABLE `works` ADD `story_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `works` ADD `completed_version_id` text;
--> statement-breakpoint
ALTER TABLE `works` ADD `completed_at` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `segment_title` text;
--> statement-breakpoint
CREATE TABLE `work_story_plans` (
	`work_id` text PRIMARY KEY NOT NULL,
	`future_plot_json` text DEFAULT '[]' NOT NULL,
	`ending_plan_json` text DEFAULT '[]' NOT NULL,
	`foreshadowing_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL
);

