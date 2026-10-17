import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const executable = path.join(root, 'artifacts', 'windows', 'DramaGo-win32-x64', 'DramaGo.exe');
const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'qa-windows-local.mjs')], {
  cwd: root,
  env: { ...process.env, DRAMAGO_QA_DESKTOP_EXE: executable },
  encoding: 'utf8',
  stdio: 'inherit',
  windowsHide: false
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
