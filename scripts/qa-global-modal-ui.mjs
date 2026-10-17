import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const phase = ['before', 'other'].includes(process.argv[2]) ? process.argv[2] : 'after';
const executable = process.env.DRAMAGO_UI_QA_EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!executable) throw new Error('Set DRAMAGO_UI_QA_EXE to the installed V1.4 executable for the before run.');
const packaged = Boolean(process.env.DRAMAGO_UI_QA_EXE);
const runRoot = await mkdtemp(path.join(root, '.cache', `global-modal-${phase}-`));
const dataRoot = path.join(runRoot, 'data');
const userData = path.join(runRoot, 'electron-user-data');
const statusFile = path.join(runRoot, 'status.json');
const output = process.env.DRAMAGO_UI_QA_OUTPUT || path.join(root, 'reports', 'windows-v1-4-global-modal-ui-repair');
await mkdir(output, { recursive: true });
if (phase === 'other') {
  const fixture = process.env.DRAMAGO_UI_QA_FIXTURE_DATA;
  if (!fixture || !path.resolve(fixture).startsWith(`${path.resolve(root, '.cache')}${path.sep}`)) {
    throw new Error('DRAMAGO_UI_QA_FIXTURE_DATA must be a prior synthetic QA data directory under .cache.');
  }
  await cp(path.join(fixture, 'data'), path.join(dataRoot, 'data'), { recursive: true });
  await cp(path.join(fixture, 'config'), path.join(dataRoot, 'config'), { recursive: true });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const port = await freePort();
const desktop = spawn(executable, [
  ...(packaged ? [] : ['.']),
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`
], {
  cwd: packaged ? path.dirname(executable) : root,
  windowsHide: true,
  stdio: 'ignore',
  env: { ...process.env, DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: userData,
    DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_INTERNAL_QA: '1' }
});

const evidence = { phase, executable, data_root: dataRoot, screenshots: [], layouts: [], checks: [] };
let browser;
function check(name, passed, details = null) {
  evidence.checks.push({ name, passed: Boolean(passed), details });
  if (!passed) throw new Error(`${name}: ${JSON.stringify(details)}`);
}
async function capture(page, name) {
  if (await page.locator('#modalLayer .modal').isVisible().catch(() => false)) await page.waitForTimeout(240);
  const filename = path.join(output, `${phase}-${name}.png`);
  await page.screenshot({ path: filename });
  evidence.screenshots.push(filename);
}
async function measure(page, name) {
  if (await page.locator('#modalLayer .modal').isVisible().catch(() => false)) await page.waitForTimeout(220);
  const result = await page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const style = (element) => {
      if (!element) return null;
      const s = getComputedStyle(element);
      return { display: s.display, fontSize: s.fontSize, lineHeight: s.lineHeight,
        padding: s.padding, boxSizing: s.boxSizing, overflow: s.overflow, flexDirection: s.flexDirection,
        gridTemplateColumns: s.gridTemplateColumns };
    };
    const modal = document.querySelector('#modalLayer .modal');
    const label = modal?.querySelector('.settings-field');
    const input = label?.querySelector('input, textarea, select');
    const footer = modal?.querySelector('.modal-actions');
    const buttons = [...(footer?.querySelectorAll('button') || [])];
    return {
      viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
      modal: { rect: rect(modal), style: style(modal) },
      top: { rect: rect(modal?.querySelector('.modal-top')), style: style(modal?.querySelector('.modal-top')) },
      label: { rect: rect(label), style: style(label) },
      labelText: { rect: rect(label?.querySelector('span, label')), style: style(label?.querySelector('span, label')) },
      input: { rect: rect(input), style: style(input) },
      footer: { rect: rect(footer), style: style(footer) },
      buttons: buttons.map((button) => ({ rect: rect(button), style: style(button), visible: button.getClientRects().length > 0 })),
      focusedInput: document.activeElement === input
    };
  });
  evidence.layouts.push({ name, ...result });
  return result;
}

try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('isolated_electron_window_ready', ready);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  check('real_workbench_page_loaded', Boolean(page));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('[data-action="new-work"]').first().click();
  await page.locator('#newWorkName').waitFor();
  await page.locator('#newWorkName').evaluate((input) => input.blur());
  const initial = await measure(page, 'new-work-normal-1366');
  await capture(page, 'new-work-normal-1366');
  if (phase === 'after') {
    check('new_work_normal_state_not_focused', !initial.focusedInput);
    const aligned = (layout) => Math.abs(layout.labelText.rect.x - layout.input.rect.x) <= 1;
    const contained = (layout) => layout.input.rect.x >= layout.modal.rect.x + 16
      && layout.input.rect.right <= layout.modal.rect.right - 16;
    const footerVisible = (layout) => layout.buttons.every((button) => button.visible
      && button.rect.x >= layout.modal.rect.x && button.rect.right <= layout.modal.rect.right
      && button.rect.y >= layout.modal.rect.y && button.rect.bottom <= layout.modal.rect.bottom);
    check('new_work_label_input_aligned', aligned(initial), initial);
    check('new_work_input_has_safe_padding', contained(initial), initial);
    check('new_work_footer_buttons_visible', footerVisible(initial), initial);
    for (const width of [1024, 768, 480]) {
      await page.setViewportSize({ width, height: width === 480 ? 800 : 900 });
      const layout = await measure(page, `new-work-normal-${width}`);
      await capture(page, `new-work-normal-${width}`);
      check(`new_work_layout_${width}`, aligned(layout) && contained(layout) && footerVisible(layout)
        && layout.viewport.documentWidth <= width + 1, layout);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator('#newWorkName').focus();
    await capture(page, 'new-work-focus-1366');
    await page.locator('#modalLayer .modal-actions [data-action="close-modal"]').click();
    check('new_work_cancel_closes_without_creation', await page.locator('#modalLayer').isHidden());
    const cancelledDb = new DatabaseSync(path.join(dataRoot, 'data', 'dramago.sqlite'), { readOnly: true });
    const cancelledWorks = cancelledDb.prepare('SELECT COUNT(*) AS count FROM works').get().count;
    cancelledDb.close();
    check('cancel_did_not_create_work', cancelledWorks === 0, { works: cancelledWorks });
    await page.locator('[data-action="new-work"]').first().click();
    await page.locator('[data-action="confirm-new-work"]').click();
    await capture(page, 'new-work-error-1366');
    check('empty_name_stays_in_modal', await page.locator('#newWorkName').isVisible());
    await page.locator('#newWorkName').fill('中文标题：一个很长很长的作品名称，用来检查输入框边界与按钮布局。'.repeat(3));
    await capture(page, 'new-work-long-name-1366');
    await page.locator('#newWorkName').fill('');
    await page.keyboard.insertText('弹窗隔离验收作品');
    check('chinese_text_input_retained', await page.locator('#newWorkName').inputValue() === '弹窗隔离验收作品');
    await page.locator('[data-action="confirm-new-work"]').click();
    await page.locator('#modalLayer').waitFor({ state: 'hidden' });
    check('blank_work_created_without_ai', await page.locator('#headerWorkTitle').textContent() === '弹窗隔离验收作品');
    const db = new DatabaseSync(path.join(dataRoot, 'data', 'dramago.sqlite'), { readOnly: true });
    const blank = db.prepare('SELECT id, current_version_id FROM works WHERE title = ?').get('弹窗隔离验收作品');
    const versions = db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').get(blank?.id || '').count;
    const tasks = db.prepare('SELECT COUNT(*) AS count FROM generation_tasks WHERE work_id = ?').get(blank?.id || '').count;
    db.close();
    check('blank_work_persisted_without_version_or_ai_task', Boolean(blank) && blank.current_version_id === null
      && versions === 0 && tasks === 0, { persisted: Boolean(blank), versions, tasks });
    await page.locator('[data-action="open-work-switcher"]').first().click();
    check('new_work_in_switcher', await page.getByText('弹窗隔离验收作品', { exact: true }).count() >= 1);
    await page.locator('[data-action="rename-work"]').click();
    const rename = await measure(page, 'rename-work-1366');
    await capture(page, 'rename-work-1366');
    check('rename_work_layout', aligned(rename) && contained(rename) && footerVisible(rename), rename);
    await page.locator('#modalLayer .modal-close').click();
    check('top_close_button_closes_modal', await page.locator('#modalLayer').isHidden());
    await page.locator('[data-action="close-overlay"]').click();
    await page.locator('[data-action="open-settings"]').first().click();
    await page.locator('[data-action="start-add-provider"]').click();
    await page.locator('#providerNameSetting').waitFor();
    await capture(page, 'add-provider-1366');
    await page.locator('#providerKeySetting').scrollIntoViewIfNeeded();
    await capture(page, 'add-provider-key-area-1366');
    await page.locator('[data-action="save-provider-settings"]').scrollIntoViewIfNeeded();
    await capture(page, 'add-provider-actions-1366');
    await page.locator('[data-action="cancel-provider-editor"]').click();
    await page.locator('[data-action="edit-provider"]').first().click();
    await page.locator('#providerNameSetting').waitFor();
    await capture(page, 'edit-provider-1366');
    await page.locator('[data-action="save-provider-settings"]').scrollIntoViewIfNeeded();
    await capture(page, 'edit-provider-actions-1366');
    await page.locator('[data-action="cancel-provider-editor"]').click();
    await page.locator('[data-action="request-delete-provider"]').first().click();
    await capture(page, 'delete-provider-confirmation-1366');
    check('delete_confirmation_does_not_delete_service', await page.locator('#modalLayer').isVisible());
    await page.locator('#modalLayer .modal-actions [data-action="close-modal"]').click();
  }
  if (phase === 'other') {
    const db = new DatabaseSync(path.join(dataRoot, 'data', 'dramago.sqlite'), { readOnly: true });
    const work = db.prepare('SELECT id FROM works WHERE title = ?').get('边界上的灯');
    const candidates = work ? db.prepare('SELECT id, validation_status FROM versions WHERE work_id = ? AND status = ?').all(work.id, 'candidate') : [];
    db.close();
    check('synthetic_fixture_work_found', Boolean(work));
    await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(work.id)}`);
    await page.locator('[data-action="show-overview"]').first().click();
    await page.locator('[data-action="add-memory-relationship"]').click();
    const relationship = await measure(page, 'add-relationship-1366');
    await capture(page, 'add-relationship-1366');
    check('relationship_form_is_aligned', Math.abs(relationship.labelText.rect.x - relationship.input.rect.x) <= 1);
    await page.locator('#modalLayer .modal-close').click();
    await page.locator('[data-memory-action="correct"]').first().click();
    const correction = await measure(page, 'memory-correction-1366');
    await capture(page, 'memory-correction-1366');
    check('memory_correction_form_is_aligned', Math.abs(correction.labelText.rect.x - correction.input.rect.x) <= 1);
    await page.locator('#modalLayer .modal-close').click();
    await page.locator('[data-action="request-complete-work"]').first().click();
    await capture(page, 'work-completion-confirmation-1366');
    await page.locator('#modalLayer .modal-actions [data-action="close-modal"]').click();
    const unavailable = candidates.find((item) => item.validation_status === 'unavailable');
    const blocked = candidates.find((item) => item.validation_status === 'blocked');
    check('synthetic_unavailable_and_blocked_candidates_found', Boolean(unavailable && blocked),
      { statuses: candidates.map((item) => item.validation_status) });
    await page.locator('[data-action="open-history"]').first().click();
    await page.locator(`[data-version-id="${unavailable.id}"]`).click();
    const retry = page.locator('[data-action="retry-validation"]');
    await retry.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await retry.count() && await retry.first().isVisible()) {
      await retry.first().click();
      await capture(page, 'validator-retry-confirmation-1366');
      const modal = await page.evaluate(() => ({ title: document.querySelector('#modalLayer h2')?.textContent,
        fee: document.querySelector('#modalLayer .revalidation-consent')?.textContent,
        footer: [...document.querySelectorAll('#modalLayer .modal-actions button')].map((button) => button.getBoundingClientRect().toJSON()) }));
      check('validator_fee_disclosure_visible', modal.fee?.includes('费用') && modal.footer.length === 2, modal);
      await page.locator('#modalLayer .modal-close').click();
    } else {
      check('validator_retry_fixture_available', false, 'Saved unavailable candidate did not expose its confirmation control.');
    }
    await page.locator('[data-action="open-history"]').first().click();
    await page.locator(`[data-version-id="${blocked.id}"]`).click();
    const revalidate = page.locator('[data-action="request-candidate-revalidation"]');
    await revalidate.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    check('blocked_candidate_revalidation_available', await revalidate.isVisible(), {
      candidate_label: await page.locator('.candidate-banner .status-badge').textContent().catch(() => null),
      action: await page.locator('.review-actions .primary-button').getAttribute('data-action').catch(() => null)
    });
    await revalidate.click();
    await capture(page, 'blocked-candidate-revalidation-1366');
    const disclosure = await page.locator('.revalidation-consent').textContent();
    const feeNotice = await page.locator('.revalidation-modal .modal-note').textContent();
    check('revalidation_discloses_third_party_and_cost', disclosure.includes('第三方 AI 服务商')
      && feeNotice.includes('费用') && feeNotice.includes('不会自动重发'));
    let attemptedRevalidation = 0;
    const countRequest = (request) => {
      if (request.url().includes('/revalidate')) attemptedRevalidation++;
    };
    page.on('request', countRequest);
    await page.locator('[data-action="confirm-candidate-revalidation"]').click();
    await page.waitForTimeout(150);
    page.off('request', countRequest);
    check('unchecked_disclosure_cannot_start_request', attemptedRevalidation === 0
      && await page.locator('#modalLayer .revalidation-modal').isVisible());
    check('inline_consent_error_replaces_obscuring_toast', await page.locator('#revalidationDisclosureError').isVisible()
      && (await page.locator('#revalidationDisclosureError').textContent()).includes('第三方内容发送及可能产生的费用')
      && await page.locator('#revalidationDisclosure').getAttribute('aria-describedby') === 'revalidationDisclosureError'
      && await page.locator('#revalidationDisclosure').getAttribute('aria-invalid') === 'true'
      && !await page.locator('#toast').evaluate((element) => element.classList.contains('show')));
    const scope = await measure(page, 'blocked-candidate-revalidation-1366');
    check('revalidation_select_inside_modal', scope.input.rect.x >= scope.modal.rect.x + 16
      && scope.input.rect.right <= scope.modal.rect.right - 16, scope);
    await page.setViewportSize({ width: 480, height: 800 });
    await capture(page, 'D-blocked-candidate-inline-error-480');
    const mobile = await measure(page, 'blocked-candidate-revalidation-480');
    check('mobile_revalidation_actions_visible', mobile.modal.rect.y >= 0
      && mobile.modal.rect.bottom <= 800 && mobile.buttons.every((button) => button.visible
        && button.rect.bottom <= mobile.modal.rect.bottom), mobile);
    const consentArea = await page.locator('.revalidation-consent').boundingBox();
    check('mobile_consent_touch_area', consentArea.height >= 44, consentArea);
    const inlineFeedbackLayout = await page.evaluate(() => {
      const consent = document.querySelector('.revalidation-consent').getBoundingClientRect();
      const error = document.querySelector('#revalidationDisclosureError').getBoundingClientRect();
      const footer = document.querySelector('.revalidation-modal .modal-actions').getBoundingClientRect();
      return { consent: consent.toJSON(), error: error.toJSON(), footer: footer.toJSON() };
    });
    check('inline_error_does_not_overlap_label_or_actions', inlineFeedbackLayout.consent.bottom <= inlineFeedbackLayout.error.top
      && inlineFeedbackLayout.error.bottom <= inlineFeedbackLayout.footer.top, inlineFeedbackLayout);
    await page.locator('#revalidationDisclosure').focus();
    await page.keyboard.press('Space');
    check('keyboard_consent_clears_inline_error', await page.locator('#revalidationDisclosure').isChecked()
      && await page.locator('#revalidationDisclosureError').isHidden()
      && attemptedRevalidation === 0);
    await page.locator('#modalLayer .modal-close').click();
    check('revalidation_close_without_call', await page.locator('#modalLayer').isHidden());
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator('[data-action="show-editor"]').first().click();
    if (await page.locator('.composer-expand').isVisible()) await page.locator('.composer-expand').click();
    await page.locator('[data-operation="CREATE"]').click();
    await page.locator('#composerInput').fill('建立一篇新的完整候选，仅用于弹窗布局检查。');
    await page.locator('[data-action="generate"]').click();
    await capture(page, 'full-replacement-confirmation-1366');
    check('full_replacement_stops_before_ai_call', await page.locator('#fullReplacementTitle').isVisible());
    await page.locator('#modalLayer .modal-actions [data-action="close-modal"]').click();
  }
} finally {
  await writeFile(path.join(output, `${phase}-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser?.close().catch(() => {});
  if (desktop.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
}
console.log(JSON.stringify({ phase, screenshots: evidence.screenshots.length, layouts: evidence.layouts.length,
  checks: evidence.checks.length, evidence_file: path.join(output, `${phase}-evidence.json`) }));
