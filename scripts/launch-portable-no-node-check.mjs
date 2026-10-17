import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const executable = process.env.DRAMAGO_ACCEPTANCE_EXE;
const dataRoot = process.env.DRAMAGO_ACCEPTANCE_EXTERNAL_DATA;
if (!executable || !dataRoot) throw new Error('Acceptance executable and external data root are required.');

await mkdir(dataRoot, { recursive: true });
const statusFile = path.join(dataRoot, 'desktop-status.json');
await rm(statusFile, { force: true });

const env = { ...process.env };
for (const key of ['NODE_PATH', 'OPENAI_API_KEY', 'OPENAI_ENDPOINT', 'OPENAI_MODEL', 'VALIDATOR_MODEL', 'PLANNER_MODEL']) delete env[key];
env.PATH = `${env.SystemRoot}\\System32;${env.SystemRoot}`;
env.DRAMAGO_DATA_DIR = dataRoot;
env.DRAMAGO_DESKTOP_QA_STATUS = statusFile;

const child = spawn(executable, [], {
  cwd: path.dirname(executable),
  env,
  windowsHide: false,
  detached: true,
  stdio: 'ignore'
});

const deadline = Date.now() + 30000;
let status = null;
while (Date.now() < deadline) {
  try {
    status = JSON.parse(await readFile(statusFile, 'utf8'));
    if (status.window_ready) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!status?.window_ready) throw new Error('Portable app did not become ready with Node removed from PATH.');

console.log(JSON.stringify({
  pid: child.pid,
  window_ready: status.window_ready,
  startup_ms: status.startup_ms,
  embedded_node: status.process_versions.node,
  electron: status.process_versions.electron,
  service_port: status.service.port,
  data_root: dataRoot,
  path_contains_node: /node/iu.test(env.PATH)
}, null, 2));

child.unref();
