import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const works = sqliteTable('works', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('未命名短剧'),
  currentVersionId: text('current_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  parentVersionId: text('parent_version_id'),
  operation: text('operation').notNull(),
  status: text('status').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  generatedSegment: text('generated_segment'),
  creativeBriefJson: text('creative_brief_json').notNull(),
  changeSummary: text('change_summary'),
  checksJson: text('checks_json'),
  modelName: text('model_name'),
  usageJson: text('usage_json'),
  contentHash: text('content_hash'),
  validatorVersion: text('validator_version'),
  validatedAt: text('validated_at'),
  adoptedAt: text('adopted_at'),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('idx_versions_work_created').on(table.workId, table.createdAt),
  index('idx_versions_parent').on(table.parentVersionId)
]);

export const generationTasks = sqliteTable('generation_tasks', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  sourceVersionId: text('source_version_id'),
  creativeBriefJson: text('creative_brief_json').notNull(),
  sourceHash: text('source_hash'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  provider: text('provider'),
  modelName: text('model_name'),
  usageJson: text('usage_json'),
  costState: text('cost_state').notNull().default('unknown'),
  resultVersionId: text('result_version_id'),
  attemptCount: integer('attempt_count').notNull().default(0),
  transportAttempts: integer('transport_attempts').notNull().default(0),
  formatRepairAttempts: integer('format_repair_attempts').notNull().default(0),
  validatorAttempts: integer('validator_attempts').notNull().default(0),
  promptTemplateId: text('prompt_template_id'),
  mergeStrategy: text('merge_strategy'),
  outputKind: text('output_kind'),
  candidateContentHash: text('candidate_content_hash'),
  validatorVersion: text('validator_version'),
  validationStatus: text('validation_status'),
  sourceIsCurrent: integer('source_is_current'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at')
}, (table) => [
  index('idx_tasks_work_created').on(table.workId, table.createdAt),
  index('idx_tasks_status').on(table.status)
]);

export const storyFactsSnapshots = sqliteTable('story_facts_snapshots', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  versionId: text('version_id').notNull().unique(),
  contentHash: text('content_hash').notNull(),
  factsJson: text('facts_json').notNull(),
  extractionStatus: text('extraction_status').notNull(),
  provider: text('provider'),
  modelName: text('model_name'),
  validatorVersion: text('validator_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('idx_story_facts_work_version').on(table.workId, table.versionId)
]);

export const adoptionEvents = sqliteTable('adoption_events', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  candidateVersionId: text('candidate_version_id').notNull(),
  previousCurrentVersionId: text('previous_current_version_id'),
  newCurrentVersionId: text('new_current_version_id'),
  result: text('result').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('idx_adoption_events_work_created').on(table.workId, table.createdAt)
]);
