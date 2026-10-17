// Audit-only fault injection. Uses a ZIP-extracted EXE and disposable user data.
import { createServer } from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';
import { localPaths } from '../local/paths.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const development = process.env.DRAMAGO_DRAFT_CRASH_DEV === '1';
const archive = development ? null : process.env.DRAMAGO_ACCEPTANCE_ZIP || path.join(root, 'artifacts/windows/DramaGo-v1.4-windows-x64-internal-universal-recovery-final.zip');
const runRoot = path.join(root, '.cache', `draft-crash-${Date.now()}`);
const packageRoot = path.join(runRoot, 'package');
const reportDir = path.join(root, 'reports/final-consolidated-remediation/draft-crash');
await mkdir(reportDir, { recursive: true });
if (!development) {
  await mkdir(packageRoot, { recursive: true });
  const unpack = spawnSync('tar.exe', ['-xf', archive, '-C', packageRoot], { encoding: 'utf8', windowsHide: true });
  if (unpack.status !== 0) throw new Error(`ZIP extraction failed: ${unpack.stderr}`);
}
const executable = development ? path.join(root, 'node_modules/electron/dist/electron.exe')
  : path.join(packageRoot, 'DramaGo-win32-x64/DramaGo.exe');

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launch({ dataRoot, userData, statusFile, port }) {
  await rm(statusFile, { force: true });
  const desktop = spawn(executable, [...(development ? ['.'] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    cwd: development ? root : path.dirname(executable), windowsHide: true, stdio: 'ignore', env: {
      ...process.env, DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: userData,
      DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_INTERNAL_QA: '1'
    }
  });
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
        if (page) return { desktop, browser, page };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Packaged Electron did not become ready.');
}

async function killTree(desktop) {
  if (desktop?.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  const killedAt = Date.now();
  if (desktop && desktop.exitCode == null) await Promise.race([
    new Promise((resolve) => desktop.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
  return killedAt;
}

const results = [];
for (const delayMs of [0, 100, 400, 800]) {
  const caseRoot = path.join(runRoot, `delay-${delayMs}`);
  const dataRoot = path.join(caseRoot, 'data');
  const userData = path.join(caseRoot, 'electron-user-data');
  const statusFile = path.join(caseRoot, 'status.json');
  await mkdir(caseRoot, { recursive: true });
  const port = await freePort();
  let session;
  try {
    session = await launch({ dataRoot, userData, statusFile, port });
    const { page } = session;
    await page.locator('[data-action="new-work"]').first().click();
    await page.locator('#newWorkName').fill(`草稿即时退出-${delayMs}`);
    await page.locator('[data-action="confirm-new-work"]').click();
    await page.locator('#bodyEditor').waitFor();
    const workId = new URL(page.url()).searchParams.get('work_id');
    await page.locator('#bodyEditor').fill('较旧但已提交的 SQLite 草稿');
    await page.waitForTimeout(850);
    const paths = localPaths(dataRoot);
    const beforeDb = new SQLiteD1(paths.database);
    const oldRow = await beforeDb.prepare('SELECT body, revision FROM work_edit_drafts WHERE work_id = ?').bind(workId).first();
    beforeDb.close();
    const latest = `输入后${delayMs}ms强制退出的新草稿`;
    const before = await page.evaluate((text) => {
      const input = document.querySelector('#bodyEditor');
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const key = Object.keys(localStorage).find((candidate) => candidate.includes(new URL(location.href).searchParams.get('work_id')));
      return { at: Date.now(), value: input.value, key, stored: key ? JSON.parse(localStorage.getItem(key)) : null };
    }, latest);
    if (delayMs) await page.waitForTimeout(delayMs);
    const killedAt = await killTree(session.desktop);
    session.browser = null;
    const elapsedToKill = killedAt - before.at;
    const afterDb = new SQLiteD1(paths.database);
    const rowAfterKill = await afterDb.prepare('SELECT body, revision FROM work_edit_drafts WHERE work_id = ?').bind(workId).first();
    afterDb.close();
    session = await launch({ dataRoot, userData, statusFile, port });
    await session.page.goto(`${new URL(session.page.url()).origin}/?work_id=${encodeURIComponent(workId)}`);
    await session.page.locator('#bodyEditor').waitFor();
    const restored = await session.page.locator('#bodyEditor').inputValue();
    const storage = await session.page.evaluate((key) => key ? JSON.parse(localStorage.getItem(key) || 'null') : null, before.key);
    results.push({ delay_ms: delayMs, actual_elapsed_to_kill_ms: elapsedToKill, work_id: workId,
      local_storage_before_kill: { body: before.stored?.body, operation: before.stored?.operation,
        draft_revision: before.stored?.draftRevision, based_on_version_id: before.stored?.basedOnVersionId },
      sqlite_before: oldRow, sqlite_after_kill: rowAfterKill,
      local_storage_after_restart: { body: storage?.body, operation: storage?.operation,
        draft_revision: storage?.draftRevision, based_on_version_id: storage?.basedOnVersionId },
      restored_body: restored, latest_input_preserved: restored === latest });
  } catch (error) {
    results.push({ delay_ms: delayMs, error: error.message });
  } finally {
    await session?.browser?.close().catch(() => {});
    await killTree(session?.desktop);
  }
}
const report = { archive, executable, environment: development
  ? 'isolated development Electron, isolated SQLite, no Provider call'
  : 'isolated packaged Electron, isolated SQLite, no Provider call', results };
const outputName = process.env.DRAMAGO_DRAFT_CRASH_RESULT_NAME || 'draft-crash-before-fix.json';
await writeFile(path.join(reportDir, outputName), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
