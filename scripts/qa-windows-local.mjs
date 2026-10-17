import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createLocalRuntime } from '../local/server.mjs';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import {
  defaultProviderConfiguration,
  MemoryProviderSecretStore,
  WindowsDpapiProviderSecretStore,
  writeProviderConfiguration
} from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const root = process.cwd();
const desktopExecutable = process.env.DRAMAGO_QA_DESKTOP_EXE?.trim() || null;
const desktopMode = Boolean(desktopExecutable);
const output = process.env.DRAMAGO_QA_OUTPUT_DIR?.trim()
  ? path.resolve(process.env.DRAMAGO_QA_OUTPUT_DIR)
  : path.join(root, 'reports', desktopMode ? 'windows-desktop-packaging-v1' : 'windows-local-first-v1');
const screenshots = path.join(output, 'screenshots');
await mkdir(screenshots, { recursive: true });
const dataRoot = path.join(root, '.cache', `${desktopMode ? 'windows-desktop' : 'windows-local'}-qa-${Date.now()}`);
const results = { started_at: new Date().toISOString(), environment: `${desktopMode ? 'packaged Electron + ' : ''}controlled QA provider + real SQLite`, checks: {}, screenshots: [], provider_calls: {} };
let qaCompleted = false;

function check(id, passed, details = null) {
  results.checks[id] = { passed: Boolean(passed), details };
  if (!passed) throw new Error(`${id}: ${JSON.stringify(details)}`);
}

const passValidation = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['林晚'], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

const blockedValidation = {
  ...passValidation,
  findings: [{
    finding_type: 'INTERNAL_FACT_CONFLICT', severity: 'blocking', confidence: 0.99,
    source_priority: 'source_version_fact', evidence: ['源文：父亲已去世五年。', '候选：父亲迎面走来。'],
    reason: '候选让已死亡人物重新出现。'
  }],
  blocking_conflicts: [{ code: 'STORY_FACT_CONFLICT', message: '已死亡人物重新出现。', evidence: '父亲迎面走来' }],
  candidate_internal_consistency: { consistent: false, conflicts: ['已死亡人物重新出现'] }, operation_completed: false
};

function providerResponse(content, model) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 100, completion_tokens: 180, total_tokens: 280 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const counts = { writer: 0, validator: 0, connection: 0, failures: 0, validator_failures: 0, timeouts: 0 };
let validatorFailuresRemaining = 0;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const prompt = (payload.messages || []).map((message) => message.content).join('\n');
  const isValidator = /candidate_internal_consistency|blocking_conflicts|独立语义校验/u.test(prompt);
  const isWriter = /output_kind|CreativeBrief|target_scope/u.test(prompt) && !isValidator;
  if (!isWriter && !isValidator) {
    counts.connection += 1;
    const body = await providerResponse({ ok: true }, payload.model || 'deepseek-v4-pro').text();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
    return;
  }
  if (prompt.includes('QA_PROVIDER_FAIL')) {
    counts.failures += 1;
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end('controlled failure');
    return;
  }
  if (prompt.includes('QA_TIMEOUT')) {
    counts.timeouts += 1;
    await new Promise((resolve) => setTimeout(resolve, 5500));
  }
  if (prompt.includes('QA_STOP_SLOW')) await new Promise((resolve) => setTimeout(resolve, 5000));
  else if (prompt.includes('QA_SLOW')) await new Promise((resolve) => setTimeout(resolve, 900));
  if (isValidator) {
    if (validatorFailuresRemaining > 0) {
      validatorFailuresRemaining -= 1;
      counts.validator_failures += 1;
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('controlled validator failure');
      return;
    }
    counts.validator += 1;
    const body = await providerResponse(prompt.includes('父亲迎面走来') ? blockedValidation : passValidation, payload.model || 'deepseek-flash').text();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
    return;
  }
  counts.writer += 1;
  if (prompt.includes('QA_VALIDATOR_RECOVER')) validatorFailuresRemaining = 2;
  let writer;
  if (/"type"\s*:\s*"selection"/u.test(prompt)) {
    const rewrite = /"operation"\s*:\s*"REWRITE"/u.test(prompt);
    writer = {
      output_kind: 'segment', title: '本地验收短剧',
      content: rewrite ? '她把旧钥匙轻轻放在桌上，推到母亲面前。' : '她没有说话，只把窗帘拉开。晨光落在两个人之间，她才问：“你愿意把真相说完吗？”🙂',
      change_summary: rewrite ? '只改写绑定选区' : '只扩写绑定选区', model_warnings: []
    };
  } else if (/"operation"\s*:\s*"CONTINUE"/u.test(prompt)) {
    writer = {
      output_kind: 'continuation', title: '本地验收短剧',
      content: prompt.includes('QA_BLOCK') ? '第二天，已经去世五年的父亲迎面走来，替她解决了问题。' : '第二天清晨，林晚打开店门，把昨夜没有寄出的信放在窗边。她没有复述过去，只决定先联系收信人。',
      change_summary: '追加下一阶段', model_warnings: []
    };
  } else {
    writer = {
      output_kind: 'full', title: '本地验收短剧',
      content: '林晚在旧书店工作。她没有说话。🙂\n\n她把旧钥匙放在桌上。母亲看着她，问：“你真的决定了吗？”\n\n林晚点头。她保留了信件，也保留了自己重新选择生活的权利。',
      change_summary: '生成完整短剧', model_warnings: []
    };
  }
  const body = await providerResponse(writer, payload.model || 'deepseek-v4-pro').text();
  if (!response.destroyed && !response.writableEnded) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  }
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const providerPort = provider.address().port;

const paths = localPaths(dataRoot);
await ensureLocalDirectories(paths);
await writeProviderConfiguration(paths.providerConfig, {
  ...defaultProviderConfiguration,
  provider_timeout_ms: 5000,
  providers: {
    ...defaultProviderConfiguration.providers,
    deepseek: {
      ...defaultProviderConfiguration.providers.deepseek,
      timeout_ms: 5000,
      disclosure_confirmed_at: new Date().toISOString()
    },
    zhipu: { ...defaultProviderConfiguration.providers.zhipu, timeout_ms: 5000 }
  }
});

const legacyFixture = {
  workId: 'legacy_v1_v3_v4_fixture',
  v1: { id: 'legacy_v1', content: '隔离兼容性样本 V1：最初版本。' },
  v3: { id: 'legacy_v3', content: '隔离兼容性样本 V3：当前已采用正文。' },
  v4: { id: 'legacy_v4', content: '隔离兼容性样本 V4：错误的整篇候选，必须保持候选和 CREATE 分类。' }
};
const legacyDb = new SQLiteD1(paths.database);
legacyDb.exec((await readFile(path.join(root, 'drizzle', '0000_low_the_fallen.sql'), 'utf8')).replaceAll('--> statement-breakpoint', ''));
legacyDb.exec(`CREATE TABLE IF NOT EXISTS local_schema_migrations (
  name TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);`);
await legacyDb.prepare('INSERT INTO local_schema_migrations (name, applied_at) VALUES (?, ?)')
  .bind('0000_low_the_fallen.sql', '2026-10-13T00:00:00.000Z').run();
await legacyDb.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  .bind(legacyFixture.workId, '隔离旧数据兼容性作品', legacyFixture.v3.id, '2026-10-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z').run();
for (const [version, parent, operation, status, title] of [
  [legacyFixture.v1, null, 'CREATE', 'adopted', 'V1 原稿'],
  [legacyFixture.v3, legacyFixture.v1.id, 'REWRITE', 'adopted', 'V3 当前正文'],
  [legacyFixture.v4, legacyFixture.v3.id, 'CREATE', 'candidate', 'V4 错误整篇候选']
]) {
  await legacyDb.prepare(`INSERT INTO versions
    (id, work_id, parent_version_id, operation, status, title, content, generated_segment,
      creative_brief_json, change_summary, checks_json, model_name, usage_json, adopted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(version.id, legacyFixture.workId, parent, operation, status, title, version.content, null,
      JSON.stringify({ operation, target_scope: { type: 'full' } }), '隔离兼容性 fixture', null,
      operation === 'REWRITE' ? 'deepseek-v4-pro' : 'glm-4.7', null,
      status === 'adopted' ? '2026-10-03T00:00:00.000Z' : null,
      version.id === legacyFixture.v1.id ? '2026-10-01T00:00:00.000Z'
        : version.id === legacyFixture.v3.id ? '2026-10-02T00:00:00.000Z' : '2026-10-03T00:00:00.000Z').run();
}
legacyDb.close();

let runtime;
let info;
let browser;
let context;
let page;
let desktopProcess = null;

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForDesktop(statusFile, cdpPort) {
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

async function startPackagedDesktop(workId = null) {
  const statusFile = path.join(output, 'desktop-qa-status.json');
  const exportDirectory = path.join(output, 'exports');
  const electronUserData = path.join(dataRoot, 'electron-user-data');
  await mkdir(exportDirectory, { recursive: true });
  await mkdir(electronUserData, { recursive: true });
  await rm(statusFile, { force: true });
  const cdpPort = await availablePort();
  desktopProcess = spawn(desktopExecutable, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${electronUserData}`
  ], {
    cwd: root,
    env: {
      ...process.env,
      DRAMAGO_DATA_DIR: dataRoot,
      DRAMAGO_ELECTRON_USER_DATA: electronUserData,
      DRAMAGO_DESKTOP_QA_STATUS: statusFile,
      DRAMAGO_DESKTOP_QA_EXPORT_DIR: exportDirectory,
      DRAMAGO_INTERNAL_QA: '1',
      DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${providerPort}/chat/completions`
    },
    windowsHide: false,
    stdio: 'inherit'
  });
  const status = await waitForDesktop(statusFile, cdpPort);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  context = browser.contexts()[0];
  page = context.pages().find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
  if (!page) throw new Error('Packaged Electron workbench page was not exposed over CDP.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (workId) await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(workId)}`);
  const token = await page.locator('meta[name="dramago-local-token"]').getAttribute('content');
  info = { url: `${new URL(page.url()).origin}/`, token };
  runtime = {
    database: new SQLiteD1(paths.database),
    paths,
    status,
    async close() {
      this.database?.close();
      this.database = null;
      await page?.close().catch(() => {});
      if (desktopProcess && desktopProcess.exitCode == null) {
        await Promise.race([
          new Promise((resolve) => desktopProcess.once('exit', resolve)),
          new Promise((resolve) => setTimeout(resolve, 6000))
        ]);
        if (desktopProcess.exitCode == null) desktopProcess.kill();
      }
      await browser?.close().catch(() => {});
    }
  };
}

if (desktopMode) {
  await new WindowsDpapiProviderSecretStore(paths.providerSecrets).set('deepseek', 'qa-secret');
  await startPackagedDesktop();
} else {
  runtime = await createLocalRuntime({
    port: 0,
    dataRoot,
    disableLock: true,
    providerSecretStore: new MemoryProviderSecretStore({ deepseek: 'qa-secret' }),
    qaProviderEndpoint: `http://127.0.0.1:${providerPort}/chat/completions`
  });
  info = await runtime.listen();
  browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage();
}
const consoleErrors = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

async function screenshot(name, fullPage = true) {
  const filename = path.join(screenshots, name);
  await page.screenshot({ path: filename, fullPage });
  results.screenshots.push(path.relative(root, filename).replaceAll('\\', '/'));
}

async function waitForCandidate(label = '检查通过') {
  await page.getByText(label, { exact: true }).first().waitFor({ timeout: 15000 });
}

async function adopt() {
  const button = page.locator('[data-action="adopt-candidate"]').last();
  await button.waitFor({ state: 'visible' });
  check('adopt_enabled_when_valid', await button.isEnabled());
  await button.click();
  await page.getByText('已采用', { exact: true }).first().waitFor();
}

try {
  const unauthorized = await context.request.get(`${info.url}api/bootstrap`);
  check('local_api_requires_session_token', unauthorized.status() === 403, unauthorized.status());
  const foreignOrigin = await context.request.get(`${info.url}api/bootstrap`, { headers: { 'x-dramago-local-token': info.token, origin: 'https://evil.example' } });
  check('local_api_rejects_foreign_origin', foreignOrigin.status() === 403, foreignOrigin.status());

  const legacyRows = (await runtime.database.prepare('SELECT id, parent_version_id, operation, status, content FROM versions WHERE work_id = ? ORDER BY created_at').bind(legacyFixture.workId).all()).results;
  const legacyWork = await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(legacyFixture.workId).first();
  check('legacy_v1_v3_v4_survive_packaged_migrations', legacyRows.length === 3
    && legacyWork.current_version_id === legacyFixture.v3.id
    && legacyRows[0].id === legacyFixture.v1.id && legacyRows[0].operation === 'CREATE' && legacyRows[0].status === 'adopted'
    && legacyRows[1].id === legacyFixture.v3.id && legacyRows[1].operation === 'REWRITE' && legacyRows[1].status === 'adopted'
    && legacyRows[2].id === legacyFixture.v4.id && legacyRows[2].operation === 'CREATE' && legacyRows[2].status === 'candidate'
    && legacyRows[2].parent_version_id === legacyFixture.v3.id);
  await page.goto(`${info.url}?work_id=${encodeURIComponent(legacyFixture.workId)}`);
  check('legacy_current_v3_is_readable_in_packaged_ui', (await page.locator('#bodyEditor').inputValue()) === legacyFixture.v3.content);
  await page.locator('[data-action="open-history"]').first().click();
  check('legacy_history_keeps_all_three_versions', await page.locator('.version-row[data-version-id]').count() === 3);
  await page.locator('[data-action="close-overlay"]').click();
  await page.locator('[data-action="new-work"]').first().click();

  await page.goto(info.url);
  check('missing_key_does_not_block_opening', await page.getByText('从一个身份，').isVisible());
  check('candidate_and_compare_tabs_unavailable_without_candidate', await page.locator('[data-action="show-candidate"]').count() === 0 && await page.locator('[data-action="show-compare"]').count() === 0);
  const samplePrompts = page.locator('[data-prompt]');
  check('three_sample_prompt_controls_exist', await samplePrompts.count() === 3);
  for (let index = 0; index < 3; index += 1) {
    const expected = await samplePrompts.nth(index).getAttribute('data-prompt');
    await samplePrompts.nth(index).click();
    check(`sample_prompt_${index + 1}_fills_idea`, await page.locator('#ideaInput').inputValue() === expected);
  }
  await page.locator('[data-action="open-checks"]').click();
  check('checks_panel_opens_without_candidate', await page.getByRole('heading', { name: '内容检查' }).isVisible());
  await page.keyboard.press('Escape');
  check('escape_closes_side_panel', await page.locator('#sideSheet').isHidden());
  await page.locator('[data-action="open-history"]').first().click();
  await page.locator('#scrim').click({ position: { x: 2, y: 2 } });
  check('scrim_closes_side_panel', await page.locator('#sideSheet').isHidden());
  await page.locator('[data-action="new-work"]').first().click();
  check('new_work_returns_to_empty_workspace', new URL(page.url()).searchParams.get('work_id') == null && await page.locator('#ideaInput').isVisible());
  await page.locator('[data-action="open-settings"]').last().click();
  check('provider_settings_visible', await page.getByText('我的 AI 服务', { exact: true }).isVisible()
    && await page.locator('.provider-card').count() >= 2);
  check('provider_add_and_edit_are_separate', await page.locator('[data-action="start-add-provider"]').isVisible()
    && await page.locator('#providerPresetSetting').count() === 0);
  await page.locator('[data-action="edit-provider"][data-provider-id="deepseek"]').click();
  check('editing_existing_provider_never_shows_preset_switch', await page.locator('#providerPresetSetting').count() === 0);
  check('api_key_not_prefilled', await page.locator('#providerKeySetting').inputValue() === '');
  await page.locator('#providerKeySetting').fill('qa-replacement-secret');
  await page.locator('[data-action="save-provider-settings"]').click();
  await page.getByText('Key 已配置', { exact: true }).first().waitFor();
  await page.locator('[data-action="edit-provider"][data-provider-id="deepseek"]').click();
  check('provider_key_can_be_safely_updated', await page.locator('#providerKeySetting').inputValue() === '');
  await page.locator('[data-action="clear-provider-key"]').click();
  await page.getByText('确认清除 API Key？', { exact: true }).waitFor();
  await page.locator('[data-action="confirm-clear-provider-key"]').click();
  await page.getByText('未配置 Key', { exact: true }).first().waitFor();
  check('provider_key_can_be_cleared', true);
  await page.locator('[data-action="edit-provider"][data-provider-id="deepseek"]').click();
  await page.locator('#providerKeySetting').fill('qa-secret');
  await page.locator('[data-action="save-provider-settings"]').click();
  await page.getByText('Key 已配置', { exact: true }).first().waitFor();
  await page.locator('[data-action="edit-provider"][data-provider-id="deepseek"]').click();
  await page.locator('[data-action="test-provider"]').click();
  await page.getByText(/连接成功/u).waitFor();
  check('provider_connection_test_real_http', counts.connection === 1, counts);
  await page.locator('[data-action="cancel-provider-editor"]').click();
  const providerCountBeforeAdd = await page.locator('.provider-card').count();
  await page.locator('[data-action="start-add-provider"]').click();
  check('new_provider_flow_shows_preset_only_when_adding', await page.locator('#providerPresetSetting').isVisible());
  await page.locator('#providerPresetSetting').selectOption('qwen_bailian');
  await page.locator('#providerDisclosureSetting').check();
  await page.locator('#providerKeySetting').fill('qa-qwen-secret');
  await page.locator('[data-action="save-provider-settings"]').click();
  await page.waitForFunction((count) => document.querySelectorAll('.provider-card').length === count + 1, providerCountBeforeAdd);
  check('new_provider_instance_is_added', await page.locator('.provider-card').count() === providerCountBeforeAdd + 1);
  const qwenCard = page.locator('.provider-card').filter({ hasText: '阿里云百炼 / Qwen' });
  await qwenCard.locator('[data-action="request-delete-provider"]').click();
  await page.getByRole('heading', { name: /删除.*Qwen/u }).waitFor();
  await page.locator('[data-action="confirm-delete-provider"]').click();
  await page.waitForFunction((count) => document.querySelectorAll('.provider-card').length === count, providerCountBeforeAdd);
  check('provider_delete_requires_confirmation_and_removes_instance', await page.locator('.provider-card').count() === providerCountBeforeAdd);
  await page.locator('[data-action="edit-provider"][data-provider-id="zhipu"]').click();
  const disclosureWasRequired = await page.locator('#providerDisclosureSetting').isVisible();
  if (disclosureWasRequired) await page.locator('#providerDisclosureSetting').check();
  await page.locator('#providerKeySetting').fill('qa-zhipu-secret');
  await page.locator('[data-action="save-provider-settings"]').click();
  await page.locator('.provider-card').filter({ hasText: '智谱 GLM 官方 API' })
    .getByText('Key 已配置', { exact: true }).waitFor();
  check('new_provider_disclosure_is_required_and_confirmed', disclosureWasRequired);
  check('zhipu_key_can_be_configured_independently', true);
  check('switching_back_keeps_deepseek_configured', await page.locator('.provider-card').filter({ hasText: 'DeepSeek' }).getByText('Key 已配置', { exact: true }).isVisible());
  await page.locator('#contextSetting').fill('本地 QA 背景');
  await page.locator('#preserveSetting').fill('保留钥匙');
  await page.locator('#lengthSetting').selectOption('1200');
  await page.locator('#personSetting').selectOption({ label: '第二人称' });
  await page.locator('#toneSetting').fill('克制');
  await page.locator('#seriesOpeningSetting').check();
  await page.locator('[data-action="save-settings"]').click();
  check('creative_settings_save_and_close', await page.locator('#sideSheet').isHidden());
  await page.locator('[data-action="open-settings"]').last().click();
  await page.waitForFunction(() => document.querySelector('#contextSetting')?.value === '本地 QA 背景'
    && document.querySelector('#lengthSetting')?.value === '1200'
    && document.querySelector('#seriesOpeningSetting')?.checked === true);
  check('creative_settings_reopen_with_saved_values', await page.locator('#contextSetting').inputValue() === '本地 QA 背景'
    && await page.locator('#lengthSetting').inputValue() === '1200'
    && await page.locator('#seriesOpeningSetting').isChecked(), {
    context: await page.locator('#contextSetting').inputValue(),
    length: await page.locator('#lengthSetting').inputValue(),
    series_opening: await page.locator('#seriesOpeningSetting').isChecked()
  });
  await page.locator('[data-action="create-backup"]').click();
  await page.waitForFunction(() => /^dramago-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite$/u.test(document.querySelector('#backupSetting')?.value || ''));
  check('backup_control_creates_file', /^dramago-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite$/u.test(await page.locator('#backupSetting').inputValue())
    && (await runtime.database.prepare('SELECT COUNT(*) AS count FROM local_schema_migrations').first()).count === 8);
  await page.waitForTimeout(100);
  await page.locator('[data-action="close-overlay"]').click();
  await page.locator('#sideSheet').waitFor({ state: 'hidden' });

  await page.locator('#ideaInput').fill('写一个本地持久化验收故事。');
  check('task_model_selector_lists_whitelisted_models', await page.locator('#taskModelSelection option').count() === 2);
  await page.locator('#taskModelSelection').selectOption('zhipu|glm-4.7');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  const workId = new URL(page.url()).searchParams.get('work_id');
  const createTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('per_task_model_selection_is_persisted', createTask.writer_provider_id === 'zhipu'
    && createTask.writer_model_id === 'glm-4.7' && createTask.validator_provider_id === 'deepseek'
    && createTask.validator_model_id === 'deepseek-flash', createTask);
  const workBeforeAdopt = await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first();
  check('create_candidate_does_not_replace_current', workBeforeAdopt.current_version_id == null);
  await screenshot('01-create-candidate-1440.png');
  await page.locator('[data-action="show-compare"]').last().click();
  check('compare_view_opens_for_candidate', await page.getByRole('heading', { name: '审核改动' }).isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-compare-side="candidate"]').click();
  check('compare_side_toggle_updates_state', (await page.locator('.compare-surface').getAttribute('data-mobile-side')) === 'candidate');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="show-candidate"]').last().click();
  check('candidate_tab_returns_to_full_candidate', await page.getByText('这是候选稿，尚未成为当前正文', { exact: true }).isVisible());
  await page.locator('[data-action="open-checks"]').click();
  check('checks_panel_shows_candidate_checks', await page.getByText('当前有效检查', { exact: true }).isVisible()
    && await page.getByText('当前 findings', { exact: true }).isVisible());
  await page.locator('[data-action="close-overlay"]').click();
  await adopt();
  let current = await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first();
  check('source_less_create_adopts', Boolean(current.current_version_id));

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('#taskModelSelection').selectOption('deepseek|deepseek-v4-pro');
  const sourceExpand = await page.locator('#bodyEditor').inputValue();
  const selectedExpand = '她没有说话。🙂';
  const expandStart = sourceExpand.indexOf(selectedExpand);
  await page.locator('#bodyEditor').evaluate((element, range) => {
    element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start: expandStart, end: expandStart + selectedExpand.length });
  await page.locator('[data-selection-action="EXPAND"]').click();
  const selectionRange = page.locator('.selection-binding [data-range-start]');
  check('selection_binding_utf16', (await selectionRange.getAttribute('data-range-start')) === String(expandStart)
    && (await selectionRange.getAttribute('data-range-end')) === String(expandStart + selectedExpand.length)
    && !(await page.locator('.selection-binding').innerText()).includes('UTF-16'));
  await page.locator('[data-action="clear-selection"]').last().click();
  check('clear_selection_returns_to_whole_document_scope', await page.locator('.selection-binding').count() === 0);
  await page.locator('#bodyEditor').evaluate((element, range) => {
    element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start: expandStart, end: expandStart + selectedExpand.length });
  await page.locator('[data-selection-action="EXPAND"]').click();
  await page.locator('#composerInput').fill('增加动作和一句对白，不改变选区外正文。');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  let expandCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('expand_preserves_prefix', expandCandidate.content.slice(0, expandStart) === sourceExpand.slice(0, expandStart));
  check('expand_preserves_suffix', expandCandidate.content.slice(expandStart + expandCandidate.generated_segment.length) === sourceExpand.slice(expandStart + selectedExpand.length));
  await screenshot('02-expand-selection-and-candidate-1440.png');
  await adopt();

  await page.locator('[data-action="show-editor"]').first().click();
  const sourceRewrite = await page.locator('#bodyEditor').inputValue();
  const selectedRewrite = '她把旧钥匙放在桌上。';
  const rewriteStart = sourceRewrite.indexOf(selectedRewrite);
  await page.locator('#bodyEditor').evaluate((element, range) => {
    element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start: rewriteStart, end: rewriteStart + selectedRewrite.length });
  await page.locator('[data-selection-action="REWRITE"]').click();
  await page.locator('[data-operation="CONTINUE"]').click();
  check('rewrite_to_continue_clears_selection_without_changing_body', await page.locator('.selection-binding').count() === 0
    && await page.locator('[data-operation="CONTINUE"]').getAttribute('aria-selected') === 'true'
    && await page.locator('#bodyEditor').inputValue() === sourceRewrite);
  await page.locator('#bodyEditor').evaluate((element, range) => {
    element.focus(); element.setSelectionRange(range.start, range.end); element.dispatchEvent(new Event('select', { bubbles: true }));
  }, { start: rewriteStart, end: rewriteStart + selectedRewrite.length });
  await page.locator('[data-selection-action="REWRITE"]').click();
  await page.locator('#composerInput').fill('只改写动作为更克制的表达。');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  const rewriteCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('rewrite_preserves_outside_selection', rewriteCandidate.content.startsWith(sourceRewrite.slice(0, rewriteStart)) && rewriteCandidate.content.endsWith(sourceRewrite.slice(rewriteStart + selectedRewrite.length)));
  const versionsBeforeRewriteAdopt = (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length;
  await adopt();
  check('rewrite_retains_old_versions', (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length === versionsBeforeRewriteAdopt);
  const rewriteCurrent = await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first();

  await page.locator('[data-action="show-editor"]').first().click();
  const sourceContinue = await page.locator('#bodyEditor').inputValue();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#taskModelSelection').selectOption('zhipu|glm-4.7');
  check('writer_model_switch_does_not_change_continue_operation', await page.locator('[data-operation="CONTINUE"]').getAttribute('aria-selected') === 'true'
    && (await page.locator('.operation-summary').innerText()).includes('程序追加，不重写前文')
    && (await page.locator('.operation-summary').innerText()).toLowerCase().includes('glm-4.7'));
  await page.locator('#composerInput').fill('从第二天开始续写。');
  await page.reload();
  check('refresh_restores_explicit_continue_operation', await page.locator('[data-operation="CONTINUE"]').getAttribute('aria-selected') === 'true'
    && (await page.locator('#composerInput').inputValue()) === '从第二天开始续写。');
  await context.addInitScript(({ id }) => {
    if (sessionStorage.getItem('dramago-legacy-draft-fixture-applied') === '1') return;
    const key = `dramago-workbench-draft-v2:${id}`;
    const draft = JSON.parse(localStorage.getItem(key));
    delete draft.operationStateVersion;
    localStorage.setItem(key, JSON.stringify(draft));
    sessionStorage.setItem('dramago-legacy-draft-fixture-applied', '1');
  }, { id: workId });
  await writeFile(paths.authoringState, '{"schema_version":1,"works":{}}\n', 'utf8');
  await page.reload();
  const legacyDraftState = {
    activeOperationCount: await page.locator('.operation-picker button.active').count(),
    generateDisabled: await page.locator('[data-action="generate"]').isDisabled(),
    notice: await page.locator('.operation-notice').count() ? await page.locator('.operation-notice').innerText() : null
  };
  check('untrusted_legacy_draft_never_silently_falls_back_to_create', legacyDraftState.activeOperationCount === 0
    && legacyDraftState.generateDisabled
    && legacyDraftState.notice?.includes('重新选择'), legacyDraftState);
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  const continueCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  const continueTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('cross_provider_chain_returns_to_glm_for_continue', continueTask.source_version_id === rewriteCurrent.current_version_id
    && continueTask.writer_provider_id === 'zhipu' && continueTask.writer_model_id === 'glm-4.7'
    && continueTask.validator_provider_id === 'deepseek' && continueTask.validator_model_id === 'deepseek-flash'
    && continueCandidate.writer_provider_id === 'zhipu', { continueTask, continueCandidateId: continueCandidate.id });
  check('continue_appends_without_rewrite', continueCandidate.content.startsWith(`${sourceContinue}\n\n`) && continueCandidate.content.slice(sourceContinue.length + 2) === continueCandidate.generated_segment);
  check('candidate_view_displays_actual_continue_operation', (await page.locator('.candidate-story .eyebrow').innerText()).includes('续写'));
  await page.locator('[data-action="show-compare"]').last().click();
  check('continue_diff_defaults_to_added_content', await page.locator('.continuation-focus').isVisible()
    && await page.locator('.continuation-added').count() > 0
    && await page.locator('.empty-diff').count() === 0);
  await page.locator('[data-compare-mode="full"]').click();
  check('continue_full_diff_marks_only_appended_content', await page.locator('.diff-cell.added.candidate').count() > 0
    && await page.locator('.diff-cell.changed.original:not(.diff-title)').count() === 0
    && (await page.locator('.diff-legend').innerText()).includes('新增续写'));
  await page.locator('[data-action="show-candidate"]').last().click();
  await adopt();

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('契约不一致时不得调用 Writer。');
  const writerCallsBeforeContractMismatch = counts.writer;
  let contractResponseIntercepted = false;
  await page.route('**/api/generate', async (route) => {
    if (contractResponseIntercepted) return route.continue();
    contractResponseIntercepted = true;
    const response = await route.fetch();
    const payload = await response.json();
    payload.task.operation = 'CREATE';
    payload.task.contract.operation = 'CREATE';
    await route.fulfill({ response, json: payload });
  });
  await page.locator('[data-action="generate"]').click();
  await page.getByText(/任务操作契约不一致/u).first().waitFor();
  await page.unroute('**/api/generate');
  const contractMismatchTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('task_contract_mismatch_stops_before_writer_call', counts.writer === writerCallsBeforeContractMismatch
    && contractMismatchTask.status === 'stopped' && contractMismatchTask.stop_state === 'stopped_before_send', contractMismatchTask);
  const routingEvents = await page.evaluate(() => JSON.parse(localStorage.getItem('dramago-operation-routing-events-v1') || '[]'));
  check('routing_diagnostics_are_redacted_and_bounded', routingEvents.some((item) => item.result === 'contract_mismatch')
    && routingEvents.length <= 80
    && routingEvents.every((item) => !('prompt' in item) && !('content' in item) && !('authorization' in item)));

  await page.locator('[data-operation="CREATE"]').click();
  await page.locator('#composerInput').fill('明确生成一篇整篇新候选，但不要直接覆盖当前正文。');
  const currentBeforeFullCreate = (await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first()).current_version_id;
  const tasksBeforeFullCreate = (await runtime.database.prepare('SELECT COUNT(*) AS count FROM generation_tasks WHERE work_id = ?').bind(workId).first()).count;
  const writerCallsBeforeFullCreate = counts.writer;
  await page.locator('[data-action="generate"]').click();
  await page.getByRole('heading', { name: '确认生成整篇新候选？' }).waitFor();
  check('existing_work_full_create_requires_explicit_ui_confirmation', counts.writer === writerCallsBeforeFullCreate
    && (await runtime.database.prepare('SELECT COUNT(*) AS count FROM generation_tasks WHERE work_id = ?').bind(workId).first()).count === tasksBeforeFullCreate);
  await page.locator('[data-action="confirm-full-replacement"]').click();
  await waitForCandidate();
  const confirmedFullTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  const confirmedFullCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE id = ?').bind(confirmedFullTask.result_version_id).first();
  check('confirmed_full_create_isolated_as_candidate', confirmedFullTask.merge_strategy === 'MODEL_FULL_REPLACE'
    && confirmedFullTask.output_kind === 'full' && confirmedFullCandidate.parent_version_id === currentBeforeFullCreate
    && confirmedFullCandidate.status === 'candidate'
    && (await runtime.database.prepare('SELECT current_version_id FROM works WHERE id = ?').bind(workId).first()).current_version_id === currentBeforeFullCreate,
  { confirmedFullTask, candidateId: confirmedFullCandidate.id });

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('使用键盘快捷键提交下一段。');
  const tasksBeforeShortcut = (await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ?').bind(workId).all()).results.length;
  await page.keyboard.press('Control+Enter');
  await waitForCandidate();
  check('ctrl_enter_submits_one_generation_task', (await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ?').bind(workId).all()).results.length === tasksBeforeShortcut + 1);
  await adopt();

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_SLOW 快速双击只能建立一个任务。');
  const tasksBeforeDoubleClick = (await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ?').bind(workId).all()).results.length;
  await page.locator('[data-action="generate"]').dblclick({ delay: 10 });
  await waitForCandidate();
  const tasksAfterDoubleClick = (await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ?').bind(workId).all()).results.length;
  check('rapid_double_click_creates_one_task', tasksAfterDoubleClick === tasksBeforeDoubleClick + 1, { before: tasksBeforeDoubleClick, after: tasksAfterDoubleClick });
  await adopt();

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_STOP_SLOW 验证用户主动停止生成。');
  const versionsBeforeStop = (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length;
  await page.locator('[data-action="generate"]').click();
  await page.locator('[data-action="stop-generation"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="stop-generation"]').click();
  await page.getByRole('heading', { name: '确认停止生成？' }).waitFor();
  await page.locator('[data-action="close-modal"]').click();
  const runningAfterStopCancel = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('cancel_stop_keeps_generation_running', !['stopped', 'failed', 'abandoned'].includes(runningAfterStopCancel.status), runningAfterStopCancel);
  await page.locator('[data-action="stop-generation"]').click();
  await page.locator('[data-action="confirm-stop-generation"]').click();
  await page.getByText(/任务已停止/u).first().waitFor();
  const stoppedTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('stop_generation_marks_task_and_requires_manual_retry', stoppedTask.status === 'stopped'
    && stoppedTask.outcome_unknown === 1 && stoppedTask.retry_confirmation_required === 1, stoppedTask);
  await page.waitForTimeout(5200);
  check('late_response_after_ui_stop_does_not_create_candidate',
    (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length === versionsBeforeStop);
  check('stopped_generation_preserves_instruction', (await page.locator('#composerInput').inputValue()).includes('QA_STOP_SLOW'));

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_PROVIDER_FAIL 保留这条输入。');
  await page.locator('[data-action="generate"]').click();
  await page.getByText(/文本模型请求失败/u).first().waitFor({ timeout: 10000 });
  if (!await page.locator('#composerInput').count()) await page.locator('[data-action="show-editor"]').last().click();
  check('provider_failure_preserves_input', (await page.locator('#composerInput').inputValue()).includes('QA_PROVIDER_FAIL'));
  check('provider_failure_immediately_reenables_button', await page.locator('[data-action="generate"]').isEnabled());

  const failedProviderTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  await page.locator('#composerInput').fill('QA_TIMEOUT 模拟 Provider 超时并允许重试。');
  await page.locator('[data-action="generate"]').click();
  let timeoutTask = null;
  const timeoutDeadline = Date.now() + 22000;
  while (Date.now() < timeoutDeadline) {
    timeoutTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
    if (timeoutTask?.id !== failedProviderTask?.id && timeoutTask?.status === 'failed') break;
    await page.waitForTimeout(200);
  }
  check('provider_timeout_recorded_as_failed', timeoutTask?.error_code === 'PROVIDER_TIMEOUT', timeoutTask && { status: timeoutTask.status, error_code: timeoutTask.error_code, transport_attempts: timeoutTask.transport_attempts });
  if (!await page.locator('#composerInput').count()) await page.locator('[data-action="show-editor"]').last().click();
  await page.locator('[data-action="generate"]').waitFor({ state: 'visible' });
  check('provider_timeout_preserves_input', (await page.locator('#composerInput').inputValue()).includes('QA_TIMEOUT'));
  check('provider_timeout_reenables_button', await page.locator('[data-action="generate"]').isEnabled());

  await page.locator('#composerInput').fill('QA_VALIDATOR_RECOVER 候选保存后模拟检查服务短暂不可用。');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate('检查不可用');
  check('validator_unavailable_keeps_candidate', await page.locator('[data-action="retry-validation"]').isEnabled());
  await page.locator('[data-action="retry-validation"]').click();
  await waitForCandidate();
  check('retry_validation_reuses_saved_candidate', await page.locator('[data-action="adopt-candidate"]').last().isEnabled());
  await adopt();
  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();

  await page.locator('#composerInput').fill('QA_BLOCK 制造一个事实冲突。');
  const currentBeforeBlock = (await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first()).current_version_id;
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate('检查阻断');
  check('validator_block_disables_adopt', await page.locator('[data-action="adopt-candidate"]').count() === 0
    && await page.locator('[data-action="request-candidate-revalidation"]').isEnabled());
  const currentAfterBlock = (await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first()).current_version_id;
  check('blocked_candidate_does_not_change_current', currentAfterBlock === currentBeforeBlock);
  const trulyBlockedCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  const writerAttemptsBeforeTrueRecheck = (await runtime.database.prepare("SELECT COUNT(*) AS count FROM provider_transport_attempts WHERE stage = 'write'").first()).count;
  await page.locator('[data-action="request-candidate-revalidation"]').click();
  await page.getByRole('heading', { name: '重新检查这份候选？' }).waitFor();
  check('revalidation_requires_explicit_cost_confirmation', await page.getByText(/可能产生 Validator API 费用/u).isVisible());
  await screenshot('03-revalidation-confirmation-modal-1440.png', false);
  await page.locator('#revalidationDisclosure').check();
  await page.locator('[data-action="confirm-candidate-revalidation"]').click();
  await waitForCandidate('检查阻断');
  const trulyBlockedAfter = await runtime.database.prepare('SELECT * FROM versions WHERE id = ?').bind(trulyBlockedCandidate.id).first();
  const writerAttemptsAfterTrueRecheck = (await runtime.database.prepare("SELECT COUNT(*) AS count FROM provider_transport_attempts WHERE stage = 'write'").first()).count;
  check('true_conflict_remains_blocked_after_revalidation', trulyBlockedAfter.validation_status === 'blocked'
    && writerAttemptsAfterTrueRecheck === writerAttemptsBeforeTrueRecheck
    && trulyBlockedAfter.content_hash === trulyBlockedCandidate.content_hash, {
    validation_status: trulyBlockedAfter.validation_status,
    writer_attempts_before: writerAttemptsBeforeTrueRecheck,
    writer_attempts_after: writerAttemptsAfterTrueRecheck,
    hash_unchanged: trulyBlockedAfter.content_hash === trulyBlockedCandidate.content_hash
  });

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_REVALIDATE_SCOPE 生成合法追加，随后模拟旧版误阻断。');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  const falseBlockedTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  const falseBlockedCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE id = ?').bind(falseBlockedTask.result_version_id).first();
  const originalDeterministicChecks = JSON.parse(falseBlockedCandidate.checks_json || '[]')
    .filter((item) => item.finding_type !== 'semantic_validator' && item.check !== 'SEMANTIC_VALIDATION');
  const legacyFalseCheck = [...originalDeterministicChecks, { finding_type: 'semantic_validator', check: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', status: 'fail',
    message: '合成旧版误阻断：只引用来源正文。', candidate_version_id: falseBlockedCandidate.id,
    content_hash: falseBlockedCandidate.content_hash, validator_version: 'content-semantic-v2' }];
  await runtime.database.batch([
    runtime.database.prepare(`UPDATE versions SET checks_json = ?, validator_version = 'content-semantic-v2',
      validation_status = 'blocked', can_auto_apply = 0, current_validation_run_id = NULL WHERE id = ?`)
      .bind(JSON.stringify(legacyFalseCheck), falseBlockedCandidate.id),
    runtime.database.prepare(`UPDATE generation_tasks SET validation_status = 'blocked',
      validator_version = 'content-semantic-v2' WHERE id = ?`).bind(falseBlockedTask.id)
  ]);
  await page.reload();
  await waitForCandidate('检查阻断');
  const writerAttemptsBeforeSafeRecheck = (await runtime.database.prepare("SELECT COUNT(*) AS count FROM provider_transport_attempts WHERE stage = 'write'").first()).count;
  await page.locator('[data-action="request-candidate-revalidation"]').click();
  await page.locator('#revalidationDisclosure').check();
  await page.locator('[data-action="confirm-candidate-revalidation"]').click();
  await waitForCandidate();
  const revalidatedCandidate = await runtime.database.prepare('SELECT * FROM versions WHERE id = ?').bind(falseBlockedCandidate.id).first();
  const validationHistory = (await runtime.database.prepare(`SELECT * FROM candidate_validation_runs
    WHERE candidate_version_id = ? ORDER BY created_at`).bind(falseBlockedCandidate.id).all()).results;
  const currentRevalidation = validationHistory.find((run) => run.trigger === 'user_revalidation');
  const safeRevalidationAttempts = (await runtime.database.prepare(`SELECT * FROM provider_transport_attempts
    WHERE validation_run_id = ?`).bind(currentRevalidation?.id || '').all()).results;
  const writerAttemptsAfterSafeRecheck = (await runtime.database.prepare("SELECT COUNT(*) AS count FROM provider_transport_attempts WHERE stage = 'write'").first()).count;
  check('safe_revalidation_does_not_call_writer_or_change_candidate', writerAttemptsAfterSafeRecheck === writerAttemptsBeforeSafeRecheck
    && safeRevalidationAttempts.length === 1 && safeRevalidationAttempts[0].stage === 'revalidate'
    && revalidatedCandidate.content === falseBlockedCandidate.content
    && revalidatedCandidate.content_hash === falseBlockedCandidate.content_hash);
  check('safe_revalidation_preserves_legacy_check_history', validationHistory.length === 2
    && validationHistory[0].trigger === 'legacy_snapshot'
    && JSON.parse(validationHistory[0].checks_json).some((item) => item.message?.includes('合成旧版误阻断'))
    && validationHistory[1].trigger === 'user_revalidation');
  check('safe_revalidation_pass_enables_original_adopt_guard', revalidatedCandidate.validation_status === 'passed'
    && revalidatedCandidate.can_auto_apply === 1
    && await page.locator('[data-action="adopt-candidate"]').last().isEnabled());

  const legacyResidualFinding = { finding_type: 'semantic_validator', check: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', status: 'fail',
    message: '旧版残留动态 finding：引用来源正文，不属于本次新增片段。', candidate_version_id: falseBlockedCandidate.id,
    content_hash: falseBlockedCandidate.content_hash, validator_version: currentRevalidation.validator_version };
  const legacyResidualChecks = [...JSON.parse(currentRevalidation.checks_json), legacyResidualFinding];
  await runtime.database.batch([
    runtime.database.prepare('UPDATE candidate_validation_runs SET checks_json = ? WHERE id = ?')
      .bind(JSON.stringify(legacyResidualChecks), currentRevalidation.id),
    runtime.database.prepare('UPDATE versions SET checks_json = ?, validation_status = ?, can_auto_apply = 0 WHERE id = ?')
      .bind(JSON.stringify(legacyResidualChecks), 'passed', falseBlockedCandidate.id)
  ]);
  const providerCallsBeforeLegacyCompatibility = JSON.stringify(counts);
  await page.reload();
  await waitForCandidate();
  check('legacy_passed_residual_findings_reconstruct_without_paid_revalidation',
    JSON.stringify(counts) === providerCallsBeforeLegacyCompatibility
      && await page.locator('[data-action="adopt-candidate"]').last().isEnabled(), counts);
  await page.locator('[data-action="open-checks"]').click();
  check('current_pass_is_separate_from_old_blocked_history', await page.getByText('当前有效检查', { exact: true }).isVisible()
    && await page.getByText(/旧结果不参与当前门禁/u).isVisible());
  check('legacy_compatibility_view_explains_reconstruction_and_preserves_raw_audit',
    await page.getByText('已从既有检查记录重建当前视图', { exact: true }).isVisible()
      && await page.getByText(/原始 findings 供审计/u).isVisible());
  const rawLegacyRunAfterRead = await runtime.database.prepare('SELECT checks_json FROM candidate_validation_runs WHERE id = ?')
    .bind(currentRevalidation.id).first();
  check('legacy_compatibility_read_does_not_mutate_validation_history',
    JSON.parse(rawLegacyRunAfterRead.checks_json).some((item) => item.message?.includes('旧版残留动态 finding')));
  await screenshot('04-legacy-passed-reconstructed-with-validation-history-1440.png', false);
  await page.locator('[data-action="close-overlay"]').click();
  await adopt();
  const rawLegacyRunAfterAdopt = await runtime.database.prepare('SELECT checks_json FROM candidate_validation_runs WHERE id = ?')
    .bind(currentRevalidation.id).first();
  check('legacy_passed_adopt_keeps_raw_check_history',
    JSON.parse(rawLegacyRunAfterAdopt.checks_json).some((item) => item.message?.includes('旧版残留动态 finding'))
      && JSON.stringify(counts) === providerCallsBeforeLegacyCompatibility);

  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('生成一个用于版本冲突测试的下一段。');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  const candidateBeforeConflict = await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  const manualSave = await page.evaluate(async ({ workId, sourceId }) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch('/api/versions/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dramago-local-token': token }, body: JSON.stringify({ work_id: workId, source_version_id: sourceId, title: '并发保存版本', content: '这是生成期间保存的较新正文。' }) });
    return { status: response.status, payload: await response.json() };
  }, { workId, sourceId: candidateBeforeConflict.parent_version_id });
  check('race_fixture_saved_newer_version', manualSave.status === 201);
  await page.locator('[data-action="adopt-candidate"]').last().click();
  await page.getByText('当前版本已经变化', { exact: true }).waitFor();
  current = await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first();
  check('cas_rejects_stale_candidate', current.current_version_id === manualSave.payload.version.id);
  await page.locator('[data-action="regenerate-current"]').click();
  await page.locator('#composerInput').waitFor();
  check('successful_operation_clears_previous_instruction', await page.locator('#composerInput').inputValue() === '');
  await page.locator('#composerInput').fill('基于最新正文重新生成候选。');
  await page.locator('[data-action="generate"]').click();
  await waitForCandidate();
  const regeneratedTask = await runtime.database.prepare('SELECT * FROM generation_tasks WHERE work_id = ? ORDER BY created_at DESC LIMIT 1').bind(workId).first();
  check('regenerate_current_uses_latest_source_version', regeneratedTask.source_version_id === manualSave.payload.version.id);
  await adopt();

  await page.reload();
  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#composerInput').fill('QA_SLOW 刷新恢复任务，不重复调用。');
  const callsBeforeRecovery = counts.writer;
  await page.locator('[data-action="generate"]').click();
  await page.getByText(/正在写你的故事|正在检查候选稿/u).first().waitFor();
  await page.waitForTimeout(120);
  await page.reload();
  await waitForCandidate();
  check('refresh_recovers_same_task_without_duplicate_writer_call', counts.writer - callsBeforeRecovery === 1, { before: callsBeforeRecovery, after: counts.writer });
  await adopt();

  await page.locator('[data-action="show-editor"]').first().click();
  const versionCountBeforeManual = (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length;
  await page.locator('#bodyEditor').fill(`${await page.locator('#bodyEditor').inputValue()}\n\n手动补充的一句。`);
  await page.keyboard.press('Control+s');
  await page.getByText('版本已保存', { exact: true }).waitFor();
  check('manual_edit_keeps_old_version', (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length === versionCountBeforeManual + 1);
  const providerCallsBeforeHistoryBrowsing = JSON.stringify(counts);
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('[data-action="open-history"]').first().click();
  await page.locator('.version-row.current').click();
  check('current_version_history_opens_read_only_without_changing_operation',
    await page.getByText('正在只读查看当前版本', { exact: true }).isVisible()
      && await page.locator('[data-action="request-history-authoring"]').isVisible());
  await page.locator('[data-action="request-history-authoring"]').click();
  check('current_history_requires_explicit_authoring_entry',
    await page.getByRole('heading', { name: '基于当前版本进入创作' }).isVisible());
  await page.locator('[data-action="confirm-history-authoring-current"]').click();
  check('confirmed_current_history_entry_returns_to_editor_without_generation',
    await page.locator('#bodyEditor').isVisible()
      && await page.locator('[data-operation="CONTINUE"]').getAttribute('aria-selected') === 'true'
      && JSON.stringify(counts) === providerCallsBeforeHistoryBrowsing);

  await page.locator('[data-action="open-history"]').first().click();
  await page.locator('.version-row[data-version-id]:not(.current)').first().click();
  check('historical_version_is_read_only_and_distinct_from_rewrite',
    await page.getByText('正在查看历史记录，当前正文未改变', { exact: true }).isVisible()
      && await page.locator('[data-action="request-history-authoring"]').isVisible());
  await screenshot('05-history-read-only-1440.png', false);
  await page.locator('[data-action="request-history-authoring"]').click();
  check('historical_authoring_discloses_restore_and_current_source_conflict',
    await page.getByRole('heading', { name: '从历史版本发起新创作' }).isVisible()
      && await page.locator('#modalLayer').getByText(/不能绕过版本保护/u).isVisible());
  await page.locator('[data-action="confirm-history-restore"]').click();
  await page.getByText('服务端已创建新的恢复版本，原历史版本保持不变', { exact: true }).waitFor();
  check('history_restore_preserves_selected_continue_operation', await page.locator('[data-operation="CONTINUE"]').getAttribute('aria-selected') === 'true');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-current"]').first().click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const exported = await (await import('node:fs/promises')).readFile(downloadPath, 'utf8');
  const selectedCurrent = await runtime.database.prepare('SELECT v.* FROM versions v JOIN works w ON w.current_version_id = v.id WHERE w.id = ?').bind(workId).first();
  check('export_matches_current_version', exported.includes(selectedCurrent.content) && exported.startsWith(`# ${selectedCurrent.title}`));

  await page.locator('[data-action="open-settings"]').last().click();
  await page.locator('[data-action="create-backup"]').click();
  await page.getByText('SQLite 备份已创建并完成校验', { exact: true }).waitFor();
  const backupId = await page.locator('#backupSetting').inputValue();
  await page.locator('[data-action="close-overlay"]').click();
  const isolatedB = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch('/api/versions/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dramago-local-token': token }, body: JSON.stringify({ work_id: 'local_isolation_b', title: '隔离作品 B', content: '只属于作品 B 的正文。' }) });
    return response.status;
  });
  check('second_work_created', isolatedB === 201);
  await page.reload();
  await page.locator('[data-action="open-history"]').first().click();
  await page.locator('[data-work-id="local_isolation_b"]').click();
  check('work_b_does_not_show_work_a', (await page.locator('#bodyEditor').inputValue()) === '只属于作品 B 的正文。');
  await page.locator('[data-action="open-settings"]').last().click();
  await page.locator('#backupSetting').selectOption(backupId);
  await page.locator('[data-action="request-restore"]').click();
  await page.getByText('确认恢复本地备份？', { exact: true }).waitFor();
  await page.locator('[data-action="close-modal"]').click();
  check('restore_confirmation_can_be_cancelled', await page.locator('#modalLayer').isHidden());
  await page.locator('[data-action="request-restore"]').click();
  if (desktopMode) {
    runtime.database.close();
    runtime.database = null;
  }
  await page.locator('[data-action="confirm-restore"]').click();
  await page.getByText('本地备份已恢复', { exact: true }).waitFor();
  if (desktopMode) runtime.database = new SQLiteD1(paths.database);
  check('database_restore_removes_post_backup_work', await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind('local_isolation_b').first() == null);

  await page.goto(`${info.url}?work_id=${encodeURIComponent(workId)}`);
  await page.locator('[data-operation="CONTINUE"]').click();
  const operationBeforeRestart = await page.evaluate((currentWorkId) => ({
    selected: document.querySelector('[data-operation="CONTINUE"]')?.getAttribute('aria-selected'),
    draft: localStorage.getItem(`dramago-workbench-draft-v2:${currentWorkId}`)
  }), workId);
  check('continue_operation_persisted_before_restart', operationBeforeRestart.selected === 'true'
    && JSON.parse(operationBeforeRestart.draft || '{}').operation === 'CONTINUE', operationBeforeRestart);
  const callsBeforeRestart = { ...counts };
  const versionCountBeforeRestart = (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length;
  await runtime.close();
  if (desktopMode) {
    await startPackagedDesktop(workId);
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  } else {
    runtime = await createLocalRuntime({
      port: 0,
      dataRoot,
      disableLock: true,
      providerSecretStore: new MemoryProviderSecretStore({ deepseek: 'qa-secret', zhipu: 'qa-zhipu-secret' }),
      qaProviderEndpoint: `http://127.0.0.1:${providerPort}/chat/completions`
    });
    info = await runtime.listen();
    await page.goto(`${info.url}?work_id=${encodeURIComponent(workId)}`);
  }
  check('restart_restores_current_body', (await page.locator('#bodyEditor').inputValue()) === selectedCurrent.content);
  const restartOperationState = await page.evaluate((currentWorkId) => ({
    selected: document.querySelector('[data-operation="CONTINUE"]')?.getAttribute('aria-selected'),
    draft: localStorage.getItem(`dramago-workbench-draft-v2:${currentWorkId}`)
  }), workId);
  check('restart_restores_continue_operation', restartOperationState.selected === 'true', restartOperationState);
  check('restart_restores_version_history', (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind(workId).all()).results.length === versionCountBeforeRestart);
  check('restart_does_not_repeat_provider_calls', JSON.stringify(counts) === JSON.stringify(callsBeforeRestart), { before: callsBeforeRestart, after: counts });
  await page.locator('[data-action="open-settings"]').last().click();
  const configuredProviderOptions = await page.locator('.provider-card .local-status').allTextContents();
  check('both_provider_keys_remain_configured_after_restart', configuredProviderOptions.filter((text) => text.includes('Key 已配置')).length === 2, configuredProviderOptions);
  await page.locator('[data-action="close-overlay"]').click();

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.locator('[data-action="open-history"]').last().click();
  check('history_panel_operates_at_1024', await page.getByRole('heading', { name: '版本与作品' }).isVisible());
  await screenshot('05-history-and-works-1024.png', false);
  await page.locator('[data-action="close-overlay"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, atBottom: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight }));
  check('mobile_390_no_horizontal_overflow', mobile.scrollWidth <= mobile.clientWidth, mobile);
  check('mobile_long_text_bottom_reachable', mobile.atBottom, mobile);
  await screenshot('06-mobile-current-story-390.png', false);
  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('#composerInput').evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { data: '续' }));
    element.value = '续写下一幕';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '续写下一幕' }));
    element.dispatchEvent(new CompositionEvent('compositionend', { data: '续写下一幕' }));
  });
  check('chinese_ime_composition_preserves_input', await page.locator('#composerInput').inputValue() === '续写下一幕');

  for (const width of [1600, 1366, 1200, 1024, 768, 480]) {
    await page.setViewportSize({ width, height: width <= 768 ? 900 : 960 });
    const layout = await page.evaluate(() => {
      const composer = document.querySelector('.composer');
      const submit = document.querySelector('.composer .send-button');
      const composerRect = composer?.getBoundingClientRect();
      const submitRect = submit?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        composerWithinViewport: Boolean(composerRect && composerRect.left >= 0 && composerRect.right <= innerWidth),
        submitReadable: Boolean(submitRect && submitRect.width >= 120 && submitRect.height >= 36)
      };
    });
    check(`responsive_${width}_no_overlap_or_overflow`, layout.scrollWidth <= layout.clientWidth
      && layout.composerWithinViewport && layout.submitReadable, layout);
    await screenshot(`responsive-editor-${width}.png`, false);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="show-editor"]').first().click();
  const currentBeforeDbFailure = (await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first()).current_version_id;
  runtime.database.exec(`CREATE TRIGGER qa_fail_version_insert BEFORE INSERT ON versions WHEN NEW.title = 'QA_DB_FAIL' BEGIN SELECT RAISE(ABORT, 'controlled write failure'); END;`);
  await page.locator('#titleEditor').fill('QA_DB_FAIL');
  await page.locator('#bodyEditor').fill(`${await page.locator('#bodyEditor').inputValue()}\n数据库失败时保留的输入。`);
  await page.locator('[data-action="save-version"]').click();
  await page.getByText(/服务暂时不可用/u).first().waitFor();
  check('database_write_failure_preserves_input', (await page.locator('#bodyEditor').inputValue()).includes('数据库失败时保留的输入'));
  check('database_write_failure_does_not_change_current', (await runtime.database.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first()).current_version_id === currentBeforeDbFailure);
  runtime.database.exec('DROP TRIGGER qa_fail_version_insert');

  const databaseBytes = await (await import('node:fs/promises')).readFile(runtime.paths.database);
  check('api_key_not_present_in_sqlite', !databaseBytes.toString('utf8').includes('qa-secret'));

  if (desktopMode) {
    await page.locator('[data-action="open-settings"]').last().click();
    await page.locator('[data-action="edit-provider"][data-provider-id="deepseek"]').click();
    await page.locator('[data-action="clear-provider-key"]').click();
    await page.locator('[data-action="confirm-clear-provider-key"]').click();
    await page.getByText('模型待配置', { exact: true }).waitFor();
    check('no_key_shows_clear_model_status', true);
    await page.evaluate(async () => {
      const token = document.querySelector('meta[name="dramago-local-token"]').content;
      await fetch('/api/versions/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dramago-local-token': token }, body: JSON.stringify({ work_id: 'offline_edit_work', title: '离线编辑作品', content: '没有 API Key 也能编辑。' }) });
    });
    await page.goto(`${info.url}?work_id=offline_edit_work`);
    await page.locator('#bodyEditor').fill('没有 API Key 也能编辑并保存新版本。');
    await page.locator('[data-action="save-version"]').click();
    await page.getByText('版本已保存', { exact: true }).waitFor();
    check('no_key_allows_local_edit_and_save', (await runtime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind('offline_edit_work').all()).results.length === 2);
    await page.locator('[data-action="open-settings"]').last().click();
    await page.locator('#importDocumentInput').setInputFiles({
      name: '导入验收.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 导入验收作品\n\n这是导入后保存的独立正文。', 'utf8')
    });
    await page.getByText('已导入为独立本地作品，原作品未被覆盖', { exact: true }).waitFor();
    const importedWork = await runtime.database.prepare('SELECT * FROM works WHERE title = ?').bind('导入验收作品').first();
    check('import_markdown_creates_independent_work', Boolean(importedWork) && importedWork.id !== 'offline_edit_work');
  } else {
    const noKeyRoot = path.join(root, '.cache', `windows-local-no-key-${Date.now()}`);
    const noKeyPaths = localPaths(noKeyRoot);
    await ensureLocalDirectories(noKeyPaths);
    const noKeyRuntime = await createLocalRuntime({
      port: 0,
      dataRoot: noKeyRoot,
      disableLock: true,
      providerSecretStore: new MemoryProviderSecretStore(),
      qaProviderEndpoint: `http://127.0.0.1:${providerPort}/chat/completions`
    });
    const noKeyInfo = await noKeyRuntime.listen();
    const noKeyPage = await context.newPage();
    await noKeyPage.goto(noKeyInfo.url);
    check('no_key_shows_clear_model_status', await noKeyPage.getByText('模型待配置', { exact: true }).isVisible());
    await noKeyPage.evaluate(async () => {
      const token = document.querySelector('meta[name="dramago-local-token"]').content;
      await fetch('/api/versions/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dramago-local-token': token }, body: JSON.stringify({ work_id: 'offline_edit_work', title: '离线编辑作品', content: '没有 API Key 也能编辑。' }) });
    });
    await noKeyPage.goto(`${noKeyInfo.url}?work_id=offline_edit_work`);
    await noKeyPage.locator('#bodyEditor').fill('没有 API Key 也能编辑并保存新版本。');
    await noKeyPage.locator('[data-action="save-version"]').click();
    await noKeyPage.getByText('版本已保存', { exact: true }).waitFor();
    check('no_key_allows_local_edit_and_save', (await noKeyRuntime.database.prepare('SELECT * FROM versions WHERE work_id = ?').bind('offline_edit_work').all()).results.length === 2);
    await noKeyPage.locator('[data-action="open-settings"]').last().click();
    await noKeyPage.locator('#importDocumentInput').setInputFiles({
      name: '导入验收.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 导入验收作品\n\n这是导入后保存的独立正文。', 'utf8')
    });
    await noKeyPage.getByText('已导入为独立本地作品，原作品未被覆盖', { exact: true }).waitFor();
    const importedWork = await noKeyRuntime.database.prepare('SELECT * FROM works WHERE title = ?').bind('导入验收作品').first();
    check('import_markdown_creates_independent_work', Boolean(importedWork) && importedWork.id !== 'offline_edit_work');
    await noKeyPage.close();
    await noKeyRuntime.close();
  }

  if (desktopMode) {
    await page.locator('[data-action="open-settings"]').last().click();
    await page.locator('[data-action="shutdown-local"]').click();
    await page.getByRole('heading', { name: 'DramaGo 已安全退出' }).waitFor();
    await page.waitForTimeout(300);
    const shutdownProbe = await context.request.get(`${info.url}api/local/status`, { headers: { 'x-dramago-local-token': info.token } }).catch(() => null);
    check('safe_shutdown_closes_local_http_service', shutdownProbe == null);
  } else {
    const shutdownRoot = path.join(root, '.cache', `windows-local-shutdown-${Date.now()}`);
    const shutdownRuntime = await createLocalRuntime({ port: 0, dataRoot: shutdownRoot, disableLock: true, providerSecretStore: new MemoryProviderSecretStore() });
    const shutdownInfo = await shutdownRuntime.listen();
    const shutdownPage = await context.newPage();
    await shutdownPage.goto(shutdownInfo.url);
    await shutdownPage.locator('[data-action="open-settings"]').last().click();
    await shutdownPage.locator('[data-action="shutdown-local"]').click();
    await shutdownPage.getByRole('heading', { name: 'DramaGo 已安全退出' }).waitFor();
    await shutdownPage.waitForTimeout(300);
    const shutdownProbe = await context.request.get(`${shutdownInfo.url}api/local/status`, { headers: { 'x-dramago-local-token': shutdownInfo.token } }).catch(() => null);
    check('safe_shutdown_closes_local_http_service', shutdownProbe == null);
    await shutdownPage.close();
    await shutdownRuntime.close().catch(() => {});
  }

  const expectedFaultStatuses = ['409', '500', '502', '504', 'ERR_CONNECTION_REFUSED'];
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !expectedFaultStatuses.some((status) => message.includes(status)));
  check('no_critical_console_errors', unexpectedConsoleErrors.length === 0, { expected_fault_injection: consoleErrors, unexpected: unexpectedConsoleErrors });
  qaCompleted = true;
} finally {
  results.completed_at = new Date().toISOString();
  results.provider_calls = counts;
  results.passed = qaCompleted && Object.values(results.checks).every((item) => item.passed);
  await writeFile(path.join(output, 'ui-control-qa-results.json'), `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();
  await runtime.close().catch(() => {});
  await new Promise((resolve) => provider.close(resolve));
}

console.log(JSON.stringify({ passed: results.passed, checks: Object.keys(results.checks).length, screenshots: results.screenshots.length, provider_calls: counts }, null, 2));
