import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { normalizeStoryMemory } from '../worker/core.mjs';

const root = process.cwd();
const output = process.env.DRAMAGO_FINAL_QA_OUTPUT
  ? path.resolve(process.env.DRAMAGO_FINAL_QA_OUTPUT)
  : path.join(root, 'reports', 'windows-v1-4-final-visual-gate-closure');
const runRoot = await mkdtemp(path.join(root, '.cache', 'final-ui-electron-'));
const dataRoot = path.join(runRoot, 'data');
const statusFile = path.join(runRoot, 'status.json');
const userData = path.join(runRoot, 'electron-user-data');
const screenshots = [];
const checks = [];
await mkdir(output, { recursive: true });
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const executable = process.env.DRAMAGO_FINAL_QA_EXE
  ? path.resolve(process.env.DRAMAGO_FINAL_QA_EXE)
  : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const packaged = Boolean(process.env.DRAMAGO_FINAL_QA_EXE);
const desktop = spawn(executable, [...(packaged ? [] : ['.']), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: packaged ? path.dirname(executable) : root, windowsHide: true, stdio: 'ignore', env: { ...process.env,
    DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: userData,
    DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_INTERNAL_QA: '1' }
});
const execFileAsync = promisify(execFile);
let browser;
function check(name, condition, detail = null) {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) throw new Error(`${name}: ${JSON.stringify(detail)}`);
}
async function capture(page, name) {
  const filename = path.join(output, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: false });
  screenshots.push(filename);
}
async function checkBackButton(page, width) {
  const layout = await page.locator('#sideSheet .sheet-back-button').evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const headerRect = button.closest('.sheet-header').getBoundingClientRect();
    return { width: buttonRect.width, height: buttonRect.height, scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth, right: buttonRect.right, headerRight: headerRect.right,
      whiteSpace: getComputedStyle(button).whiteSpace };
  });
  check(`side_sheet_back_button_single_line_${width}`, layout.width >= 72
    && layout.height >= 36 && layout.scrollWidth <= layout.clientWidth + 1
    && layout.right <= layout.headerRight && layout.whiteSpace === 'nowrap', layout);
}
try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('actual_electron_ready', ready);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find((entry) => entry.url().startsWith('http://127.0.0.1:'));
  check('workbench_loaded', Boolean(page));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('[data-action="new-work"]').first().click();
  await capture(page, 'G-new-work-modal-regression-1366');
  const modalLayout = await page.evaluate(() => {
    const modal = document.querySelector('#modalLayer .modal').getBoundingClientRect();
    const input = document.querySelector('#newWorkName').getBoundingClientRect();
    return { modal: modal.toJSON(), input: input.toJSON() };
  });
  check('new_work_modal_safe_padding', modalLayout.input.x >= modalLayout.modal.x + 16
    && modalLayout.input.right <= modalLayout.modal.right - 16, modalLayout);
  await page.locator('#newWorkName').fill('合成关系树验收｜非真实作品');
  await page.locator('[data-action="confirm-new-work"]').click();
  await page.locator('#bodyEditor').waitFor();
  const content = '林舒的母亲林月来接她。陈建国是林舒的父亲。\n\n林舒向阿坤借了二十万元。\n\n刘哥是林舒的工作搭档。\n\n周磊是林舒多年的朋友。\n\n小孟在公司见到林舒，但两人关系尚未说明。';
  await page.locator('#bodyEditor').fill(content);
  await page.locator('[data-action="save-version"]').click();
  await page.waitForTimeout(2900);
  const database = new DatabaseSync(path.join(dataRoot, 'data', 'dramago.sqlite'));
  const version = database.prepare('SELECT id, work_id, content_hash FROM versions WHERE status = ? ORDER BY created_at DESC LIMIT 1').get('adopted');
  check('synthetic_version_saved', Boolean(version?.id));
  const characters = [
    { id: 'lin', name: '林舒', identity: '主角', relationships: [], quote: '林舒' },
    { id: 'liu', name: '刘哥', identity: '工作搭档', relationships: ['旧提取误标为债务'], quote: '刘哥' },
    { id: 'zhou', name: '周磊', identity: '朋友', relationships: ['旧提取误标为工作'], quote: '周磊' },
    { id: 'mother', name: '林月', identity: '母亲', relationships: ['林舒的母亲'], quote: '林月' },
    { id: 'father', name: '陈建国', identity: '父亲', relationships: ['林舒的父亲'], quote: '陈建国' },
    { id: 'akun', name: '阿坤', identity: '职业待确认', relationships: ['林舒向阿坤借款'], quote: '阿坤' },
    { id: 'meng', name: '小孟', identity: '身份待确认', relationships: [], quote: '小孟', certainty: 'pending' }
  ].map((item) => ({ id: item.id, name: item.name, identity: item.identity,
    relationships: item.relationships, state: '', status: 'active',
    truth_status: item.certainty ? 'interpretation' : 'objective', certainty: item.certainty || 'confirmed',
    time_context: '', evidence: [{ quote: item.quote, start: content.indexOf(item.quote),
      end: content.indexOf(item.quote) + item.quote.length, version_id: version.id }] }));
  const memory = normalizeStoryMemory({ completeness: 'available', characters, events: [], persistent_facts: [], open_threads: [] },
    { content, versionId: version.id });
  const now = new Date().toISOString();
  const memoryUpdate = database.prepare(`UPDATE story_memory_snapshots
    SET memory_json = ?, memory_status = 'available', extraction_source = 'synthetic_qa_fixture', updated_at = ?
    WHERE version_id = ? AND content_hash = ?`).run(JSON.stringify(memory), now, version.id, version.content_hash);
  check('synthetic_snapshot_bound_to_saved_version', memoryUpdate.changes === 1);
  check('no_generation_task_or_paid_call', database.prepare('SELECT COUNT(*) AS count FROM generation_tasks').get().count === 0);
  database.close();

  check('reading_defaults_to_collapsed', await page.locator('.composer-collapsed').isVisible());
  await capture(page, 'E-composer-collapsed-1366');
  await page.locator('[data-action="toggle-composer"]').click();
  await page.locator('#composerInput').fill('从第二天开始，只追加新剧情。');
  await page.locator('[data-operation="CONTINUE"]').click();
  check('composer_operation_continue', await page.locator('[data-operation="CONTINUE"]').getAttribute('class') === 'active');
  await capture(page, 'D-composer-expanded-1366');
  await page.locator('.composer-collapse').click();
  check('collapsed_retains_operation_label', (await page.locator('.composer-collapsed').textContent()).includes('续写'));
  await page.locator('.composer-expand').click();
  check('toggle_retains_draft_and_operation', await page.locator('#composerInput').inputValue() === '从第二天开始，只追加新剧情。'
    && await page.locator('[data-operation="CONTINUE"]').getAttribute('class') === 'active');
  await page.locator('.composer-collapse').click();
  await page.locator('[data-action="show-overview"]').first().click();
  await page.locator('.relationship-tree').waitFor();
  const tree = await page.evaluate(() => {
    const branches = document.querySelector('.relationship-branches');
    const first = branches.querySelector('.relationship-branch');
    return { branchCount: branches.children.length,
      trunk: getComputedStyle(branches, '::before').borderLeftWidth,
      rail: getComputedStyle(branches, '::after').borderTopWidth,
      branch: getComputedStyle(first, '::before').borderLeftWidth,
      documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  check('tree_connectors_visible', tree.branchCount === 5
    && [tree.trunk, tree.rail, tree.branch].every((value) => Number.parseFloat(value) >= 1.5), tree);
  check('tree_no_horizontal_overflow_1366', tree.documentWidth <= tree.viewportWidth + 1, tree);
  const groups = await page.locator('.relationship-branch').allTextContents();
  check('synthetic_relationships_match_evidence', groups[0].includes('林月') && groups[0].includes('陈建国')
    && groups[1].includes('周磊') && groups[2].includes('刘哥') && groups[3].includes('阿坤')
    && groups[4].includes('小孟') && groups[4].includes('待确认'), groups);
  await capture(page, 'A-relationship-tree-expanded-1366');
  await page.locator('.relationship-branch').first().locator('summary').first().click();
  check('branch_can_collapse', await page.locator('.relationship-branch').first().getAttribute('open') === null);
  await capture(page, 'B-relationship-tree-collapsed-1366');
  const branchHeight = await page.locator('.relationship-branch').nth(2).evaluate((element) => element.getBoundingClientRect().height);
  await page.locator('.relationship-branch').nth(2).locator('[data-relationship-person="liu"]').click();
  const detail = await page.locator('#sideSheet').textContent();
  check('person_detail_is_independent_read_only_sheet', await page.locator('#sideSheet').isVisible()
    && detail.includes('工作搭档') && detail.includes('工作关系') && detail.includes('正文证据')
    && detail.includes('V1') && !/ver_[a-z0-9]+/iu.test(detail)
    && await page.locator('.relationship-branch').nth(2).evaluate((element) => element.getBoundingClientRect().height) === branchHeight);
  await capture(page, 'C-relationship-person-side-sheet-1366');
  await page.locator('#sideSheet').evaluate((element) => { element.scrollTop = 70; });
  const detailScroll = await page.locator('#sideSheet').evaluate((element) => element.scrollTop);
  await page.locator('#sideSheet [data-evidence-version]').click();
  check('evidence_is_read_only_without_rewrite', await page.locator('#sideSheet').isVisible()
    && (await page.locator('#sideSheet').textContent()).includes('只读证据')
    && await page.locator('body').getAttribute('data-view') === 'overview'
    && await page.locator('.relationship-tree').isVisible());
  await capture(page, 'C-evidence-read-only-1366');
  await checkBackButton(page, 1366);
  await page.locator('#sideSheet [data-action="close-overlay"]').click();
  check('evidence_returns_to_person_detail', await page.locator('#sideSheet').isVisible()
    && (await page.locator('#sideSheet').textContent()).includes('工作搭档')
    && await page.locator('#sideSheet').evaluate((element) => element.scrollTop) === detailScroll);
  await page.locator('#sideSheet [data-action="close-overlay"]').click();
  check('closing_detail_restores_entire_tree', await page.locator('#sideSheet').isHidden()
    && await page.locator('.relationship-tree').isVisible()
    && await page.locator('.relationship-branch').nth(2).evaluate((element) => element.getBoundingClientRect().height) === branchHeight);
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 850 });
    const layout = await page.evaluate(() => {
      const branch = document.querySelector('.relationship-branch').getBoundingClientRect();
      const summary = document.querySelector('.relationship-branch summary').getBoundingClientRect();
      return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
        branchWidth: branch.width, summaryHeight: summary.height };
    });
    check(`relationship_tree_readable_${width}`, layout.documentWidth <= layout.viewportWidth + 1
      && layout.branchWidth >= 240 && layout.summaryHeight <= 80, layout);
    await capture(page, `relationship-tree-${width}`);
    await page.locator('.relationship-branch').nth(2).locator('[data-relationship-person="liu"]').click();
    await page.locator('#sideSheet [data-evidence-version]').click();
    await checkBackButton(page, width);
    await capture(page, `evidence-back-button-${width}`);
    await page.locator('#sideSheet [data-action="close-overlay"]').click();
    await page.locator('#sideSheet [data-action="close-overlay"]').click();
  }
  await page.setViewportSize({ width: 480, height: 800 });
  const mobile = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    columns: getComputedStyle(document.querySelector('.relationship-branches')).gridTemplateColumns }));
  check('tree_no_horizontal_overflow_480', mobile.documentWidth <= mobile.width + 1, mobile);
  await capture(page, 'F-relationship-tree-narrow-480');
  await page.locator('.relationship-branch').nth(2).locator('[data-relationship-person="liu"]').click();
  await page.locator('#sideSheet [data-evidence-version]').click();
  await checkBackButton(page, 480);
  await capture(page, 'evidence-back-button-480');
  await page.locator('#sideSheet [data-action="close-overlay"]').click();
  await page.locator('#sideSheet [data-action="close-overlay"]').click();
  await page.locator('[data-action="show-editor"]').first().click();
  await page.locator('.composer-expand').click();
  await capture(page, 'F-composer-expanded-narrow-480');
  check('mobile_draft_retained', await page.locator('#composerInput').inputValue() === '从第二天开始，只追加新剧情。');
} finally {
  await writeFile(path.join(output, 'ELECTRON_UI_EVIDENCE.json'), JSON.stringify({ executable, isolated_data: dataRoot,
    screenshots, checks }, null, 2));
  await browser?.close().catch(() => {});
  if (desktop.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
}
console.log(JSON.stringify({ screenshots: screenshots.length, checks: checks.length, output }));
