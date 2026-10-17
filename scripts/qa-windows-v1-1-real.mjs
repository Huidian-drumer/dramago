import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { WindowsDpapiProviderSecretStore, WindowsDpapiSecretStore } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const root = process.cwd();
const executable = path.join(root, 'artifacts', 'windows', 'DramaGo-win32-x64', 'DramaGo.exe');
const output = path.join(root, 'reports', 'windows-v1-1-multi-provider-task-control');
const dataRoot = path.join(root, '.cache', `windows-v1-1-real-${Date.now()}`);
const electronUserData = path.join(dataRoot, 'electron-user-data');
const paths = localPaths(dataRoot);
const sourcePaths = localPaths();
const statusFile = path.join(output, 'real-provider-startup.json');
const reportFile = path.join(output, 'REAL_PROVIDER_MINIMAL_E2E.json');
const report = {
  started_at: new Date().toISOString(),
  environment: 'packaged Electron + isolated SQLite + existing user-authorized provider credentials',
  credentials: { zhipu: 'not_found', deepseek: 'not_found' },
  connection_tests: {},
  operations: [],
  chain_complete: false
};

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitReady(port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (status.window_ready && response.ok) return status;
      if (status.startup_error) throw new Error(status.startup_error);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Packaged Electron did not become ready.');
}

async function safeProviderInventory() {
  const providerStore = new WindowsDpapiProviderSecretStore(sourcePaths.providerSecrets);
  const legacyStore = new WindowsDpapiSecretStore(sourcePaths.providerSecret);
  let legacyProvider = null;
  try {
    const config = JSON.parse(await readFile(sourcePaths.providerConfig, 'utf8'));
    if (config.schema_version === 2) legacyProvider = null;
    else if (String(config.endpoint || '').startsWith('https://open.bigmodel.cn/')) legacyProvider = 'zhipu';
    else if (String(config.endpoint || '').startsWith('https://api.deepseek.com/')) legacyProvider = 'deepseek';
  } catch {}
  for (const providerId of ['zhipu', 'deepseek']) {
    if (await providerStore.has(providerId).catch(() => false)) report.credentials[providerId] = 'provider_specific_dpapi';
  }
  if (legacyProvider && await legacyStore.has().catch(() => false) && report.credentials[legacyProvider] === 'not_found') {
    report.credentials[legacyProvider] = 'identified_legacy_dpapi';
  }
}

async function copyProtectedConfiguration() {
  await ensureLocalDirectories(paths);
  await copyFile(sourcePaths.providerConfig, paths.providerConfig);
  if (await new WindowsDpapiSecretStore(sourcePaths.providerSecret).has().catch(() => false)) {
    await copyFile(sourcePaths.providerSecret, paths.providerSecret);
  }
  await cp(sourcePaths.providerSecrets, paths.providerSecrets, { recursive: true, force: false }).catch(() => {});
}

async function waitProviderResult(page) {
  await page.waitForFunction(() => {
    const text = document.querySelector('#providerTestResult')?.textContent || '';
    return /连接成功|认证失败|额度不足|无权使用|请求过于频繁|无法连接|超时|不兼容/u.test(text);
  }, { timeout: 60000 });
  return page.locator('#providerTestResult').innerText();
}

async function configureAndTest(page, providerId) {
  await page.locator('[data-action="open-settings"]').last().click();
  await page.locator('#providerPlatformSetting').selectOption(providerId);
  if (await page.locator('#providerDisclosureSetting').isVisible()) await page.locator('#providerDisclosureSetting').check();
  await page.locator('[data-action="save-provider-settings"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-action="test-provider"]').click();
  const message = await waitProviderResult(page);
  const success = /连接成功/u.test(message);
  report.connection_tests[providerId] = { success, message: message.replace(/\s+/gu, ' ').trim() };
  await page.locator('[data-action="close-overlay"]').click();
  return success;
}

async function waitCandidate(page) {
  await Promise.race([
    page.getByText(/^(检查通过|检查阻断|检查不可用)$/u).first().waitFor({ timeout: 240000 }),
    page.getByText(/(文本模型请求失败|请求超时|操作未完成)/u).first().waitFor({ timeout: 240000 })
  ]);
}

async function currentTask(page, workId) {
  return page.evaluate(async (id) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch(`/api/bootstrap?work_id=${encodeURIComponent(id)}`, {
      headers: { 'x-dramago-local-token': token }
    });
    const payload = await response.json();
    return { task: payload.latest_task, current_version: payload.current_version };
  }, workId);
}

async function adoptIfAllowed(page) {
  const button = page.locator('[data-action="adopt-candidate"]').last();
  if (!await button.count() || !await button.isEnabled()) return false;
  await button.click();
  await page.getByText('已采用', { exact: true }).first().waitFor({ timeout: 30000 });
  return true;
}

async function captureOperation(page, operation, workId, action) {
  const started = Date.now();
  let error = null;
  let adopted = false;
  try {
    await action();
    await waitCandidate(page);
    adopted = await adoptIfAllowed(page);
  } catch (caught) {
    error = caught.message;
  }
  const snapshot = workId ? await currentTask(page, workId).catch(() => null) : null;
  report.operations.push({
    operation,
    work_id: workId,
    duration_ms: Date.now() - started,
    adopted,
    error,
    task: snapshot?.task ? {
      id: snapshot.task.id,
      status: snapshot.task.status,
      writer_provider_id: snapshot.task.writer_provider_id,
      writer_model_id: snapshot.task.writer_model_id,
      validator_provider_id: snapshot.task.validator_provider_id,
      validator_model_id: snapshot.task.validator_model_id,
      source_version_id: snapshot.task.source_version_id,
      source_hash: snapshot.task.source_hash,
      result_version_id: snapshot.task.result_version_id,
      validation_status: snapshot.task.validation_status,
      source_is_current: snapshot.task.source_is_current,
      transport_attempts: snapshot.task.transport_attempts,
      error_code: snapshot.task.error_code || snapshot.task.last_error_code || null
    } : null,
    current_version_id: snapshot?.current_version?.id || null
  });
  return adopted;
}

await mkdir(output, { recursive: true });
await safeProviderInventory();
if (report.credentials.zhipu === 'not_found') {
  report.operations.push({ operation: 'GLM_CREATE', status: 'BLOCKED', reason: 'NO_AUTHORIZED_ZHIPU_KEY' });
  report.operations.push({ operation: 'DEEPSEEK_REWRITE', status: 'BLOCKED', reason: 'NO_AUTHORIZED_DEEPSEEK_KEY' });
  report.operations.push({ operation: 'GLM_CONTINUE', status: 'BLOCKED', reason: 'NO_AUTHORIZED_ZHIPU_KEY' });
  report.completed_at = new Date().toISOString();
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report_file: reportFile, chain_complete: false, credentials: report.credentials }, null, 2));
  process.exit(0);
}

await copyProtectedConfiguration();
await mkdir(electronUserData, { recursive: true });
await rm(statusFile, { force: true });
const cdpPort = await freePort();
const desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
  cwd: path.dirname(executable),
  env: {
    ...process.env,
    DRAMAGO_DATA_DIR: dataRoot,
    DRAMAGO_ELECTRON_USER_DATA: electronUserData,
    DRAMAGO_DESKTOP_QA_STATUS: statusFile
  },
  windowsHide: false,
  stdio: 'ignore'
});

let browser;
try {
  report.startup = await waitReady(cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  if (!page) throw new Error('Packaged workbench page unavailable.');
  await page.setViewportSize({ width: 1440, height: 960 });

  const glmConnected = await configureAndTest(page, 'zhipu');
  if (!glmConnected) throw new Error('ZHIPU_CONNECTION_TEST_FAILED');

  await page.locator('[data-action="new-work"]').first().click();
  await page.locator('#taskModelSelection').selectOption('zhipu|glm-4.7');
  await page.locator('#ideaInput').fill('写一篇简短完整的身份短剧：你是社区图书管理员，发现借阅卡里夹着一张十年前未寄出的道歉信。重点写你如何找到当事人，并把是否见面的选择还给他们。第二人称，不要神秘身份，不要权势人物救场，结尾完整收束。');
  await page.locator('[data-action="generate"]').click();
  await page.waitForURL(/work_id=/u, { timeout: 30000 });
  const workId = new URL(page.url()).searchParams.get('work_id');
  const created = await captureOperation(page, 'GLM_CREATE', workId, async () => {});

  if (report.credentials.deepseek === 'not_found') {
    report.operations.push({ operation: 'DEEPSEEK_REWRITE', work_id: workId, status: 'BLOCKED', reason: 'NO_AUTHORIZED_DEEPSEEK_KEY' });
  } else if (created && await configureAndTest(page, 'deepseek')) {
    await page.locator('[data-action="show-editor"]').first().click();
    await page.locator('#taskModelSelection').selectOption('deepseek|deepseek-v4-pro');
    const text = await page.locator('#bodyEditor').inputValue();
    const start = Math.min(10, Math.max(0, text.length - 1));
    const end = Math.min(text.length, start + Math.max(20, Math.min(80, text.length - start)));
    await page.locator('#bodyEditor').evaluate((element, range) => {
      element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
    }, { start, end });
    await page.locator('[data-selection-action="REWRITE"]').click();
    await page.locator('#composerInput').fill('只改写选中段落，使动作更克制；不得改变选区外正文、人物和既有事实。');
    await captureOperation(page, 'DEEPSEEK_REWRITE', workId, async () => page.locator('[data-action="generate"]').click());
  }

  if (created) {
    await page.locator('[data-action="show-editor"]').first().click();
    await page.locator('#taskModelSelection').selectOption('zhipu|glm-4.7');
    await page.locator('[data-operation="CONTINUE"]').click();
    await page.locator('#composerInput').fill('从第二天继续，承接已经发生的选择，写一个有阶段性结果的短场景，不复述前文。');
    await captureOperation(page, 'GLM_CONTINUE', workId, async () => page.locator('[data-action="generate"]').click());
  } else {
    report.operations.push({ operation: 'GLM_CONTINUE', work_id: workId, status: 'BLOCKED', reason: 'CREATE_NOT_ADOPTED' });
  }

  report.chain_complete = ['GLM_CREATE', 'DEEPSEEK_REWRITE', 'GLM_CONTINUE'].every((operation) =>
    report.operations.some((item) => item.operation === operation && item.adopted === true));
} catch (error) {
  report.error = error.message;
} finally {
  report.completed_at = new Date().toISOString();
  await browser?.close().catch(() => {});
  if (desktop.exitCode == null) {
    await Promise.race([new Promise((resolve) => desktop.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 6000))]);
    if (desktop.exitCode == null) desktop.kill();
  }
  const database = new SQLiteD1(paths.database);
  report.database = {
    works: (await database.prepare('SELECT COUNT(*) AS count FROM works').first()).count,
    versions: (await database.prepare('SELECT COUNT(*) AS count FROM versions').first()).count,
    tasks: (await database.prepare('SELECT COUNT(*) AS count FROM generation_tasks').first()).count
  };
  database.close();
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify({ report_file: reportFile, chain_complete: report.chain_complete,
  operations: report.operations.map((item) => ({ operation: item.operation, adopted: item.adopted, status: item.status, error: item.error })) }, null, 2));
