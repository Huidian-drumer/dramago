import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { copyFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

function resultMeta(result) {
  return {
    success: true,
    meta: {
      changes: Number(result?.changes || 0),
      last_row_id: result?.lastInsertRowid == null ? null : Number(result.lastInsertRowid)
    }
  };
}

class SQLiteD1Statement {
  constructor(owner, sql, args = []) {
    this.owner = owner;
    this.sql = String(sql);
    this.args = args;
  }

  bind(...args) {
    return new SQLiteD1Statement(this.owner, this.sql, args);
  }

  async first() {
    return this.owner.statement(this.sql).get(...this.args) || null;
  }

  async all() {
    return { results: this.owner.statement(this.sql).all(...this.args) };
  }

  async run() {
    return resultMeta(this.owner.statement(this.sql).run(...this.args));
  }
}

export class SQLiteD1 {
  constructor(filename) {
    this.filename = filename;
    this.database = new DatabaseSync(filename);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }

  statement(sql) {
    if (!this.database) throw new Error('SQLite database is closed.');
    return this.database.prepare(sql);
  }

  prepare(sql) {
    return new SQLiteD1Statement(this, sql);
  }

  async batch(statements) {
    if (!Array.isArray(statements)) throw new TypeError('batch() requires an array of prepared statements.');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  exec(sql) {
    this.database.exec(sql);
  }

  close() {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  async backup(destination) {
    if (!this.database) throw new Error('SQLite database is closed.');
    await sqliteBackup(this.database, destination, { rate: 100 });
    return destination;
  }
}

export async function listBackups(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^dramago-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite$/u.test(entry.name)) continue;
    const info = await stat(path.join(directory, entry.name));
    rows.push({ id: entry.name, created_at: info.mtime.toISOString(), bytes: info.size });
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function assertBackupId(value) {
  const id = String(value || '');
  if (!/^dramago-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite$/u.test(id)) throw new Error('Invalid backup id.');
  return id;
}

export async function replaceDatabaseFile({ activePath, backupPath, safetyPath }) {
  await copyFile(activePath, safetyPath);
  try {
    const probe = new DatabaseSync(backupPath, { readOnly: true });
    const integrity = probe.prepare('PRAGMA integrity_check').get();
    probe.close();
    if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('Backup integrity check failed.');
    await copyFile(backupPath, activePath);
  } catch (error) {
    await copyFile(safetyPath, activePath);
    throw error;
  } finally {
    await unlink(safetyPath).catch(() => {});
  }
}
