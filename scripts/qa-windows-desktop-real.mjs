import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { WindowsDpapiSecretStore } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const root = process.cwd();
const cache = path.join(root, '.cache');
const reportDirectory = path.join(root, 'reports', 'windows-desktop-packaging-v1');
const executable = path.join(root, 'artifacts', 'windows', 'DramaGo-win32-x64', 'DramaGo.exe');
const dataRoot = path.join(cache, `windows-desktop-real-${Date.now()}`);
const paths = localPaths(dataRoot);
const statusFile = path.join(reportDirectory, 'real-provider-startup-status.json');
const reportFile = path.join(reportDirectory, 'real-provider-qa.json');
const report = {
  started_at: new Date().toISOString(),
  environment: 'packaged Electron + isolated SQLite + real configured DeepSeek provider',
  provider: null,
  connection_test: null,
  operations: [],
  passed: false
};

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function findProtectedConfiguration() {
  const entries = await readdir(cache, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('windows-local-real-'))
    .map((entry) => path.join(cache, entry.name, 'config'))
    .reverse();
  for (const directory of candidates) {
    const key = path.join(directory, 'provider-key.dpapi');
    const config = path.join(directory, 'provider.json');
    try {
      if (await new WindowsDpapiSecretStore(key).has()) return { key, config };
    } catch {}
  }
  return null;
}

async function waitForReady(cdpPort) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (status.window_ready && response.ok) return status;
      if (status.startup_error) throw new Error(status.startup_error);
    } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) && !/fetch failed/u.test(error.message)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Packaged Electron did not become ready within 30 seconds.');
}

async function taskSummary(database, workId) {
  const task = await database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  if (!task) return null;
  const parse = (value) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  return {
    task_id: task.id,
    operation: parse(task.creative_brief_json)?.operation || null,
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
    error_code: task.error_code || task.last_error_code || null
  };
}

async function waitForCandidateOrFailure(page, timeout = 240000) {
  const outcome = await Promise.race([
    page.getByText(/^(检查通过|检查阻断|检查不可用)$/u).first().waitFor({ timeout }).then(() => 'candidate'),
    page.getByText(/(请求失败|生成失败|服务暂时不可用|请求超时)/u).first().waitFor({ timeout }).then(() => 'failure')
  ]);
  return outcome;
}

async function recordOperation(page, database, operation, action) {
  const started = Date.now();
  let workId = null;
  let uiOutcome = 'unknown';
  let adopted = false;
  let error = null;
  try {
    workId = await action();
    uiOutcome = await waitForCandidateOrFailure(page);
    if (uiOutcome === 'candidate') {
      const adopt = page.locator('[data-action="adopt-candidate"]').last();
      if (await adopt.count() && await adopt.isEnabled()) {
        await adopt.click();
        await page.getByText('已采用', { exact: true }).first().waitFor({ timeout: 30000 });
        adopted = true;
      }
    }
  } catch (caught) {
    error = caught.message;
  }
  report.operations.push({
    operation,
    work_id: workId,
    duration_ms: Date.now() - started,
    ui_outcome: uiOutcome,
    adopted,
    error,
    task: workId ? await taskSummary(database, workId) : null
  });
}

await mkdir(reportDirectory, { recursive: true });
await ensureLocalDirectories(paths);
const source = await findProtectedConfiguration();
if (!source) {
  report.error = 'NO_EXISTING_DPAPI_CONFIGURATION';
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: false, error: report.error }, null, 2));
  process.exit(2);
}
await copyFile(source.key, paths.providerSecret);
await copyFile(source.config, paths.providerConfig);
const configured = JSON.parse(await readFile(paths.providerConfig, 'utf8'));
report.provider = {
  endpoint: configured.endpoint,
  writer_model: configured.writer_model,
  validator_model: configured.validator_model,
  planner_model: configured.planner_model,
  protected_key_present: true
};

await rm(statusFile, { force: true });
const cdpPort = await availablePort();
const desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`], {
  cwd: root,
  env: { ...process.env, DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_DESKTOP_QA_STATUS: statusFile },
  windowsHide: false,
  stdio: 'ignore'
});
let browser = null;
let database = null;
try {
  report.startup = await waitForReady(cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
  if (!page) throw new Error('Packaged workbench page unavailable.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  database = new SQLiteD1(paths.database);

  await page.locator('[data-action="open-settings"]').last().click();
  await page.locator('#lengthSetting').selectOption('1200');
  const connectionStarted = Date.now();
  await page.locator('[data-action="test-provider"]').click();
  await page.getByText(/连接成功/u).waitFor({ timeout: 60000 });
  report.connection_test = { success: true, duration_ms: Date.now() - connectionStarted };
  await page.locator('[data-action="save-settings"]').click();

  await recordOperation(page, database, 'CREATE', async () => {
    await page.locator('[data-action="new-work"]').first().click();
    await page.locator('#ideaInput').fill('写一篇完整短剧：一名社区图书管理员发现借阅卡里夹着一张十年前未寄出的道歉信。重点写她如何找到当事人并让两个人自己决定是否见面。第二人称，不要神秘身份，不要突然出现权势人物救场，结尾完整收束。');
    await page.locator('[data-action="generate"]').click();
    await page.waitForURL(/work_id=/u, { timeout: 30000 });
    return new URL(page.url()).searchParams.get('work_id');
  });

  const seeded = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch('/api/versions/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dramago-local-token': token },
      body: JSON.stringify({ work_id: 'desktop_real_ops', title: '桌面真实操作验收', content: '林晚走进空教室。她没有说话。窗外开始下雨。\n\n她把信放在桌上，决定明天再来。' })
    });
    return response.ok;
  });
  if (!seeded) throw new Error('Unable to seed isolated real-operation work.');
  await page.goto(`${new URL(page.url()).origin}/?work_id=desktop_real_ops`);

  await recordOperation(page, database, 'EXPAND', async () => {
    await page.locator('[data-action="show-editor"]').first().click();
    const sourceText = await page.locator('#bodyEditor').inputValue();
    const selected = '她没有说话。';
    const start = sourceText.indexOf(selected);
    await page.locator('#bodyEditor').evaluate((element, range) => {
      element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
    }, { start, end: start + selected.length });
    await page.locator('[data-selection-action="EXPAND"]').click();
    await page.locator('#composerInput').fill('扩写她沉默时观察到的细节和一句克制对白，不改变选区外事实。');
    await page.locator('[data-action="generate"]').click();
    return 'desktop_real_ops';
  });

  await recordOperation(page, database, 'REWRITE', async () => {
    await page.locator('[data-action="show-editor"]').first().click();
    const sourceText = await page.locator('#bodyEditor').inputValue();
    const selected = '她把信放在桌上';
    const start = sourceText.indexOf(selected);
    await page.locator('#bodyEditor').evaluate((element, range) => {
      element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
    }, { start, end: start + selected.length });
    await page.locator('[data-selection-action="REWRITE"]').click();
    await page.locator('#composerInput').fill('把这个动作改写得更犹豫，但保持信仍然被放在桌上。');
    await page.locator('[data-action="generate"]').click();
    return 'desktop_real_ops';
  });

  await recordOperation(page, database, 'CONTINUE', async () => {
    await page.locator('[data-action="show-editor"]').first().click();
    await page.locator('[data-operation="CONTINUE"]').click();
    await page.locator('#composerInput').fill('从第二天继续，写林晚重新回到教室并作出阶段性决定。不要复述前文。');
    await page.locator('[data-action="generate"]').click();
    return 'desktop_real_ops';
  });

  report.passed = report.connection_test.success
    && report.operations.length === 4
    && report.operations.every((item) => item.task?.candidate_version_id && !item.error);
} catch (error) {
  report.error = error.message;
} finally {
  report.completed_at = new Date().toISOString();
  database?.close();
  await pageSafeClose(browser);
  if (desktop.exitCode == null) {
    await Promise.race([
      new Promise((resolve) => desktop.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 6000))
    ]);
    if (desktop.exitCode == null) desktop.kill();
  }
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

async function pageSafeClose(connectedBrowser) {
  if (!connectedBrowser) return;
  const pages = connectedBrowser.contexts().flatMap((context) => context.pages());
  await Promise.all(pages.map((page) => page.close().catch(() => {})));
  await connectedBrowser.close().catch(() => {});
}

console.log(JSON.stringify({ passed: report.passed, operations: report.operations.map((item) => ({ operation: item.operation, status: item.task?.status, validation_status: item.task?.validation_status, adopted: item.adopted, error: item.error })), error: report.error || null }, null, 2));
process.exitCode = report.passed ? 0 : 1;
