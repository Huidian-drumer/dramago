import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const root = process.cwd();
const cache = path.join(root, '.cache');
const reportFile = path.join(root, 'reports', 'windows-desktop-packaging-v1', 'real-provider-qa.json');
const entries = await readdir(cache, { withFileTypes: true });
const dataDirectory = entries
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('windows-desktop-real-'))
  .map((entry) => entry.name)
  .sort()
  .at(-1);
if (!dataDirectory) throw new Error('No isolated real desktop QA database found.');

const report = JSON.parse(await readFile(reportFile, 'utf8'));
const database = new SQLiteD1(path.join(cache, dataDirectory, 'data', 'dramago.sqlite'));
const tasks = (await database.prepare('SELECT * FROM generation_tasks ORDER BY created_at').all()).results;
const adoptions = new Set((await database.prepare("SELECT candidate_version_id FROM adoption_events WHERE result = 'adopted'").all()).results.map((row) => row.candidate_version_id));
const parse = (value) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };

for (let index = 0; index < report.operations.length; index += 1) {
  const task = tasks[index];
  if (!task) continue;
  const candidate = task.result_version_id
    ? await database.prepare('SELECT checks_json FROM versions WHERE id = ?').bind(task.result_version_id).first()
    : null;
  const findings = (parse(candidate?.checks_json) || [])
    .filter((finding) => finding.status === 'fail' || finding.severity === 'blocking')
    .map((finding) => ({
      finding_type: finding.finding_type,
      severity: finding.severity,
      confidence: finding.confidence,
      evidence: finding.evidence,
      reason: finding.reason
    }));
  report.operations[index].adopted = adoptions.has(task.result_version_id);
  report.operations[index].task = {
    task_id: task.id,
    status: task.status,
    stage: task.stage,
    candidate_version_id: task.result_version_id,
    output_kind: task.output_kind,
    validation_status: task.validation_status,
    source_is_current: task.source_is_current === 1,
    writer_model: task.model_name,
    planner_model: task.plan_model_name,
    validator_model: task.validator_model_name,
    transport_attempts: task.transport_attempts,
    format_repair_attempts: task.format_repair_attempts,
    validator_attempts: task.validator_attempts,
    writer_usage: parse(task.usage_json),
    planner_usage: parse(task.plan_usage_json),
    validator_usage: parse(task.validator_usage_json),
    stage_timings: parse(task.stage_timings_json),
    error_code: task.error_code || task.last_error_code || null,
    blocking_findings: findings
  };
}

database.close();
if (report.startup) report.startup.data_root = 'isolated_test_data';
report.engineering_chain_passed = report.operations.length === 4
  && report.operations.every((item) => item.task?.status === 'completed' && item.task?.candidate_version_id && !item.error);
report.all_candidates_adopted = report.operations.every((item) => item.adopted);
report.safety_behavior = report.operations
  .filter((item) => item.task?.validation_status === 'blocked')
  .every((item) => item.adopted === false);
report.passed = report.engineering_chain_passed && report.safety_behavior;
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, engineering_chain_passed: report.engineering_chain_passed, all_candidates_adopted: report.all_candidates_adopted, safety_behavior: report.safety_behavior }, null, 2));
