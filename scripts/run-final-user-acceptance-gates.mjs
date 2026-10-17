import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Capture existing gates without changing their standards or invoking a real Provider.
const directory = path.resolve('reports/final-user-acceptance/gates');
await mkdir(directory, { recursive: true });
const results = [];
for (const gate of ['test', 'build', 'validate', 'db:validate', 'audit:l2', 'docs:validate', 'claims:validate', 'links:validate']) {
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const process = spawn('cmd.exe', ['/d', '/s', '/c', `pnpm ${gate}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', chunk => { output += chunk; });
    process.stderr.on('data', chunk => { output += chunk; });
    process.once('error', reject);
    process.once('exit', code => resolve({ gate, code, duration_ms: Date.now() - started, output }));
  });
  await writeFile(path.join(directory, `${gate.replace(':','-')}.log`), result.output);
  results.push({ gate, code: result.code, duration_ms: result.duration_ms });
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
  if (result.code !== 0) { process.exitCode = 1; break; }
}
