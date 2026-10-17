import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import { getAuthoringOperation, saveAuthoringOperation } from '../local/authoring-state.mjs';
import { applyMigrations } from '../local/migrations.mjs';
import { createLocalRuntime } from '../local/server.mjs';
import { localPaths, ensureLocalDirectories } from '../local/paths.mjs';
import { MemorySecretStore, WindowsDpapiSecretStore } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const migrations = path.resolve('drizzle');

async function tempRoot(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-local-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function apiRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function httpStatus(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers, agent: false }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}

test('SQLite D1 adapter persists works and versions across close/reopen', async (t) => {
  const root = await tempRoot(t);
  const filename = path.join(root, 'dramago.sqlite');
  let db = new SQLiteD1(filename);
  await applyMigrations(db, migrations);
  const saved = await worker.fetch(apiRequest('http://local/api/versions/save', {
    work_id: 'local_persist_work', title: '本地持久化', content: '关闭前保存的正文。'
  }), { DB: db });
  assert.equal(saved.status, 201);
  const first = await saved.json();
  db.close();

  db = new SQLiteD1(filename);
  await applyMigrations(db, migrations);
  const restored = await worker.fetch(new Request('http://local/api/bootstrap?work_id=local_persist_work'), { DB: db });
  const payload = await restored.json();
  assert.equal(payload.current_version.content, '关闭前保存的正文。');
  assert.equal(payload.versions.length, 1);
  assert.equal(payload.current_version.id, first.version.id);
  db.close();
});

test('SQLite batch is transactional and CAS update is atomic', async (t) => {
  const root = await tempRoot(t);
  const db = new SQLiteD1(path.join(root, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  await db.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('cas_work', 'CAS', 'v1', 't', 't').run();
  const first = await db.prepare('UPDATE works SET current_version_id = ? WHERE id = ? AND current_version_id = ?')
    .bind('v2', 'cas_work', 'v1').run();
  const stale = await db.prepare('UPDATE works SET current_version_id = ? WHERE id = ? AND current_version_id = ?')
    .bind('stale', 'cas_work', 'v1').run();
  assert.equal(first.meta.changes, 1);
  assert.equal(stale.meta.changes, 0);
  assert.equal((await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('cas_work').first()).current_version_id, 'v2');
  db.close();
});

test('a failed local migration rolls back its partial schema and is not marked applied', async (t) => {
  const root = await tempRoot(t);
  const migrationDirectory = path.join(root, 'migrations');
  await mkdir(migrationDirectory, { recursive: true });
  await writeFile(path.join(migrationDirectory, '0000_base.sql'), 'CREATE TABLE durable_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const db = new SQLiteD1(path.join(root, 'dramago.sqlite'));
  await applyMigrations(db, migrationDirectory);
  await db.prepare('INSERT INTO durable_data (id, value) VALUES (?, ?)').bind('kept', 'before-failure').run();
  await writeFile(path.join(migrationDirectory, '0001_broken.sql'), [
    'CREATE TABLE partial_table (id TEXT PRIMARY KEY);',
    'THIS IS NOT VALID SQL;'
  ].join('\n'));

  await assert.rejects(() => applyMigrations(db, migrationDirectory), /Migration 0001_broken\.sql failed/u);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'").first()).count, 0);
  assert.equal((await db.prepare('SELECT value FROM durable_data WHERE id = ?').bind('kept').first()).value, 'before-failure');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM local_schema_migrations WHERE name = ?').bind('0001_broken.sql').first()).count, 0);
  db.close();
});

test('existing V1/V3/V5-shaped data is backed up before safe revalidation migration and remains readable', async (t) => {
  const root = await tempRoot(t);
  const paths = localPaths(root);
  await ensureLocalDirectories(paths);
  const oldMigrations = path.join(root, 'old-migrations');
  await mkdir(oldMigrations, { recursive: true });
  for (const name of (await readdir(migrations)).filter((name) => /^000[0-4]_.+\.sql$/u.test(name))) {
    await copyFile(path.join(migrations, name), path.join(oldMigrations, name));
  }
  const oldDb = new SQLiteD1(paths.database);
  await applyMigrations(oldDb, oldMigrations);
  await oldDb.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('compat_work', '合成兼容作品', 'V3', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z').run();
  for (const row of [
    ['V1', null, 'adopted', '第一版合成正文。', 'passed', 1],
    ['V3', 'V1', 'adopted', '第三版合成正文。', 'passed', 1],
    ['V5', 'V3', 'candidate', '第三版合成正文。\n\n第二天的新段落。', 'blocked', 0]
  ]) {
    await oldDb.prepare(`INSERT INTO versions
      (id, work_id, parent_version_id, operation, status, title, content, generated_segment,
        creative_brief_json, checks_json, content_hash, validator_version, validation_status,
        can_auto_apply, adopted_at, created_at)
      VALUES (?, 'compat_work', ?, 'CONTINUE', ?, '合成兼容作品', ?, ?, '{}', '[]', ?, 'content-semantic-v2', ?, ?, ?, ?)`)
      .bind(row[0], row[1], row[2], row[3], row[0] === 'V5' ? '第二天的新段落。' : null,
        `hash-${row[0]}`, row[4], row[5], row[2] === 'adopted' ? '2026-01-01T00:00:00.000Z' : null,
        `2026-01-0${row[0] === 'V1' ? '1' : row[0] === 'V3' ? '2' : '3'}T00:00:00.000Z`).run();
  }
  oldDb.close();

  const runtime = await createLocalRuntime({ port: 0, dataRoot: root, disableLock: true, secretStore: new MemorySecretStore() });
  try {
    await runtime.listen();
    const backupFiles = (await readdir(paths.backups)).filter((name) => /^dramago-.*\.sqlite$/u.test(name));
    assert.equal(backupFiles.length, 1);
    const rows = await runtime.database.prepare('SELECT id, parent_version_id, status, content FROM versions WHERE work_id = ? ORDER BY id')
      .bind('compat_work').all();
    assert.deepEqual(rows.results.map((row) => row.id), ['V1', 'V3', 'V5']);
    assert.equal(rows.results.find((row) => row.id === 'V5').content.endsWith('第二天的新段落。'), true);
    assert.equal((await runtime.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'candidate_validation_runs'").first()).count, 1);
    assert.equal((await runtime.database.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('versions') WHERE name = 'current_validation_run_id'").first()).count, 1);
  } finally {
    await runtime.close();
  }
});

test('local HTTP API rejects missing token and foreign Origin', async (t) => {
  const root = await tempRoot(t);
  const runtime = await createLocalRuntime({ port: 0, dataRoot: root, disableLock: true, secretStore: new MemorySecretStore() });
  const info = await runtime.listen();
  try {
    assert.equal(await httpStatus(info.url), 200);
    assert.equal(await httpStatus(`${info.url}api/bootstrap`), 403);
    assert.equal(await httpStatus(`${info.url}api/bootstrap`, { 'x-dramago-local-token': info.token, origin: 'https://evil.example' }), 403);
    assert.equal(await httpStatus(`${info.url}api/bootstrap`, { 'x-dramago-local-token': info.token }), 200);
  } finally {
    await runtime.close();
  }
});

test('authoring operation survives local origin port changes without storing story content', async (t) => {
  const root = await tempRoot(t);
  const paths = localPaths(root);
  await ensureLocalDirectories(paths);
  const selectedAt = '2026-10-13T00:00:00.000Z';
  await saveAuthoringOperation(paths.authoringState, 'work-operation-state', 'CONTINUE', selectedAt);
  assert.deepEqual(await getAuthoringOperation(paths.authoringState, 'work-operation-state'), {
    operation: 'CONTINUE', selected_at: selectedAt, updated_at: (await getAuthoringOperation(paths.authoringState, 'work-operation-state')).updated_at
  });
  const raw = await readFile(paths.authoringState, 'utf8');
  assert.equal(raw.includes('CONTINUE'), true);
  assert.equal(/content|prompt|api[_ -]?key|authorization/iu.test(raw), false);
  await assert.rejects(() => saveAuthoringOperation(paths.authoringState, 'work-operation-state', 'UNKNOWN'), /不支持该创作操作/u);
});

test('Windows DPAPI secret store encrypts at rest and clears safely', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await tempRoot(t);
  const paths = localPaths(root);
  await ensureLocalDirectories(paths);
  const store = new WindowsDpapiSecretStore(paths.providerSecret);
  const secret = 'qa-only-secret-never-a-real-key';
  await store.set(secret);
  assert.equal(await store.get(), secret);
  assert.equal((await readFile(paths.providerSecret, 'utf8')).includes(secret), false);
  await store.clear();
  assert.equal(await store.has(), false);
});
