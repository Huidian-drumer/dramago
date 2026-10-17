ALTER TABLE `generation_tasks` ADD `writer_provider_config_version` integer;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `writer_credential_ref` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_provider_config_version` integer;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_credential_ref` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `planner_provider_id` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `writer_provider_config_version` integer;
--> statement-breakpoint
ALTER TABLE `versions` ADD `validator_provider_config_version` integer;
--> statement-breakpoint
ALTER TABLE `candidate_validation_runs` ADD `provider_config_version` integer;
--> statement-breakpoint
ALTER TABLE `candidate_validation_runs` ADD `credential_ref` text;
