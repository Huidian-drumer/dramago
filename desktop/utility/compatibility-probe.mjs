import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalRuntime } from '../../local/server.mjs';
import { ensureLocalDirectories, localPaths } from '../../local/paths.mjs';
import { WindowsDpapiSecretStore } from '../../local/secure-config.mjs';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Compatibility probe must run as an Electron utility process.');

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(moduleDirectory, '..', '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dramago-desktop-compat-'));
const results = {
  process_versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    modules: process.versions.modules
  },
  process_type: process.type,
  esm_module_loading: true,
  node_sqlite: false,
  sqlite_transaction: false,
  sqlite_cas: false,
  dpapi_round_trip: false,
  dpapi_plaintext_at_rest: null,
  local_server: false,
  packaged_resources: false,
  resource_root: appRoot.endsWith('app.asar.unpacked') ? 'app.asar.unpacked' : 'development_root'
};

try {
  const database = new DatabaseSync(path.join(tempRoot, 'compat.sqlite'));
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE cas_probe (id INTEGER PRIMARY KEY, value TEXT, revision INTEGER); INSERT INTO cas_probe VALUES (1, 'before', 1);");
  results.node_sqlite = true;
  database.exec('BEGIN IMMEDIATE');
  const update = database.prepare('UPDATE cas_probe SET value = ?, revision = ? WHERE id = ? AND revision = ?').run('after', 2, 1, 1);
  database.exec('COMMIT');
  results.sqlite_transaction = database.prepare('SELECT value FROM cas_probe WHERE id = 1').get().value === 'after';
  results.sqlite_cas = Number(update.changes) === 1
    && Number(database.prepare('UPDATE cas_probe SET value = ? WHERE id = ? AND revision = ?').run('invalid', 1, 1).changes) === 0;
  database.close();

  const paths = localPaths(path.join(tempRoot, 'runtime'));
  await ensureLocalDirectories(paths);
  const secret = `desktop-probe-${randomBytes(16).toString('hex')}`;
  const store = new WindowsDpapiSecretStore(paths.providerSecret);
  await store.set(secret);
  const encrypted = await readFile(paths.providerSecret, 'utf8');
  results.dpapi_plaintext_at_rest = encrypted.includes(secret);
  results.dpapi_round_trip = await store.get() === secret;
  await store.clear();

  const runtime = await createLocalRuntime({ port: 0, dataRoot: path.join(tempRoot, 'runtime'), openBrowser: false });
  const info = await runtime.listen();
  const response = await fetch(`${info.url}api/local/status`, { headers: { 'x-dramago-local-token': info.token } });
  results.local_server = response.ok && (await response.json()).runtime === 'windows-local';
  await runtime.close();

  await Promise.all([
    access(path.join(appRoot, 'dist', 'server', 'index.js')),
    access(path.join(appRoot, 'drizzle', '0000_low_the_fallen.sql')),
    access(path.join(appRoot, 'local', 'server.mjs'))
  ]);
  results.packaged_resources = true;
  results.passed = Object.entries(results)
    .filter(([key]) => !['process_versions', 'process_type', 'resource_root', 'dpapi_plaintext_at_rest'].includes(key))
    .every(([, value]) => value === true)
    && results.dpapi_plaintext_at_rest === false
    && results.process_type === 'utility';
  parentPort.postMessage({ type: 'compatibility-result', results });
  setTimeout(() => process.exit(results.passed ? 0 : 1), 0);
} catch (error) {
  parentPort.postMessage({ type: 'compatibility-result', results: { ...results, passed: false, error: error.message } });
  setTimeout(() => process.exit(1), 0);
} finally {
  const resolved = path.resolve(tempRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()))) await rm(resolved, { recursive: true, force: true });
}
