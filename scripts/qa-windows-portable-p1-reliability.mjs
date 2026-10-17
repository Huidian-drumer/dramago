import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import {
  defaultProviderConfiguration,
  WindowsDpapiProviderSecretStore,
  writeProviderConfiguration
} from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const executeFile = promisify(execFile);
const root = process.cwd();
const executable = process.env.DRAMAGO_ACCEPTANCE_EXE
  || path.join(root, 'artifacts', 'windows', 'DramaGo-win32-x64', 'DramaGo.exe');
const output = path.join(root, 'reports', 'windows-portable-p1-reliability');
const dataRoot = path.join(root, '.cache', `portable-p1-${Date.now()}`);
const statusFile = path.join(output, 'desktop-status.json');
const resultFile = path.join(output, 'P1_RELIABILITY_EVIDENCE.json');
await mkdir(output, { recursive: true });

const calls = [];
let writerCrashConsumed = false;
let validatorCrashConsumed = false;
const passValidation = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['林晚'], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

function openAi(content, model) {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 } });
}

function waitForKillOrTimeout(response) {
  return Promise.race([
    new Promise((resolve) => setTimeout(resolve, 120000)),
    new Promise((resolve) => response.once('close', resolve))
  ]);
}

const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const prompt = (payload.messages || []).map((message) => message.content).join('\n');
  const validatorCall = /candidate_internal_consistency|blocking_conflicts|独立语义校验/u.test(prompt);
  const writerCall = /output_kind|CreativeBrief|target_scope/u.test(prompt) && !validatorCall;
  const call = { sequence: calls.length + 1, kind: validatorCall ? 'validator' : writerCall ? 'writer' : 'connection',
    model: String(payload.model || ''), received_at: new Date().toISOString(), response_finished: false };
  calls.push(call);
  response.on('close', () => { if (!call.response_finished) call.connection_closed_before_response = true; });

  if (writerCall && prompt.includes('QA_CRASH_WRITER') && !writerCrashConsumed) {
    writerCrashConsumed = true;
    call.injected_fault = 'writer_in_flight_process_kill';
    await waitForKillOrTimeout(response);
  }
  if (validatorCall && prompt.includes('QA_VALIDATOR_CRASH_MARKER') && !validatorCrashConsumed) {
    validatorCrashConsumed = true;
    call.injected_fault = 'validator_in_flight_process_kill';
    await waitForKillOrTimeout(response);
  }

  let content;
  if (validatorCall) content = passValidation;
  else if (writerCall) {
    const marker = prompt.includes('QA_VALIDATOR_CRASH') ? ' QA_VALIDATOR_CRASH_MARKER' : '';
    content = { output_kind: 'continuation', title: 'P1 崩溃恢复验收',
      content: `第二天，林晚打开窗，确认当前正文没有被覆盖。${marker}`,
      change_summary: '受控续写', model_warnings: [] };
  } else content = { ok: true };
  if (!response.destroyed) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(openAi(content, payload.model || 'qa-model'));
  }
  call.response_finished = true;
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));

const paths = localPaths(dataRoot);
await ensureLocalDirectories(paths);
await writeProviderConfiguration(paths.providerConfig, {
  ...defaultProviderConfiguration,
  provider_timeout_ms: 180000,
  providers: {
    ...defaultProviderConfiguration.providers,
    deepseek: { ...defaultProviderConfiguration.providers.deepseek, disclosure_confirmed_at: new Date().toISOString() }
  }
});
await new WindowsDpapiProviderSecretStore(paths.providerSecrets).set('deepseek', 'p1-controlled-secret');

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let desktop;
let browser;
let page;

async function startDesktop(workId = null) {
  const cdpPort = await freePort();
  const electronUserData = path.join(dataRoot, 'electron-user-data');
  await mkdir(electronUserData, { recursive: true });
  await rm(statusFile, { force: true });
  desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
    cwd: path.dirname(executable), windowsHide: false, stdio: 'ignore',
    env: {
      ...process.env,
      DRAMAGO_DATA_DIR: dataRoot,
      DRAMAGO_ELECTRON_USER_DATA: electronUserData,
      DRAMAGO_DESKTOP_QA_STATUS: statusFile,
      DRAMAGO_INTERNAL_QA: '1',
      DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`
    }
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (status.window_ready && response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  if (!page) throw new Error('Packaged workbench page was not found.');
  if (workId) {
    await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(workId)}`, { waitUntil: 'networkidle' });
    if (new URL(page.url()).searchParams.get('work_id') !== workId) throw new Error(`Packaged work navigation failed for ${workId}.`);
  }
}

async function killDesktop() {
  await browser?.close().catch(() => {});
  browser = null;
  page = null;
  if (desktop?.pid) await executeFile('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  desktop = null;
}

async function request(pathname, body, method = 'POST') {
  return page.evaluate(async ({ pathname, body, method }) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch(pathname, { method,
      headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), 'x-dramago-local-token': token },
      ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
    return { status: response.status, payload: await response.json() };
  }, { pathname, body, method });
}

async function bootstrap(workId) {
  return (await request(`/api/bootstrap?work_id=${encodeURIComponent(workId)}`, null, 'GET')).payload;
}

async function database() {
  return new SQLiteD1(paths.database);
}

async function waitForProvider(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = calls.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Controlled Provider did not receive the expected request.');
}

const evidence = {
  started_at: new Date().toISOString(),
  executable,
  data_root: dataRoot,
  environment: 'packaged Electron + isolated SQLite + controlled Provider',
  checks: {}, screenshots: [], provider_calls: calls
};
function check(id, passed, details = null) {
  evidence.checks[id] = { passed: Boolean(passed), details };
  if (!passed) throw new Error(`${id}: ${JSON.stringify(details)}`);
}
async function screenshot(name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file, fullPage: true });
  evidence.screenshots.push(file);
}

try {
  await startDesktop();

  // P1-2: read-only historical view, explicit restore, CAS, rapid duplicate and DB rollback.
  const v1 = await request('/api/versions/save', { work_id: 'history_work', title: '历史恢复验收', content: '第一版正文。' });
  const v2 = await request('/api/versions/save', { work_id: 'history_work', source_version_id: v1.payload.version.id,
    title: '历史恢复验收', content: '第二版当前正文。' });
  await page.goto(`${new URL(page.url()).origin}/?work_id=history_work`);
  await page.locator('[data-action="open-history"]').first().click();
  await page.locator(`[data-version-id="${v1.payload.version.id}"]`).click();
  await page.getByText('正在查看历史记录，当前正文未改变', { exact: true }).waitFor();
  let db = await database();
  check('history_view_does_not_change_current',
    (await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('history_work').first()).current_version_id === v2.payload.version.id);
  db.close();
  await screenshot('01-history-read-only.png');
  await page.locator('[data-action="request-history-restore"]').click();
  await page.getByRole('heading', { name: '确认恢复历史版本' }).waitFor();
  await screenshot('02-history-restore-confirm.png');
  await page.locator('[data-action="confirm-history-restore"]').click();
  await page.getByText('服务端已创建新的恢复版本，原历史版本保持不变', { exact: true }).waitFor();
  db = await database();
  const restoredWork = await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('history_work').first();
  const restored = await db.prepare('SELECT * FROM versions WHERE id = ?').bind(restoredWork.current_version_id).first();
  check('history_restore_creates_new_version', restored.operation === 'RESTORE' && restored.id !== v1.payload.version.id);
  check('history_restore_uses_current_as_parent', restored.parent_version_id === v2.payload.version.id);
  check('history_restore_copies_selected_content', restored.content === v1.payload.version.content);
  check('history_restore_does_not_reuse_validator', restored.validator_version == null && restored.validation_status === 'pending');
  check('historical_versions_remain_unchanged',
    (await db.prepare('SELECT content FROM versions WHERE id = ?').bind(v1.payload.version.id).first()).content === '第一版正文。'
    && (await db.prepare('SELECT content FROM versions WHERE id = ?').bind(v2.payload.version.id).first()).content === '第二版当前正文。');
  db.close();
  await screenshot('03-history-restore-success.png');

  const beforeRapid = (await bootstrap('history_work')).work.current_version_id;
  const rapid = await page.evaluate(async ({ source, expected }) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const send = () => fetch('/api/versions/restore', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dramago-local-token': token },
      body: JSON.stringify({ work_id: 'history_work', source_version_id: source, expected_current_version_id: expected }) });
    const responses = await Promise.all([send(), send()]);
    return responses.map((response) => response.status).sort();
  }, { source: v2.payload.version.id, expected: beforeRapid });
  check('rapid_duplicate_restore_only_one_succeeds', rapid[0] === 201 && rapid[1] === 409, rapid);

  await page.reload();
  await page.locator('[data-action="open-history"]').first().click();
  await page.locator(`[data-version-id="${v1.payload.version.id}"]`).click();
  await page.locator('[data-action="request-history-restore"]').click();
  const expectedForRace = (await bootstrap('history_work')).work.current_version_id;
  const newer = await request('/api/versions/save', { work_id: 'history_work', source_version_id: expectedForRace,
    title: '并发新版本', content: '确认期间保存的更新正文。' });
  await page.locator('[data-action="confirm-history-restore"]').click();
  await page.getByText('当前版本已变化，历史恢复已取消。请刷新后重新确认。', { exact: true }).waitFor();
  check('history_restore_cas_conflict_keeps_newer_version', (await bootstrap('history_work')).work.current_version_id === newer.payload.version.id);

  await page.locator('[data-action="open-history"]').first().click();
  await page.locator(`[data-version-id="${v1.payload.version.id}"]`).click();
  await page.locator('[data-action="request-history-restore"]').click();
  db = await database();
  db.exec("CREATE TRIGGER qa_fail_restore BEFORE INSERT ON version_restore_events BEGIN SELECT RAISE(ABORT, 'qa restore failure'); END;");
  const beforeFailure = (await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('history_work').first()).current_version_id;
  const versionsBeforeFailure = (await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('history_work').first()).count;
  db.close();
  await page.locator('[data-action="confirm-history-restore"]').click();
  await page.getByText('服务暂时不可用，已输入内容不会被清除。', { exact: true }).waitFor();
  db = await database();
  check('restore_db_failure_has_no_fake_success',
    (await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('history_work').first()).current_version_id === beforeFailure
    && (await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('history_work').first()).count === versionsBeforeFailure);
  db.exec('DROP TRIGGER qa_fail_restore');
  db.close();

  // P1-1 before-send boundary: prepared state never claims remote execution.
  const prepared = await request('/api/generate', { work_id: 'prepared_crash_work', context: '',
    brief: { operation: 'CREATE', user_instruction: '预发送边界。', output_preferences: { target_length: 300 } } });
  db = await database();
  const preparedAt = prepared.payload.task.created_at;
  await db.prepare(`UPDATE generation_tasks SET status = ?, stage = ?, stage_started_at = ?, updated_at = ?,
    execution_instance_id = ?, transport_attempts = 1, attempt_count = 1 WHERE id = ?`)
    .bind('generating', 'generating', preparedAt, preparedAt, 'killed-runtime', prepared.payload.task.id).run();
  await db.prepare(`INSERT INTO provider_transport_attempts
    (id, task_id, stage, attempt_number, status, provider, model_name, execution_instance_id, prepared_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('prepared_boundary', prepared.payload.task.id, 'write', 1, 'prepared', 'deepseek', 'deepseek-v4-pro', 'killed-runtime', preparedAt).run();
  db.close();
  await killDesktop();
  await startDesktop('prepared_crash_work');
  const preparedRecovered = await request(`/api/tasks/${prepared.payload.task.id}`, null, 'GET');
  check('pre_send_kill_marks_cancelled_before_send', preparedRecovered.payload.transport_attempt_records[0].status === 'cancelled_before_send');
  check('pre_send_kill_not_marked_remote_success_or_unknown', preparedRecovered.payload.task.outcome_unknown === false);

  // Writer reached Provider, then the complete Electron process tree is killed and restarted before 3 minutes.
  await request('/api/versions/save', { work_id: 'writer_crash_work', title: 'Writer 崩溃验收', content: '必须保留的当前正文。' });
  await page.goto(`${new URL(page.url()).origin}/?work_id=writer_crash_work`);
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_CRASH_WRITER 请求送达后强制结束整个程序。');
  const writerCallsBefore = calls.filter((call) => call.kind === 'writer').length;
  await page.locator('[data-action="generate"]').click();
  await waitForProvider((call) => call.injected_fault === 'writer_in_flight_process_kill');
  const writerActive = await bootstrap('writer_crash_work');
  const writerTaskId = writerActive.latest_task.id;
  await killDesktop();
  await startDesktop('writer_crash_work');
  await page.getByText(/上次 AI 请求可能已经发送并产生费用/u).first().waitFor();
  await screenshot('04-writer-outcome-unknown.png');
  const writerRecovered = await request(`/api/tasks/${writerTaskId}`, null, 'GET');
  check('writer_in_flight_restart_before_three_minutes_is_unknown', writerRecovered.payload.task.outcome_unknown === true);
  check('writer_unknown_requires_confirmation', writerRecovered.payload.task.retry_confirmation_required === true);
  await page.waitForTimeout(1500);
  check('writer_unknown_not_automatically_retried', calls.filter((call) => call.kind === 'writer').length === writerCallsBefore + 1);
  await page.locator('[data-action="request-generation-retry"]').click();
  await page.locator('[data-action="confirm-generation-retry"]').click();
  await page.getByText('这是候选稿，尚未成为当前正文', { exact: true }).waitFor({ timeout: 30000 });
  const writerAfterRetry = await bootstrap('writer_crash_work');
  check('confirmed_writer_retry_creates_new_task', writerAfterRetry.latest_task.id !== writerTaskId
    && writerAfterRetry.latest_task.retry_of_task_id === writerTaskId);

  // Candidate is durably saved, Validator request reaches Provider, then process is killed.
  await request('/api/versions/save', { work_id: 'validator_crash_work', title: 'Validator 崩溃验收', content: 'Validator 前的当前正文。' });
  await page.goto(`${new URL(page.url()).origin}/?work_id=validator_crash_work`);
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_VALIDATOR_CRASH Writer 成功后在 Validator 进行中强杀。');
  await page.locator('[data-action="generate"]').click();
  await waitForProvider((call) => call.injected_fault === 'validator_in_flight_process_kill');
  const validatorActive = await bootstrap('validator_crash_work');
  const validatorTaskId = validatorActive.latest_task.id;
  const candidateId = validatorActive.latest_task.result_version_id;
  db = await database();
  const versionsBeforeValidatorKill = (await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('validator_crash_work').first()).count;
  db.close();
  await killDesktop();
  await startDesktop('validator_crash_work');
  await page.waitForTimeout(1000);
  await page.getByText(/上次 AI 请求可能已经发送并产生费用/u).first().waitFor();
  await screenshot('05-validator-outcome-unknown-candidate-preserved.png');
  const validatorCallsBeforeConfirmation = calls.filter((call) => call.kind === 'validator').length;
  await page.waitForTimeout(1500);
  check('validator_unknown_not_automatically_retried', calls.filter((call) => call.kind === 'validator').length === validatorCallsBeforeConfirmation);
  await page.locator('[data-action="retry-validation"]').click();
  await page.locator('[data-action="confirm-validator-retry"]').click();
  await page.getByText('这是候选稿，尚未成为当前正文', { exact: true }).waitFor({ timeout: 30000 });
  const validatorRecovered = await bootstrap('validator_crash_work');
  db = await database();
  const versionCountAfterValidatorRetry = (await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('validator_crash_work').first()).count;
  const transportCount = await db.prepare('SELECT transport_attempts, validator_attempts FROM generation_tasks WHERE id = ?').bind(validatorTaskId).first();
  const attemptCount = (await db.prepare('SELECT COUNT(*) AS count FROM provider_transport_attempts WHERE task_id = ?').bind(validatorTaskId).first()).count;
  db.close();
  check('validator_retry_reuses_same_candidate', validatorRecovered.latest_task.result_version_id === candidateId
    && versionCountAfterValidatorRetry === versionsBeforeValidatorKill);
  check('transport_attempts_match_persisted_records', transportCount.transport_attempts === attemptCount,
    { transport_attempts: transportCount.transport_attempts, records: attemptCount, validator_attempts: transportCount.validator_attempts });

  // Same-runtime record older than the normal three-minute window is reconciled by time, not by restart identity.
  const old = await request('/api/generate', { work_id: 'stale_window_work', context: '',
    brief: { operation: 'CREATE', user_instruction: '三分钟窗口验收。', output_preferences: { target_length: 300 } } });
  const oldTimestamp = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  db = await database();
  await db.prepare(`UPDATE generation_tasks SET status = ?, stage = ?, stage_started_at = ?, updated_at = ?,
    execution_instance_id = NULL, transport_attempts = 1, attempt_count = 1 WHERE id = ?`)
    .bind('generating', 'generating', oldTimestamp, oldTimestamp, old.payload.task.id).run();
  await db.prepare(`INSERT INTO provider_transport_attempts
    (id, task_id, stage, attempt_number, status, provider, model_name, prepared_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('old_window_attempt', old.payload.task.id, 'write', 1, 'in_flight', 'deepseek', 'deepseek-v4-pro', oldTimestamp, oldTimestamp).run();
  db.close();
  const staleRecovered = await request(`/api/tasks/${old.payload.task.id}`, null, 'GET');
  check('after_three_minute_window_in_flight_is_unknown', staleRecovered.payload.task.outcome_unknown === true
    && staleRecovered.payload.transport_attempt_records[0].status === 'outcome_unknown');

  // Reopen packaged EXE: successful history restore remains current.
  const finalHistoryCurrent = (await bootstrap('history_work')).work.current_version_id;
  await killDesktop();
  await startDesktop('history_work');
  check('history_restore_persists_after_close_and_reopen', (await bootstrap('history_work')).work.current_version_id === finalHistoryCurrent);

  evidence.completed_at = new Date().toISOString();
  evidence.passed = Object.values(evidence.checks).every((item) => item.passed);
  await writeFile(resultFile, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ result_file: resultFile, passed: evidence.passed,
    checks: Object.keys(evidence.checks).length, screenshots: evidence.screenshots.length }, null, 2));
} finally {
  await killDesktop();
  await new Promise((resolve) => provider.close(resolve));
}
