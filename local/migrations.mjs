import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function applyMigrations(db, migrationsDirectory, options = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS local_schema_migrations (
    name TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const appliedRows = await db.prepare('SELECT name FROM local_schema_migrations').all();
  const applied = new Set(appliedRows.results.map((row) => row.name));
  const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+_.+\.sql$/u.test(name)).sort();
  const pending = files.filter((name) => !applied.has(name));
  if (pending.length && applied.size > 0 && typeof options.beforeMigrate === 'function') {
    await options.beforeMigrate({ applied: [...applied].sort(), pending });
  }
  const executed = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile(path.join(migrationsDirectory, name), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      await db.prepare('INSERT INTO local_schema_migrations (name, applied_at) VALUES (?, ?)')
        .bind(name, new Date().toISOString()).run();
      db.exec('COMMIT');
      executed.push(name);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw new Error(`Migration ${name} failed: ${error.message}`);
    }
  }
  return { applied: files, executed };
}
