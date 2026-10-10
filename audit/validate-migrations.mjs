import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(':memory:');
const migrationFiles = (await readdir('drizzle'))
  .filter((file) => /^\d+_.+\.sql$/u.test(file))
  .sort()
  .map((file) => `drizzle/${file}`);
for (const file of migrationFiles) {
  const sql = (await readFile(file, 'utf8')).replaceAll('--> statement-breakpoint', '');
  database.exec(sql);
}

const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
const taskColumns = database.prepare('PRAGMA table_info(generation_tasks)').all();
const versionColumns = database.prepare('PRAGMA table_info(versions)').all();
const requiredTaskColumns = ['execution_input_json', 'content_plan_json', 'stage', 'stage_started_at', 'stage_finished_at',
  'last_error_code', 'updated_at', 'plan_model_name', 'validator_model_name', 'semantic_validation_json'];
const requiredVersionColumns = ['validation_status', 'can_auto_apply'];
const taskNames = new Set(taskColumns.map((column) => column.name));
const versionNames = new Set(versionColumns.map((column) => column.name));
const missing = [
  ...requiredTaskColumns.filter((column) => !taskNames.has(column)).map((column) => `generation_tasks.${column}`),
  ...requiredVersionColumns.filter((column) => !versionNames.has(column)).map((column) => `versions.${column}`)
];
if (missing.length) throw new Error(`迁移缺少运行时可靠性字段：${missing.join(', ')}`);
console.log(JSON.stringify({
  migrations: migrationFiles,
  tables: tables.map((row) => row.name),
  generation_task_columns: taskColumns.length,
  version_columns: versionColumns.length,
  runtime_reliability_columns_verified: true
}, null, 2));
