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
const executable = process.env.DRAMAGO_ACCEPTANCE_EXE;
if (!executable) throw new Error('DRAMAGO_ACCEPTANCE_EXE is required.');

const root = process.cwd();
const output = path.join(root, 'reports', 'windows-portable-final-acceptance');
const dataRoot = path.join(root, '.cache', `portable-crash-recovery-${Date.now()}`);
const statusFile = path.join(output, 'crash-desktop-status.json');
const resultFile = path.join(output, 'crash-recovery-result.json');
await mkdir(output, { recursive: true });

const calls = [];
const passValidation = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['林晚'], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

function responseBody(content, model) {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 80, completion_tokens: 120, total_tokens: 200 }
  });
}

const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const prompt = (payload.messages || []).map((message) => message.content).join('\n');
  const validator = /candidate_internal_consistency|blocking_conflicts|独立语义校验/u.test(prompt);
  const writer = /output_kind|CreativeBrief|target_scope/u.test(prompt) && !validator;
  const call = {
    sequence: calls.length + 1,
    kind: validator ? 'validator' : writer ? 'writer' : 'connection',
    model: String(payload.model || ''),
    crash_unknown: prompt.includes('QA_CRASH_UNKNOWN'),
    received_at: new Date().toISOString(),
    response_finished: false,
    socket_closed_before_response: false
  };
  calls.push(call);
  request.on('aborted', () => { call.socket_closed_before_response = true; });
  response.on('close', () => {
    if (!call.response_finished) call.socket_closed_before_response = true;
  });

  if (call.crash_unknown) await new Promise((resolve) => setTimeout(resolve, 70000));

  let content;
  if (validator) content = passValidation;
  else if (writer) content = {
    output_kind: 'continuation', title: '异常恢复验收',
    content: call.crash_unknown ? '这段响应在客户端进程退出后才返回。' : '第二天，林晚把尚未寄出的信放到窗边。',
    change_summary: '追加测试段落', model_warnings: []
  };
  else content = { ok: true };

  if (!response.destroyed) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(responseBody(content, payload.model || 'acceptance-writer'));
  }
  call.response_finished = true;
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const providerPort = provider.address().port;

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
await new WindowsDpapiProviderSecretStore(paths.providerSecrets).set('deepseek', 'portable-crash-acceptance-secret');

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitReady(cdpPort) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (status.window_ready && response.ok) return status;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Packaged Electron did not become ready.');
}

let desktop = null;
let browser = null;
let page = null;
let cdpPort = null;

async function startDesktop() {
  cdpPort = await freePort();
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
      DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${providerPort}/chat/completions`,
      TASK_STAGE_STALE_MS: '60000'
    }
  });
  await waitReady(cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  page = browser.contexts()[0].pages().find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
  if (!page) throw new Error('Packaged workbench page was not found.');
}

async function bootstrap(workId) {
  return page.evaluate(async (id) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch(`/api/bootstrap?work_id=${encodeURIComponent(id)}`, {
      headers: { 'x-dramago-local-token': token }
    });
    return response.json();
  }, workId);
}

const result = {
  started_at: new Date().toISOString(),
  environment: 'packaged Electron + isolated SQLite + controlled delayed Provider',
  data_root: dataRoot,
  stale_window_ms: 60000,
  work_id: 'portable_crash_work',
  before_kill: {}, after_restart: {}, provider_calls: calls
};

try {
  await startDesktop();
  const origin = new URL(page.url()).origin;
  await page.evaluate(async ({ workId }) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch('/api/versions/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dramago-local-token': token },
      body: JSON.stringify({
        work_id: workId,
        title: '异常恢复验收',
        content: '这是强制退出前必须保留的当前正文。'
      })
    });
    if (!response.ok) throw new Error(`seed failed: ${response.status}`);
  }, { workId: result.work_id });
  await page.goto(`${origin}/?work_id=${result.work_id}`);

  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('先生成一个已保存但不采用的候选。');
  await page.locator('[data-action="generate"]').click();
  await page.getByText('这是候选稿，尚未成为当前正文', { exact: true }).waitFor({ timeout: 30000 });
  const preservedCandidate = (await bootstrap(result.work_id)).latest_task?.result_version_id;
  await page.locator('[data-action="show-editor"]').last().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_CRASH_UNKNOWN 生成中强制退出，禁止自动重复请求。');
  const writerBefore = calls.filter((call) => call.kind === 'writer').length;
  await page.locator('[data-action="generate"]').click();

  const crashDeadline = Date.now() + 15000;
  let activeBootstrap = null;
  while (Date.now() < crashDeadline) {
    activeBootstrap = await bootstrap(result.work_id);
    const crashCalls = calls.filter((call) => call.crash_unknown).length;
    if (crashCalls === 1 && activeBootstrap.latest_task?.stage === 'generating') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (calls.filter((call) => call.crash_unknown).length !== 1 || activeBootstrap?.latest_task?.stage !== 'generating') {
    throw new Error('The delayed writer request did not reach the generating stage.');
  }
  result.before_kill = {
    browser_pid: desktop.pid,
    current_version_id: activeBootstrap.work.current_version_id,
    current_content: activeBootstrap.current_version.content,
    preserved_candidate_version_id: preservedCandidate,
    active_task_id: activeBootstrap.latest_task.id,
    active_task_stage: activeBootstrap.latest_task.stage,
    writer_calls_before_crash_request: writerBefore,
    writer_calls_after_crash_request: calls.filter((call) => call.kind === 'writer').length
  };

  await browser.close().catch(() => {});
  await executeFile('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  desktop = null;
  browser = null;
  page = null;

  await new Promise((resolve) => setTimeout(resolve, 65000));
  await startDesktop();
  await page.goto(`${new URL(page.url()).origin}/?work_id=${result.work_id}`);
  await page.waitForTimeout(1500);
  const recovered = await bootstrap(result.work_id);
  await page.screenshot({ path: path.join(output, '03-crash-recovery.png'), fullPage: true });

  await new Promise((resolve) => setTimeout(resolve, 7000));
  const database = new SQLiteD1(paths.database);
  const preservedRow = await database.prepare('SELECT id, status, content FROM versions WHERE id = ?').bind(preservedCandidate).first();
  const currentRow = await database.prepare('SELECT v.id, v.content FROM versions v JOIN works w ON w.current_version_id = v.id WHERE w.id = ?').bind(result.work_id).first();
  const activeTask = await database.prepare('SELECT * FROM generation_tasks WHERE id = ?').bind(result.before_kill.active_task_id).first();
  database.close();

  result.after_restart = {
    current_version_id: currentRow?.id || null,
    current_content: currentRow?.content || null,
    preserved_candidate_exists: Boolean(preservedRow),
    preserved_candidate_status: preservedRow?.status || null,
    interrupted_task_status: activeTask?.status || null,
    interrupted_task_stage: activeTask?.stage || null,
    interrupted_task_error_code: activeTask?.error_code || null,
    interrupted_task_transport_attempts: Number(activeTask?.transport_attempts || 0),
    writer_calls_total: calls.filter((call) => call.kind === 'writer').length,
    crash_writer_calls: calls.filter((call) => call.crash_unknown).length,
    duplicate_writer_request: calls.filter((call) => call.crash_unknown).length !== 1,
    ui_text: (await page.locator('body').innerText()).slice(0, 2000)
  };
  result.assertions = {
    sqlite_current_preserved: result.after_restart.current_version_id === result.before_kill.current_version_id
      && result.after_restart.current_content === result.before_kill.current_content,
    saved_candidate_preserved: result.after_restart.preserved_candidate_exists,
    task_abandoned_after_stale_window: result.after_restart.interrupted_task_status === 'abandoned'
      && result.after_restart.interrupted_task_error_code === 'STAGE_STALE',
    no_automatic_duplicate_writer_request: !result.after_restart.duplicate_writer_request,
    transport_attempt_recorded_after_process_loss: result.after_restart.interrupted_task_transport_attempts >= 1,
    explicit_cost_uncertainty_message_visible: /费用|计费|可能已产生|远端请求/u.test(result.after_restart.ui_text)
  };
  result.completed_at = new Date().toISOString();
  await writeFile(resultFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ result_file: resultFile, assertions: result.assertions }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (desktop?.pid) await executeFile('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await new Promise((resolve) => provider.close(resolve));
}

