// Synthetic performance characterization only; never touches the default user data directory.
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const output = process.env.DRAMAGO_PERF_OUTPUT
  ? path.resolve(process.env.DRAMAGO_PERF_OUTPUT)
  : path.join(root, 'reports/final-consolidated-remediation/performance');
await mkdir(output, { recursive: true });
const runRoot = await mkdtemp(path.join(root, '.cache/performance-electron-'));
const dataRoot = path.join(runRoot, 'data');
const userData = path.join(runRoot, 'user-data');
const statusFile = path.join(runRoot, 'status.json');
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const executable = process.env.DRAMAGO_PERF_EXE
  ? path.resolve(process.env.DRAMAGO_PERF_EXE)
  : path.join(root, 'node_modules/electron/dist/electron.exe');
const packaged = Boolean(process.env.DRAMAGO_PERF_EXE);
const desktop = spawn(executable, [...(packaged ? [] : ['.']), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: packaged ? path.dirname(executable) : root, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: userData,
    DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_INTERNAL_QA: '1' }
});
let browser;
try {
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages().find((entry) => entry.url().startsWith('http://127.0.0.1:'));
  if (!page) throw new Error('Electron workbench unavailable');
  await page.locator('[data-action="new-work"]').first().click();
  await page.locator('#newWorkName').fill('合成长篇性能验收');
  await page.locator('[data-action="confirm-new-work"]').click();
  const base = Array.from({ length: 320 }, (_, index) => `第${index + 1}段。人物在城里处理工作、家庭和旧债；这是一段用于阅读与比较耗时测量的合成文字。`).join('\n\n');
  await page.locator('#bodyEditor').fill(base);
  await page.locator('[data-action="save-version"]').click();
  const appSource = await readFile(path.join(root, 'web/app.js'), 'utf8');
  const splitSource = appSource.slice(appSource.indexOf('function splitParagraphs('), appSource.indexOf('\nfunction storyHtml(', appSource.indexOf('function splitParagraphs(')));
  const diffSource = appSource.slice(appSource.indexOf('function paragraphDiffRows('), appSource.indexOf('\nfunction candidateDiffRows(', appSource.indexOf('function paragraphDiffRows(')));
  const result = await page.evaluate(async (base) => {
    const workId = new URL(location.href).searchParams.get('work_id');
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const request = async (pathname, options = {}) => {
      const response = await fetch(pathname, { ...options,
        headers: { 'x-dramago-local-token': token, 'content-type': 'application/json' } });
      if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
      return response.json();
    };
    let current = (await request(`/api/bootstrap?work_id=${encodeURIComponent(workId)}`)).current_version;
    if (!current?.id) throw new Error('Initial manual version was not saved');
    const first = current.content;
    const started = performance.now();
    for (let index = 1; index <= 100; index++) {
      const content = base.replace(`第${index}段。`, `第${index}段：第${index}次修改。`);
      const response = await request('/api/versions/save', { method: 'POST', body: JSON.stringify({
        work_id: workId, source_version_id: current.id, title: '合成长篇性能验收', content
      }) });
      current = response.version;
    }
    const writesMs = performance.now() - started;
    const exportStart = performance.now();
    const exported = await fetch(`/api/local/export?work_id=${encodeURIComponent(workId)}&version_id=${encodeURIComponent(current.id)}`, {
      headers: { 'x-dramago-local-token': token }
    });
    const exportText = await exported.text();
    const exportMs = performance.now() - exportStart;
    return { version_count: 101, characters: current.content.length, paragraph_count: 320,
      write_100_versions_ms: Math.round(writesMs),
      export_ms: Math.round(exportMs), export_http_status: exported.status,
      export_contains_final_text: exportText.includes('第100次修改'), work_id: workId,
      first_content: first, last_content: current.content };
  }, base);
  const paragraphDiffRows = new Function(`${splitSource}\n${diffSource}\nreturn paragraphDiffRows;`)();
  const diffStart = performance.now();
  const diff = paragraphDiffRows(result.first_content, result.last_content);
  result.diff_ms = Math.round(performance.now() - diffStart);
  result.diff_rows = diff.rows.length;
  result.diff_runtime = 'Node.js executing exact current web/app.js paragraphDiffRows source; not a browser render timing';
  delete result.first_content;
  delete result.last_content;
  const loadStart = Date.now();
  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(result.work_id)}`);
  await page.locator('#bodyEditor').waitFor();
  result.bootstrap_render_ms = Date.now() - loadStart;
  const readStart = Date.now();
  await page.locator('#bodyEditor').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  result.read_scroll_ms = Date.now() - readStart;
  delete result.work_id;
  await writeFile(path.join(output, packaged ? 'packaged-performance.json' : 'development-performance.json'),
    `${JSON.stringify({ executable, isolated_data: dataRoot, result }, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await browser?.close().catch(() => {});
  if (desktop.pid) await promisify(execFile)('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
}
