import { createHash } from 'node:crypto';
import { app, BrowserWindow, dialog, session, utilityProcess } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(moduleDirectory, '..');
const utilityRoot = app.isPackaged ? appRoot.replace(/app\.asar$/u, 'app.asar.unpacked') : appRoot;
const compatibilityArgument = process.argv.find((value) => value.startsWith('--desktop-compatibility-output='));
const compatibilityOutput = compatibilityArgument?.slice('--desktop-compatibility-output='.length) || null;
const qaStatusFile = process.env.DRAMAGO_DESKTOP_QA_STATUS || null;
const qaExportDirectory = process.env.DRAMAGO_DESKTOP_QA_EXPORT_DIR || null;
const startupStartedAt = Date.now();

if (process.env.DRAMAGO_ELECTRON_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DRAMAGO_ELECTRON_USER_DATA));
}

let mainWindow = null;
let service = null;
let serviceInfo = null;
let quitting = false;
let serviceStopped = false;

app.setName('DramaGo');
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function utilityEntry(name) {
  return path.join(utilityRoot, 'desktop', 'utility', name);
}

let utilityRuntimeValidated = false;
async function validateUtilityRuntime() {
  if (!app.isPackaged || utilityRuntimeValidated) return;
  const manifest = JSON.parse(await readFile(path.join(appRoot, 'runtime-integrity.json'), 'utf8'));
  for (const [relative, expected] of Object.entries(manifest.files || {})) {
    const absolute = path.resolve(utilityRoot, relative);
    if (!absolute.startsWith(`${path.resolve(utilityRoot)}${path.sep}`)) throw new Error('桌面服务完整性清单包含无效路径。');
    const actual = createHash('sha256').update(await readFile(absolute)).digest('hex');
    if (actual !== expected) throw new Error(`桌面服务完整性校验失败：${relative}`);
  }
  utilityRuntimeValidated = true;
}

async function writeQaStatus(extra = {}) {
  if (!qaStatusFile) return;
  const metrics = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name,
    memory_kb: metric.memory?.workingSetSize ?? null
  }));
  await mkdir(path.dirname(qaStatusFile), { recursive: true });
  await writeFile(qaStatusFile, `${JSON.stringify({
    ready_at: new Date().toISOString(),
    startup_ms: Date.now() - startupStartedAt,
    process_versions: process.versions,
    data_root: process.env.DRAMAGO_DATA_DIR ? 'configured_test_data' : '%APPDATA%\\DramaGo',
    service: serviceInfo ? { port: serviceInfo.port, node: serviceInfo.node, electron: serviceInfo.electron, chrome: serviceInfo.chrome } : null,
    metrics,
    ...extra
  }, null, 2)}\n`);
}

async function runCompatibilityProbe() {
  await validateUtilityRuntime();
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(utilityEntry('compatibility-probe.mjs'), [], {
      cwd: app.isPackaged ? process.resourcesPath : appRoot,
      env: { ...process.env },
      stdio: 'pipe',
      serviceName: 'DramaGo Compatibility Probe'
    });
    let settled = false;
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Electron compatibility probe timed out.'));
    }, 30000);
    child.on('message', (message) => {
      if (message?.type !== 'compatibility-result' || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(message.results);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const detail = stderr.trim() ? ` ${stderr.trim()}` : '';
      reject(new Error(`Electron compatibility probe exited with code ${code}.${detail}`));
    });
  });
}

async function startService() {
  await validateUtilityRuntime();
  return new Promise((resolve, reject) => {
    service = utilityProcess.fork(utilityEntry('service.mjs'), [], {
      cwd: app.isPackaged ? process.resourcesPath : appRoot,
      env: {
        ...process.env,
        DRAMAGO_DATA_DIR: process.env.DRAMAGO_DATA_DIR || path.join(app.getPath('appData'), 'DramaGo')
      },
      stdio: 'pipe',
      serviceName: 'DramaGo Local Service'
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      service.kill();
      reject(new Error('本地服务启动超时，未打开作品窗口。'));
    }, 20000);
    service.on('message', async (message = {}) => {
      if (message.type === 'ready' && !settled) {
        try {
          const response = await fetch(`${message.url}api/local/status`, {
            headers: { 'x-dramago-local-token': message.token }
          });
          if (!response.ok) throw new Error(`健康检查返回 HTTP ${response.status}`);
          settled = true;
          clearTimeout(timeout);
          serviceInfo = message;
          resolve(message);
        } catch (error) {
          settled = true;
          clearTimeout(timeout);
          service.kill();
          reject(new Error(`本地服务健康检查失败：${error.message}`));
        }
      }
      if (message.type === 'startup-error' && !settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(message.message || '本地服务启动失败。'));
      }
      if (message.type === 'stopped') serviceStopped = true;
    });
    service.on('exit', (code) => {
      serviceStopped = true;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`本地服务提前退出（code ${code}）。`));
        return;
      }
      if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(path.join(appRoot, 'desktop', 'error.html'), { query: { reason: 'service-exited' } });
      }
    });
  });
}

async function stopService() {
  if (!service || serviceStopped) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      service?.kill();
      resolve();
    }, 5000);
    service.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    service.postMessage({ type: 'shutdown' });
  });
  serviceStopped = true;
}

function installSecurityPolicy(window, origin) {
  const ses = window.webContents.session;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, nextUrl) => {
    if (new URL(nextUrl).origin !== origin) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, nextUrl) => {
    if (new URL(nextUrl).origin !== origin) event.preventDefault();
  });
  ses.on('will-download', (event, item) => {
    const suggested = item.getFilename().replace(/[\\/:*?"<>|]/gu, '_');
    if (qaExportDirectory) {
      item.setSavePath(path.join(qaExportDirectory, suggested));
      return;
    }
    const destination = dialog.showSaveDialogSync(window, {
      title: '导出当前版本',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '所有文件', extensions: ['*'] }]
    });
    if (!destination) event.preventDefault();
    else item.setSavePath(destination);
  });
}

async function createWindow(info) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 390,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f7f8',
    autoHideMenuBar: true,
    title: '开戏 DramaGo｜AI 短剧创作工作台',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      devTools: !app.isPackaged
    }
  });
  installSecurityPolicy(mainWindow, new URL(info.url).origin);
  mainWindow.once('ready-to-show', async () => {
    mainWindow.show();
    await writeQaStatus({ window_ready: true });
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(info.url);
}

async function showStartupFailure(error) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 720,
      height: 520,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false }
    });
  }
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(appRoot, 'desktop', 'error.html'), { query: { reason: 'startup-failed' } });
  await writeQaStatus({ window_ready: false, startup_error: error.message });
}

if (singleInstance) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    stopService().finally(() => app.quit());
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    if (compatibilityOutput) {
      try {
        const results = await runCompatibilityProbe();
        await mkdir(path.dirname(compatibilityOutput), { recursive: true });
        await writeFile(compatibilityOutput, `${JSON.stringify(results, null, 2)}\n`);
        process.exitCode = results.passed ? 0 : 1;
      } catch (error) {
        await mkdir(path.dirname(compatibilityOutput), { recursive: true });
        await writeFile(compatibilityOutput, `${JSON.stringify({ passed: false, error: error.message }, null, 2)}\n`);
        process.exitCode = 1;
      } finally {
        quitting = true;
        app.quit();
      }
      return;
    }
    try {
      const info = await startService();
      await createWindow(info);
    } catch (error) {
      await showStartupFailure(error);
    }
  });
}
