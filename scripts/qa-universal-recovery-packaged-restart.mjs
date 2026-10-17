import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

const root = process.cwd();
const reportDir = path.join(root, 'reports', 'windows-v1-4-universal-recovery-final');
const prior = JSON.parse(await readFile(path.join(reportDir, 'ELECTRON_ACCEPTANCE.json'), 'utf8'));
if (!prior.archive || !prior.executable.includes(`${path.sep}extracted${path.sep}`)) {
  throw new Error('Packaged EXE evidence is required for restart QA.');
}
const executable = prior.executable;
const dataRoot = prior.data_root;
const databasePath = path.join(dataRoot, 'data', 'dramago.sqlite');
const checks = [];
const screenshots = [];
const check = (name, condition, details = null) => {
  checks.push({ name, passed: Boolean(condition), details });
  if (!condition) throw new Error(`${name}: ${JSON.stringify(details)}`);
};
await mkdir(reportDir, { recursive: true });

async function launch(stage) {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const statusFile = path.join(prior.run_root, `restart-${stage}-status.json`);
  const userData = path.join(prior.run_root, `restart-${stage}-electron`);
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    cwd: path.dirname(executable), windowsHide: true, stdio: 'ignore', env: { ...process.env,
      DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: userData,
      DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_INTERNAL_QA: '1' }
  });
  let ready = false;
  for (let attempts = 0; attempts < 300 && !ready; attempts += 1) {
    try {
      const state = JSON.parse(await readFile(statusFile, 'utf8'));
      ready = state.window_ready && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  check(`${stage}_packaged_exe_ready`, ready);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  check(`${stage}_workbench_loaded`, Boolean(page));
  return { child, browser, page, origin: new URL(page.url()).origin };
}

async function stop(session) {
  await session.browser.close().catch(() => {});
  if (session.child.pid) await promisify(execFile)('taskkill.exe', ['/PID', String(session.child.pid), '/T', '/F'], {
    windowsHide: true
  }).catch(() => {});
}

const db = new DatabaseSync(databasePath);
const previousRuns = db.prepare('SELECT COUNT(*) AS count FROM candidate_validation_runs').get().count;
const previousAttempts = db.prepare('SELECT COUNT(*) AS count FROM provider_transport_attempts').get().count;
db.close();
let createdWorkId;
let session = await launch('before');
try {
  await session.page.locator('[data-action="new-work"]').first().click();
  await session.page.locator('#newWorkName').fill('隔离重启恢复验收');
  await session.page.locator('[data-action="confirm-new-work"]').click();
  await session.page.locator('#bodyEditor').fill('这是尚未提交的隔离草稿。');
  await session.page.waitForTimeout(2500);
  const beforeDb = new DatabaseSync(databasePath);
  const work = beforeDb.prepare("SELECT id, current_version_id FROM works WHERE title = '隔离重启恢复验收' ORDER BY created_at DESC LIMIT 1").get();
  createdWorkId = work?.id;
  const draft = beforeDb.prepare('SELECT body FROM work_edit_drafts WHERE work_id = ?').get(createdWorkId);
  check('blank_work_without_version_persisted', Boolean(createdWorkId) && work.current_version_id === null);
  check('uncommitted_draft_persisted_in_sqlite', draft?.body === '这是尚未提交的隔离草稿。');
  beforeDb.close();
  const file = path.join(reportDir, '10-before-restart-draft.png');
  await session.page.screenshot({ path: file });
  screenshots.push(file);
} finally { await stop(session); }

session = await launch('after');
try {
  await session.page.goto(`${session.origin}/?work_id=${createdWorkId}`);
  await session.page.locator('#bodyEditor').waitFor();
  check('blank_work_and_draft_restored_after_relaunch',
    await session.page.locator('#bodyEditor').inputValue() === '这是尚未提交的隔离草稿。');
  const file = path.join(reportDir, '11-after-restart-draft.png');
  await session.page.screenshot({ path: file });
  screenshots.push(file);
  await session.page.goto(`${session.origin}/?work_id=qa_provider_error_work`);
  await session.page.locator('[data-action="open-history"]').first().click();
  await session.page.locator('[data-version-id="qa_providerError_candidate"]').click();
  await session.page.locator('[data-action="open-checks"]').first().click();
  check('candidate_check_history_restored_after_relaunch',
    await session.page.locator('.validation-history-item').count() >= 5);
  const historyFile = path.join(reportDir, '12-after-restart-validation-history.png');
  await session.page.screenshot({ path: historyFile });
  screenshots.push(historyFile);
} finally { await stop(session); }

const afterDb = new DatabaseSync(databasePath);
const afterRuns = afterDb.prepare('SELECT COUNT(*) AS count FROM candidate_validation_runs').get().count;
const afterAttempts = afterDb.prepare('SELECT COUNT(*) AS count FROM provider_transport_attempts').get().count;
afterDb.close();
check('restart_caused_no_provider_call_or_history_loss', afterRuns === previousRuns && afterAttempts === previousAttempts,
  { previousRuns, afterRuns, previousAttempts, afterAttempts });
const evidence = { completed_at: new Date().toISOString(), executable, data_root: dataRoot,
  checks, screenshots, provider_calls_on_restart: afterAttempts - previousAttempts };
await writeFile(path.join(reportDir, 'RESTART_ACCEPTANCE.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ checks: checks.length, passed: checks.filter((item) => item.passed).length,
  screenshots: screenshots.length, provider_calls_on_restart: 0 }));
