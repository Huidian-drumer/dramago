import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localPaths } from '../local/paths.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const root = process.cwd();
const reportDirectory = path.join(root, 'reports', 'windows-portable-p1-reliability');
const run = JSON.parse(await readFile(path.join(reportDirectory, 'P1_RELIABILITY_EVIDENCE.json'), 'utf8'));
const db = new SQLiteD1(localPaths(run.data_root).database);
const works = (await db.prepare('SELECT id, title, current_version_id FROM works ORDER BY id').all()).results;
const versions = (await db.prepare(`SELECT id, work_id, parent_version_id, operation, status, content, content_hash,
  validator_version, validation_status, can_auto_apply FROM versions ORDER BY work_id, created_at`).all()).results
  .map(({ content, ...row }) => ({ ...row,
    content_sha256: createHash('sha256').update(content).digest('hex'), content_chars: content.length }));
const tasks = (await db.prepare(`SELECT id, work_id, status, stage, failed_stage, outcome_unknown, unknown_stage,
  retry_confirmation_required, retry_of_task_id, result_version_id, transport_attempts, validator_attempts
  FROM generation_tasks ORDER BY created_at`).all()).results;
const attempts = (await db.prepare(`SELECT task_id, stage, attempt_number, status, model_name, prepared_at, sent_at,
  finished_at, http_status, error_code FROM provider_transport_attempts ORDER BY task_id, attempt_number`).all()).results;
const restores = (await db.prepare(`SELECT work_id, source_version_id, previous_current_version_id,
  new_current_version_id, result, created_at FROM version_restore_events ORDER BY created_at`).all()).results;
db.close();

const evidence = {
  generated_at: new Date().toISOString(),
  source_run: 'P1_RELIABILITY_EVIDENCE.json',
  content_policy: 'No story plaintext and no provider credentials; content is represented by SHA-256 and character count.',
  works,
  versions,
  generation_tasks: tasks,
  provider_transport_attempts: attempts,
  version_restore_events: restores
};
await writeFile(path.join(reportDirectory, 'DATABASE_STATE_EVIDENCE.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ works: works.length, versions: versions.length, tasks: tasks.length,
  attempts: attempts.length, restore_events: restores.length }, null, 2));
