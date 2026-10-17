import { chmod, readFile, writeFile } from 'node:fs/promises';

const OPERATIONS = new Set(['CREATE', 'EXPAND', 'REWRITE', 'CONTINUE']);
const MAX_WORKS = 200;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function emptyState() {
  return { schema_version: 1, works: {} };
}

function validTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeState(input, now = Date.now()) {
  const candidates = Object.entries(input?.works && typeof input.works === 'object' ? input.works : {})
    .filter(([workId, record]) => workId && OPERATIONS.has(record?.operation)
      && now - validTimestamp(record?.updated_at) <= RETENTION_MS)
    .sort((left, right) => validTimestamp(right[1].updated_at) - validTimestamp(left[1].updated_at))
    .slice(0, MAX_WORKS);
  return {
    schema_version: 1,
    works: Object.fromEntries(candidates.map(([workId, record]) => [workId, {
      operation: record.operation,
      selected_at: record.selected_at || record.updated_at,
      updated_at: record.updated_at
    }]))
  };
}

export async function readAuthoringState(filename) {
  try {
    return normalizeState(JSON.parse(await readFile(filename, 'utf8')));
  } catch {
    return emptyState();
  }
}

export async function getAuthoringOperation(filename, workId) {
  const state = await readAuthoringState(filename);
  return state.works[String(workId || '')] || null;
}

export async function saveAuthoringOperation(filename, workId, operation, selectedAt = null) {
  if (!String(workId || '').trim()) throw new Error('作品 ID 不能为空。');
  if (!OPERATIONS.has(operation)) throw new Error('不支持该创作操作。');
  const now = new Date().toISOString();
  const state = await readAuthoringState(filename);
  state.works[String(workId)] = {
    operation,
    selected_at: selectedAt || now,
    updated_at: now
  };
  const normalized = normalizeState(state);
  await writeFile(filename, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600).catch(() => {});
  return normalized.works[String(workId)];
}

export const authoringStatePolicy = Object.freeze({ max_works: MAX_WORKS, retention_days: 90 });
