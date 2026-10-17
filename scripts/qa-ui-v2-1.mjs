import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseUrl = process.argv[2] || 'http://127.0.0.1:4181';
const outputDir = path.resolve('reports/ui-v2-1-integration/screenshots');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const results = { base_url: baseUrl, started_at: new Date().toISOString(), checks: {}, screenshots: [] };

function check(name, passed, details = null) {
  results.checks[name] = { passed: Boolean(passed), details };
  if (!passed) throw new Error(`${name}: ${details || 'failed'}`);
}

async function screenshot(page, filename, options = {}) {
  const file = path.join(outputDir, filename);
  await page.screenshot({ path: file, fullPage: options.fullPage ?? true });
  results.screenshots.push(path.relative(process.cwd(), file).replaceAll('\\', '/'));
}

async function clearAndOpen(page, viewport = { width: 1440, height: 1000 }) {
  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('body[data-view="empty"]').waitFor();
}

async function bootstrap(page, workId = null) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/bootstrap${id ? `?work_id=${encodeURIComponent(id)}` : ''}`);
    return response.json();
  }, workId);
}

async function generateFromCurrentView(page, instruction) {
  const input = page.locator('#ideaInput, #composerInput').first();
  await input.fill(instruction);
  await page.locator('[data-action="generate"]').last().click();
  await page.waitForTimeout(25);
  await page.waitForFunction(() => !['loading', 'generating'].includes(document.body.dataset.view), null, { timeout: 15000 });
}

async function waitForCandidateStatus(page, text) {
  await page.locator('.candidate-banner').waitFor({ timeout: 15000 });
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
}

async function adopt(page) {
  const button = page.locator('[data-action="adopt-candidate"]').last();
  check('adopt_button_enabled_' + Object.keys(results.checks).length, await button.isEnabled(), await button.getAttribute('title'));
  await button.click();
  await page.getByText('候选已经采用为当前正文', { exact: false }).waitFor({ timeout: 10000 });
}

async function showEditor(page) {
  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('#bodyEditor').waitFor();
}

async function bindSelection(page, operation, needle) {
  const editor = page.locator('#bodyEditor');
  const value = await editor.inputValue();
  const start = value.indexOf(needle);
  check(`${operation.toLowerCase()}_needle_found`, start >= 0, needle);
  const end = start + needle.length;
  await editor.evaluate((element, range) => {
    element.focus();
    element.setSelectionRange(range.start, range.end);
    element.dispatchEvent(new Event('select', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { start, end });
  const toolbarButton = page.locator(`[data-selection-action="${operation}"]`);
  await toolbarButton.waitFor();
  await toolbarButton.click();
  await page.locator('.selection-binding').waitFor();
  const bindingText = await page.locator('.selection-binding').innerText();
  check(`${operation.toLowerCase()}_utf16_binding`, bindingText.includes(`UTF-16 ${start}–${end}`), bindingText);
  return { value, start, end };
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') (results.console_errors ||= []).push(message.text());
});

try {
  await clearAndOpen(page);
  const emptyBootstrap = await bootstrap(page);
  check('missing_work_id_returns_empty', emptyBootstrap.work === null && emptyBootstrap.versions.length === 0);

  await generateFromCurrentView(page, '生成一篇婚礼前夜的信息差短剧，林晚已经知道真相但暂不摊牌。');
  await waitForCandidateStatus(page, '检查通过');
  const createUrl = new URL(page.url());
  const workId = createUrl.searchParams.get('work_id');
  check('create_assigns_explicit_work_id', Boolean(workId), page.url());
  check('create_candidate_not_current_before_adopt', (await bootstrap(page, workId)).current_version === null);
  await screenshot(page, '01-create-candidate-1440.png');

  await page.reload({ waitUntil: 'networkidle' });
  await waitForCandidateStatus(page, '检查通过');
  check('refresh_restores_candidate', await page.locator('body').getAttribute('data-view') === 'candidate', 'candidate view restored from latest_task');
  await adopt(page);
  const adoptedCreate = await bootstrap(page, workId);
  check('create_adopt_confirmed_by_server', adoptedCreate.current_version?.status === 'adopted', adoptedCreate.current_version?.id);
  await screenshot(page, '02-create-adopted-1440.png');

  await showEditor(page);
  const expandNeedle = '门被推开时，苏晴先看了桌面一眼。';
  const expandRange = await bindSelection(page, 'EXPAND', expandNeedle);
  await screenshot(page, '03-expand-selection-binding-1440.png');
  await generateFromCurrentView(page, '扩写两个人互相试探的动作和对白，不要立即摊牌。');
  await waitForCandidateStatus(page, '检查通过');
  const afterExpand = await bootstrap(page, workId);
  const expandCandidate = afterExpand.versions.find((version) => version.id === afterExpand.latest_task.result_version_id);
  check('expand_prefix_unchanged', expandCandidate.content.slice(0, expandRange.start) === expandRange.value.slice(0, expandRange.start));
  check('expand_suffix_unchanged', expandCandidate.content.slice(expandRange.start + expandCandidate.generated_segment.length) === expandRange.value.slice(expandRange.end));
  await screenshot(page, '04-expand-candidate-1440.png');
  await adopt(page);

  await showEditor(page);
  const rewriteNeedle = '两个人都没有再看那部手机。';
  await bindSelection(page, 'REWRITE', rewriteNeedle);
  await generateFromCurrentView(page, '改写得更克制，保持两个人都没有摊牌。');
  await waitForCandidateStatus(page, '检查通过');
  await page.locator('[data-action="show-compare"]').last().click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.locator('.compare-surface').waitFor();
  const compareMetrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    changed: document.querySelectorAll('.diff-cell.changed').length,
    unchanged: document.querySelectorAll('.diff-cell.unchanged').length,
    labels: [...document.querySelectorAll('.diff-cell')].every((element) => Boolean(element.getAttribute('data-change-label')))
  }));
  check('compare_1024_no_horizontal_overflow', compareMetrics.scrollWidth <= compareMetrics.clientWidth, compareMetrics);
  check('compare_distinguishes_changed_and_unchanged', compareMetrics.changed > 0 && compareMetrics.unchanged > 0 && compareMetrics.labels, compareMetrics);
  await screenshot(page, '05-rewrite-compare-1024.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="show-candidate"]').first().click();
  await adopt(page);

  await showEditor(page);
  await page.locator('[data-operation="CONTINUE"]').click();
  await generateFromCurrentView(page, '从第二天开始续写，承接婚礼取消后的后果，不复述前文。');
  await waitForCandidateStatus(page, '检查通过');
  const afterContinue = await bootstrap(page, workId);
  const continueCandidate = afterContinue.versions.find((version) => version.id === afterContinue.latest_task.result_version_id);
  const continueSource = afterContinue.versions.find((version) => version.id === continueCandidate.parent_version_id);
  check('continue_appends_without_rewriting_source', continueCandidate.content.startsWith(continueSource.content) && continueCandidate.content.length > continueSource.content.length);
  await screenshot(page, '06-continue-candidate-1440.png');
  await adopt(page);

  await clearAndOpen(page);
  await generateFromCurrentView(page, 'QA_BLOCK 扩写酒店环境，但父亲已经去世五年，必须保留这个事实。');
  await waitForCandidateStatus(page, '检查阻断');
  const blockedButton = page.locator('[data-action="adopt-candidate"]').last();
  check('validator_block_disables_adopt', await blockedButton.isDisabled(), await blockedButton.getAttribute('title'));
  await screenshot(page, '07-validator-blocked-1440.png');

  await clearAndOpen(page);
  await generateFromCurrentView(page, 'QA_VALIDATOR_FAIL 生成一篇用于检查服务不可用状态的短剧。');
  await waitForCandidateStatus(page, '检查不可用');
  check('validator_unavailable_disables_adopt', await page.locator('[data-action="retry-validation"]').last().isEnabled());
  await screenshot(page, '08-validator-unavailable-1440.png');

  await clearAndOpen(page);
  await generateFromCurrentView(page, 'QA_PROVIDER_FAIL 保留这条输入并模拟文本服务失败。');
  check('provider_failure_preserves_input', (await page.locator('#ideaInput').inputValue()).includes('QA_PROVIDER_FAIL'));
  check('provider_failure_has_visible_error', (await page.locator('body').innerText()).includes('操作未完成') || (await page.locator('#toast').innerText()).length > 0);
  await screenshot(page, '09-provider-failure-retains-input-1440.png');

  await clearAndOpen(page);
  await generateFromCurrentView(page, 'QA_SLOW 建立一个用于来源版本并发保护的短剧。');
  await waitForCandidateStatus(page, '检查通过');
  const conflictWorkId = new URL(page.url()).searchParams.get('work_id');
  await adopt(page);
  await showEditor(page);
  const beforeRace = await bootstrap(page, conflictWorkId);
  await page.locator('[data-operation="REWRITE"]').click();
  await page.locator('#composerInput').fill('QA_SLOW 整篇改写，但必须基于当前来源版本。');
  const writeRequest = page.waitForRequest((request) => request.url().includes('/write') && request.method() === 'POST');
  await page.locator('[data-action="generate"]').last().click();
  await writeRequest;
  const raceSave = await context.request.post(`${baseUrl}/api/versions/save`, { data: {
    work_id: conflictWorkId,
    source_version_id: beforeRace.current_version.id,
    title: beforeRace.current_version.title,
    content: `${beforeRace.current_version.content}\n\n（并发保存的新版本）`
  }});
  check('race_manual_save_succeeds', raceSave.ok(), raceSave.status());
  await waitForCandidateStatus(page, '来源版本冲突');
  check('source_conflict_disables_adopt', await page.locator('[data-action="adopt-candidate"]').last().isDisabled());
  await screenshot(page, '10-source-version-conflict-1440.png');

  await clearAndOpen(page);
  await generateFromCurrentView(page, 'QA_LONG 生成用于长篇候选阅读和移动端滚动检查的正文。');
  await waitForCandidateStatus(page, '检查通过');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  const mobileMetrics = await page.evaluate(() => {
    const review = document.querySelector('.review-actions');
    const button = document.querySelector('[data-action="adopt-candidate"]');
    const toast = document.querySelector('#toast');
    const rect = button?.getBoundingClientRect();
    const toastRect = toast?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      atBottom: Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight,
      buttonVisible: Boolean(rect && rect.bottom <= window.innerHeight && rect.top >= 0),
      toastOverlapsButton: Boolean(rect && toastRect && toast.classList.contains('show')
        && rect.left < toastRect.right && rect.right > toastRect.left && rect.top < toastRect.bottom && rect.bottom > toastRect.top),
      reviewPosition: review ? getComputedStyle(review).position : null,
      safePadding: review ? getComputedStyle(review).paddingBottom : null
    };
  });
  check('mobile_390_no_horizontal_overflow', mobileMetrics.scrollWidth <= mobileMetrics.clientWidth, mobileMetrics);
  check('mobile_candidate_end_reachable', mobileMetrics.atBottom && mobileMetrics.buttonVisible && !mobileMetrics.toastOverlapsButton, mobileMetrics);
  await screenshot(page, '11-mobile-candidate-end-390.png', { fullPage: false });

  await adopt(page);
  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('#composerInput').focus();
  await page.locator('#composerInput').evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { data: '续' }));
    element.value = '续写下一幕';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '续写下一幕' }));
    element.dispatchEvent(new CompositionEvent('compositionend', { data: '续写下一幕' }));
  });
  check('mobile_ime_composition_retains_input', (await page.locator('#composerInput').inputValue()) === '续写下一幕');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 500));
  const headerMetrics = await page.evaluate(() => {
    const app = document.querySelector('.app-header');
    const documentHeader = document.querySelector('.document-header');
    return {
      appBackground: getComputedStyle(app).backgroundColor,
      appPosition: getComputedStyle(app).position,
      appZIndex: getComputedStyle(app).zIndex,
      documentBackground: documentHeader ? getComputedStyle(documentHeader).backgroundColor : null,
      documentPosition: documentHeader ? getComputedStyle(documentHeader).position : null
    };
  });
  check('fixed_headers_are_opaque', !headerMetrics.appBackground.includes('rgba') && !String(headerMetrics.documentBackground).includes('rgba'), headerMetrics);

  const workA = `work_ui_v21_iso_a_${Date.now()}`;
  const workB = `work_ui_v21_iso_b_${Date.now()}`;
  const saveA = await context.request.post(`${baseUrl}/api/versions/save`, { data: { work_id: workA, title: '隔离作品 A', content: '只属于作品 A 的正文。' } });
  const saveB = await context.request.post(`${baseUrl}/api/versions/save`, { data: { work_id: workB, title: '隔离作品 B', content: '只属于作品 B 的正文。' } });
  check('isolation_fixtures_created', saveA.ok() && saveB.ok());
  const isolatedA = await (await context.request.get(`${baseUrl}/api/bootstrap?work_id=${workA}`)).json();
  const isolatedB = await (await context.request.get(`${baseUrl}/api/bootstrap?work_id=${workB}`)).json();
  const isolatedNone = await (await context.request.get(`${baseUrl}/api/bootstrap`)).json();
  check('work_a_does_not_expose_work_b', isolatedA.versions.every((version) => version.work_id === workA) && !JSON.stringify(isolatedA).includes('隔离作品 B'));
  check('work_b_does_not_expose_work_a', isolatedB.versions.every((version) => version.work_id === workB) && !JSON.stringify(isolatedB).includes('隔离作品 A'));
  check('no_global_latest_work_fallback', isolatedNone.work === null && isolatedNone.versions.length === 0);

  results.completed_at = new Date().toISOString();
  results.console_errors = results.console_errors || [];
  results.expected_console_errors = results.console_errors.filter((message) => message.includes('502'));
  results.unexpected_console_errors = results.console_errors.filter((message) => !message.includes('502'));
  check('no_unexpected_browser_console_errors', results.unexpected_console_errors.length === 0, results.unexpected_console_errors);
  await writeFile(path.resolve('reports/ui-v2-1-integration/browser-qa-results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

console.log(JSON.stringify({ passed: Object.values(results.checks).every((item) => item.passed), checks: Object.keys(results.checks).length, screenshots: results.screenshots.length }, null, 2));
