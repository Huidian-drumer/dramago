import { createLocalRuntime } from '../../local/server.mjs';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('DramaGo desktop service must run as an Electron utility process.');

let runtime = null;
let stopping = false;

function send(message) {
  parentPort.postMessage(message);
}

async function stop(reason = 'parent-request') {
  if (stopping) return;
  stopping = true;
  try {
    await runtime?.close();
    send({ type: 'stopped', reason });
    setTimeout(() => process.exit(0), 0);
  } catch {
    send({ type: 'stopped', reason: 'shutdown-error' });
    setTimeout(() => process.exit(1), 0);
  }
}

parentPort.on('message', (event) => {
  if (event.data?.type === 'shutdown') stop('parent-request');
});

for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop(signal));

try {
  runtime = await createLocalRuntime({
    port: 0,
    dataRoot: process.env.DRAMAGO_DATA_DIR,
    openBrowser: false
  });
  const info = await runtime.listen();
  send({
    type: 'ready',
    url: info.url,
    port: info.port,
    token: info.token,
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  });
} catch (error) {
  send({ type: 'startup-error', code: error.code || 'DESKTOP_SERVICE_START_FAILED', message: error.message || '本地服务启动失败。' });
  setTimeout(() => process.exit(1), 0);
}
