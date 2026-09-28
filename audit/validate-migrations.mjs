import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(':memory:');
for (const file of ['drizzle/0000_low_the_fallen.sql', 'drizzle/0001_kind_the_spike.sql']) {
  const sql = (await readFile(file, 'utf8')).replaceAll('--> statement-breakpoint', '');
  database.exec(sql);
}

const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
const taskColumns = database.prepare('PRAGMA table_info(generation_tasks)').all();
console.log(JSON.stringify({ tables: tables.map((row) => row.name), generation_task_columns: taskColumns.length }, null, 2));
