import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../dist/server/index.js';
import { applyMigrations } from './migrations.mjs';
import { ensureLocalDirectories, localPaths } from './paths.mjs';
import { authoringStatePolicy, getAuthoringOperation, saveAuthoringOperation } from './authoring-state.mjs';
import {
  LegacySecretStoreAdapter,
  WindowsDpapiProviderSecretStore,
  WindowsDpapiSecretStore,
  credentialReference,
  deleteProviderConfiguration,
  migrateLegacyProviderConfiguration,
  selectProviderRoles,
  updateProviderConfiguration,
  writeProviderConfiguration
} from './secure-config.mjs';
import { assertBackupId, listBackups, replaceDatabaseFile, SQLiteD1 } from './sqlite-d1.mjs';
import {
  PROVIDER_REGISTRY_VERSION,
  listProviders,
  providerById
} from '../worker/provider-registry.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(moduleDirectory, '..');
const migrationsDirectory = path.join(root, 'drizzle');
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }
  });
}

function safeError(error, status = 500) {
  return json({ error: { code: error.code || 'LOCAL_RUNTIME_ERROR', message: error.publicMessage || error.message || '本地服务操作失败。' } }, error.status || status);
}

function backupName(prefix = 'dramago') {
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, '');
  return `${prefix}-${stamp}-${randomBytes(4).toString('hex')}.sqlite`;
}

function isAllowedHost(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function isAllowedOrigin(origin, port) {
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function internalQaProviderEndpoint(options = {}) {
  const raw = options.qaProviderEndpoint
    || (process.env.DRAMAGO_DESKTOP_QA_STATUS && process.env.DRAMAGO_INTERNAL_QA === '1'
      ? process.env.DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT
      : null);
  if (!raw) return null;
  const endpoint = new URL(String(raw));
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('内部 QA Provider 仅允许回环 HTTP 地址。');
  }
  return endpoint.toString();
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-frame-options', 'DENY');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('content-security-policy', "default-src 'self' data:; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readNodeBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      const error = new Error('请求内容超过本地服务安全上限。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function nodeRequestToWeb(request, port) {
  return new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: await readNodeBody(request)
  });
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    const error = new Error('请求格式必须是 JSON。');
    error.status = 415;
    throw error;
  }
  try { return await request.json(); } catch {
    const error = new Error('请求内容无法解析。');
    error.status = 400;
    throw error;
  }
}

async function acquireLock(filename) {
  try {
    const handle = await open(filename, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    await handle.close();
    return async () => unlink(filename).catch(() => {});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const record = JSON.parse(await readFile(filename, 'utf8'));
      try { process.kill(Number(record.pid), 0); } catch { stale = true; }
    } catch { stale = true; }
    if (!stale) throw new Error('DramaGo 已经在运行。');
    await unlink(filename);
    return acquireLock(filename);
  }
}

async function openBrowser(url) {
  if (process.platform !== 'win32') return;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export async function createLocalRuntime(options = {}) {
  const requestedPort = Number(options.port ?? process.env.DRAMAGO_LOCAL_PORT ?? 4175);
  const paths = localPaths(options.dataRoot);
  await ensureLocalDirectories(paths);
  const releaseLock = options.disableLock ? async () => {} : await acquireLock(paths.lock);
  let db = new SQLiteD1(paths.database);
  try {
    await applyMigrations(db, migrationsDirectory, {
      beforeMigrate: async () => db.backup(path.join(paths.backups, backupName('dramago')))
    });
  } catch (error) {
    db.close();
    await releaseLock();
    throw error;
  }
  const legacySecretStore = options.legacySecretStore || (options.secretStore ? options.secretStore : new WindowsDpapiSecretStore(paths.providerSecret));
  const secretStore = options.providerSecretStore || (options.secretStore
    ? new LegacySecretStoreAdapter(options.secretStore)
    : new WindowsDpapiProviderSecretStore(paths.providerSecrets));
  const fetchImpl = options.fetchImpl || fetch;
  const qaProviderEndpoint = internalQaProviderEndpoint(options);
  const token = randomBytes(32).toString('base64url');
  const runtimeInstanceId = randomBytes(16).toString('hex');
  let providerSettings = await migrateLegacyProviderConfiguration({
    filename: paths.providerConfig,
    legacySecretStore,
    providerSecretStore: secretStore
  });
  const cachedKeys = new Map();
  let actualPort = requestedPort;
  let closing = false;

  async function providerKey(providerId) {
    if (cachedKeys.has(providerId)) return cachedKeys.get(providerId);
    const value = await secretStore.get(providerId).catch(() => null);
    cachedKeys.set(providerId, value);
    return value;
  }

  async function providerState() {
    const providers = [];
    for (const settings of Object.values(providerSettings.providers)) {
      const preset = providerById(settings.preset_id);
      providers.push({
        provider_id: settings.provider_id,
        preset_id: settings.preset_id,
        provider_name: settings.display_name,
        endpoint: settings.endpoint,
        protocol: preset?.protocol || 'openai-chat-completions',
        compatibility: preset?.compatibility || null,
        models: preset?.models || [],
        allow_custom_models: true,
        configured: await secretStore.has(settings.provider_id),
        writer_model_id: settings.writer_model_id,
        validator_model_id: settings.validator_model_id,
        request_capabilities: settings.request_capabilities,
        writer_temperature: settings.writer_temperature,
        validator_temperature: settings.validator_temperature,
        timeout_ms: settings.timeout_ms,
        allow_insecure_local_http: settings.allow_insecure_local_http,
        config_version: settings.config_version,
        disclosure_confirmed: Boolean(settings.disclosure_confirmed_at)
      });
    }
    const writer = providers.find((provider) => provider.provider_id === providerSettings.selected_writer.provider_id);
    const validator = providers.find((provider) => provider.provider_id === providerSettings.selected_validator.provider_id);
    return {
      registry_version: PROVIDER_REGISTRY_VERSION,
      configured: Boolean(writer?.configured && validator?.configured),
      provider_id: writer?.provider_id || null,
      provider_name: writer?.provider_name || null,
      writer_provider_id: writer?.provider_id || null,
      writer_model: providerSettings.selected_writer.model_id || null,
      writer_model_id: providerSettings.selected_writer.model_id || null,
      validator_provider_id: validator?.provider_id || null,
      validator_provider_name: validator?.provider_name || null,
      validator_model: providerSettings.selected_validator.model_id || null,
      validator_model_id: providerSettings.selected_validator.model_id || null,
      planner_model: providerSettings.selected_validator.model_id || null,
      provider_timeout_ms: providerSettings.provider_timeout_ms,
      providers,
      presets: listProviders(),
      migration: providerSettings.migration
    };
  }

  async function resolveProviderConfiguration({ provider_id: providerId, writer_model_id: writerModelId,
    validator_model_id: validatorModelId, model_id: modelId, role = 'writer',
    credential_ref: expectedCredentialRef = null, include_secret: includeSecret = false } = {}) {
    const selectedRole = role === 'validator' || role === 'planner' ? providerSettings.selected_validator : providerSettings.selected_writer;
    const selectedProviderId = String(providerId || selectedRole.provider_id);
    const settings = providerSettings.providers[selectedProviderId];
    if (!settings) {
      const error = new Error('选择的 AI 服务不存在。');
      error.code = 'PROVIDER_NOT_ALLOWED';
      error.status = 400;
      throw error;
    }
    const preset = providerById(settings.preset_id);
    const selectedModel = String(modelId || (role === 'writer' ? writerModelId : validatorModelId)
      || (selectedProviderId === selectedRole.provider_id ? selectedRole.model_id : null)
      || (role === 'writer' ? settings.writer_model_id : settings.validator_model_id));
    const key = await providerKey(selectedProviderId);
    if (!key) {
      const error = new Error(`尚未配置 ${settings.display_name} API Key。`);
      error.code = 'PROVIDER_NOT_CONFIGURED';
      error.status = 503;
      throw error;
    }
    const credentialRef = credentialReference(selectedProviderId, settings.config_version, key);
    if (expectedCredentialRef && credentialRef !== expectedCredentialRef) {
      const error = new Error('任务绑定的旧模型凭据已不可用。为避免静默切换平台或 Key，本次任务不能继续。');
      error.code = 'TASK_CREDENTIAL_UNAVAILABLE';
      error.status = 409;
      throw error;
    }
    return {
      provider_id: selectedProviderId,
      preset_id: settings.preset_id,
      provider_name: settings.display_name,
      protocol: preset?.protocol || 'openai-chat-completions',
      endpoint: qaProviderEndpoint || settings.endpoint,
      writer_model_id: role === 'writer' ? selectedModel : settings.writer_model_id,
      planner_model_id: role === 'planner' ? selectedModel : settings.validator_model_id,
      validator_model_id: role === 'validator' ? selectedModel : settings.validator_model_id,
      model_id: selectedModel,
      role,
      request_capabilities: settings.request_capabilities,
      temperature: role === 'writer' ? settings.writer_temperature : settings.validator_temperature,
      timeout_ms: settings.timeout_ms,
      provider_config_version: settings.config_version,
      credential_ref: credentialRef,
      ...(includeSecret ? { api_key: key } : {})
    };
  }

  async function workerEnv() {
    const selected = await resolveProviderConfiguration({ role: 'writer' }).catch(() => null);
    return {
      DB: db,
      OPENAI_API_KEY: selected ? await providerKey(selected.provider_id) : null,
      OPENAI_ENDPOINT: selected?.endpoint || null,
      OPENAI_MODEL: selected?.writer_model_id || null,
      VALIDATOR_MODEL: selected?.validator_model_id || null,
      PLANNER_MODEL: selected?.planner_model_id || null,
      PROVIDER_TIMEOUT_MS: String(providerSettings.provider_timeout_ms),
      LOCAL_RUNTIME_INSTANCE_ID: runtimeInstanceId,
      PROVIDER_CONFIG_RESOLVER: resolveProviderConfiguration,
      PROVIDER_REGISTRY: listProviders(),
      SECURE_CONFIGURATION_LABEL: '本机“模型与数据”设置'
    };
  }

  async function createBackup(prefix = 'dramago') {
    const name = backupName(prefix);
    const destination = path.join(paths.backups, name);
    db.exec('PRAGMA wal_checkpoint(FULL)');
    await db.backup(destination);
    return { id: name, created_at: new Date().toISOString(), bytes: (await stat(destination)).size };
  }

  async function testProviderConnection(input = {}) {
    if (input.confirm_billable_test !== true) {
      const error = new Error('连接测试会向所选第三方服务发送最小请求，可能产生费用；请先明确确认。');
      error.code = 'CONNECTION_TEST_COST_CONFIRMATION_REQUIRED';
      error.status = 409;
      throw error;
    }
    const selected = await resolveProviderConfiguration({
      provider_id: input.provider_id,
      role: input.role === 'validator' ? 'validator' : 'writer',
      model_id: input.model_id || input.writer_model_id,
      include_secret: true
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30000, providerSettings.provider_timeout_ms));
    const started = Date.now();
    try {
      const requestBody = {
        model: selected.model_id,
        messages: [
          { role: 'system', content: '只返回 JSON 对象。' },
          { role: 'user', content: '返回 {"ok":true}，不要添加其他内容。' }
        ]
      };
      if (selected.request_capabilities?.temperature) requestBody.temperature = 0;
      if (selected.request_capabilities?.response_format_json_object) requestBody.response_format = { type: 'json_object' };
      const response = await fetchImpl(selected.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${selected.api_key}` },
        body: JSON.stringify(requestBody)
      });
      const raw = await response.text();
      if (!response.ok) {
        const messages = {
          401: ['PROVIDER_AUTH_FAILED', '认证失败（HTTP 401）。请确认该 Key 属于所选平台且仍然有效。'],
          402: ['PROVIDER_QUOTA_EXHAUSTED', '账户额度不足或计费状态不可用（HTTP 402）。'],
          403: ['PROVIDER_MODEL_ACCESS_DENIED', '该 Key 无权使用所选模型（HTTP 403）。'],
          429: ['PROVIDER_RATE_LIMITED', '请求过于频繁或达到平台限额（HTTP 429），请稍后重试。']
        };
        const [code, message] = messages[response.status]
          || ['PROVIDER_REQUEST_FAILED', `模型平台返回 HTTP ${response.status}，请稍后重试。`];
        const error = new Error(message);
        error.code = code;
        error.status = response.status === 429 ? 429 : 502;
        throw error;
      }
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        const error = new Error('连接成功，但 Provider 未返回兼容的消息结构。');
        error.status = 502;
        throw error;
      }
      try { JSON.parse(content); } catch {
        const error = new Error('连接成功，但 Provider 未返回产品要求的 JSON 内容。');
        error.status = 502;
        throw error;
      }
      return {
        ok: true,
        http_status: response.status,
        provider_id: selected.provider_id,
        model: payload.model || selected.model_id,
        duration_ms: Date.now() - started,
        usage: payload.usage || null
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeout = new Error('连接测试超时，请检查网络或 Endpoint。');
        timeout.code = 'PROVIDER_TIMEOUT';
        timeout.status = 504;
        throw timeout;
      }
      if (!error.status) {
        const offline = new Error('无法连接模型平台。请检查网络连接后重试。');
        offline.code = 'PROVIDER_CONNECTION_FAILED';
        offline.status = 502;
        throw offline;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function localApi(request, url) {
    if (request.method === 'GET' && url.pathname === '/api/local/status') {
      return json({
        runtime: 'windows-local',
        provider: await providerState(),
        storage: { database: paths.database, backups: paths.backups },
        backups: await listBackups(paths.backups)
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/local/works') {
      const rows = await db.prepare(`SELECT id, title, current_version_id, story_status,
        completed_version_id, completed_at, created_at, updated_at FROM works
        ORDER BY updated_at DESC LIMIT 200`).all();
      return json({ works: rows.results });
    }
    if (request.method === 'GET' && url.pathname === '/api/local/authoring-state') {
      const workId = String(url.searchParams.get('work_id') || '').trim();
      const work = workId ? await db.prepare('SELECT id FROM works WHERE id = ? LIMIT 1').bind(workId).first() : null;
      return json({ work_id: workId || null, operation_state: work ? await getAuthoringOperation(paths.authoringState, workId) : null,
        policy: authoringStatePolicy });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/authoring-state') {
      const input = await readJson(request);
      const workId = String(input.work_id || '').trim();
      const work = workId ? await db.prepare('SELECT id FROM works WHERE id = ? LIMIT 1').bind(workId).first() : null;
      if (!work) return json({ error: { code: 'WORK_NOT_FOUND', message: '找不到要保存操作状态的作品。' } }, 404);
      const operationState = await saveAuthoringOperation(paths.authoringState, workId, String(input.operation || ''),
        input.selected_at ? String(input.selected_at) : null);
      return json({ work_id: workId, operation_state: operationState, policy: authoringStatePolicy });
    }
    if (request.method === 'GET' && url.pathname === '/api/local/draft') {
      const workId = String(url.searchParams.get('work_id') || '').trim();
      const operation = String(url.searchParams.get('operation') || '').trim();
      const work = workId ? await db.prepare('SELECT id FROM works WHERE id = ? LIMIT 1').bind(workId).first() : null;
      if (!work) return json({ error: { code: 'WORK_NOT_FOUND', message: '找不到草稿所属作品。' } }, 404);
      const editDraft = await db.prepare('SELECT * FROM work_edit_drafts WHERE work_id = ? LIMIT 1').bind(workId).first();
      const operationDraft = operation
        ? await db.prepare('SELECT * FROM work_operation_drafts WHERE work_id = ? AND operation = ? LIMIT 1').bind(workId, operation).first()
        : null;
      return json({ work_id: workId, edit_draft: editDraft, operation_draft: operationDraft ? {
        ...operationDraft, form: JSON.parse(operationDraft.form_json || '{}')
      } : null });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/draft') {
      const input = await readJson(request);
      const workId = String(input.work_id || '').trim();
      const operation = String(input.operation || '').trim();
      const revision = Math.max(1, Math.trunc(Number(input.revision) || 1));
      const work = workId ? await db.prepare('SELECT id FROM works WHERE id = ? LIMIT 1').bind(workId).first() : null;
      if (!work) return json({ error: { code: 'WORK_NOT_FOUND', message: '找不到草稿所属作品。' } }, 404);
      if (!['CREATE', 'EXPAND', 'REWRITE', 'CONTINUE'].includes(operation)) {
        return json({ error: { code: 'OPERATION_INVALID', message: '草稿缺少有效创作操作。' } }, 400);
      }
      const existingEdit = await db.prepare('SELECT * FROM work_edit_drafts WHERE work_id = ? LIMIT 1').bind(workId).first();
      const existingOperation = await db.prepare('SELECT * FROM work_operation_drafts WHERE work_id = ? AND operation = ? LIMIT 1')
        .bind(workId, operation).first();
      const maxRevision = Math.max(Number(existingEdit?.revision || 0), Number(existingOperation?.revision || 0));
      if (revision < maxRevision) return json({ error: { code: 'DRAFT_REVISION_CONFLICT', message: '较新的草稿已经保存，本次旧写入已拒绝。' } }, 409);
      const timestamp = new Date().toISOString();
      const draftId = String(input.draft_id || existingOperation?.draft_id || `draft_${randomBytes(12).toString('hex')}`);
      const createdAt = existingOperation?.created_at || timestamp;
      const operationStatus = input.status === 'consumed' ? 'consumed' : 'active';
      await db.batch([
        db.prepare(`INSERT INTO work_edit_drafts
          (work_id, draft_id, based_on_version_id, title, body, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(work_id) DO UPDATE SET draft_id = excluded.draft_id,
            based_on_version_id = excluded.based_on_version_id, title = excluded.title, body = excluded.body,
            revision = excluded.revision, updated_at = excluded.updated_at
          WHERE excluded.revision >= work_edit_drafts.revision`).bind(workId, draftId,
            input.source_version_id || null, String(input.title || '未命名短剧').slice(0, 160), String(input.body || ''),
            revision, existingEdit?.created_at || timestamp, timestamp),
        db.prepare(`INSERT INTO work_operation_drafts
          (work_id, operation, draft_id, source_version_id, instruction, form_json, status, revision, created_at, updated_at, consumed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(work_id, operation) DO UPDATE SET draft_id = excluded.draft_id,
            source_version_id = excluded.source_version_id, instruction = excluded.instruction,
            form_json = excluded.form_json, status = excluded.status, revision = excluded.revision,
            updated_at = excluded.updated_at, consumed_at = excluded.consumed_at
          WHERE excluded.revision >= work_operation_drafts.revision`).bind(workId, operation, draftId,
            input.source_version_id || null, String(input.instruction || ''), JSON.stringify(input.form || {}), operationStatus,
            revision, createdAt, timestamp, operationStatus === 'consumed' ? timestamp : null)
      ]);
      return json({ saved: true, work_id: workId, operation, draft_id: draftId, revision, updated_at: timestamp });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/draft/consume') {
      const input = await readJson(request);
      const timestamp = new Date().toISOString();
      const result = await db.prepare(`UPDATE work_operation_drafts SET status = 'consumed', consumed_at = ?, updated_at = ?
        WHERE work_id = ? AND operation = ? AND draft_id = ? AND status = 'active'`)
        .bind(timestamp, timestamp, String(input.work_id || ''), String(input.operation || ''), String(input.draft_id || '')).run();
      return json({ consumed: Number(result?.meta?.changes || 0) === 1, consumed_at: timestamp });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/settings') {
      const input = await readJson(request);
      const providerId = String(input.provider_id || input.instance_id || providerSettings.selected_writer.provider_id);
      const currentProvider = providerSettings.providers[providerId];
      const firstDisclosure = !currentProvider?.disclosure_confirmed_at;
      if (firstDisclosure && input.disclosure_confirmed !== true) {
        const error = new Error('首次启用该平台前，请确认当前操作可能向该平台发送完整源文与创作要求。');
        error.code = 'PROVIDER_DISCLOSURE_REQUIRED';
        error.status = 409;
        throw error;
      }
      if (input.clear_key === true) {
        await secretStore.clear(providerId);
        cachedKeys.delete(providerId);
      }
      if (String(input.api_key || '').trim()) {
        await secretStore.set(providerId, String(input.api_key).trim());
        cachedKeys.delete(providerId);
      }
      providerSettings = updateProviderConfiguration(providerSettings, {
        provider_id: providerId,
        preset_id: input.preset_id,
        display_name: input.display_name,
        endpoint: input.endpoint,
        writer_model_id: input.writer_model_id,
        validator_model_id: input.validator_model_id,
        request_capabilities: input.request_capabilities,
        writer_temperature: input.writer_temperature,
        validator_temperature: input.validator_temperature,
        timeout_ms: input.timeout_ms,
        allow_insecure_local_http: input.allow_insecure_local_http === true,
        select_writer: input.select_writer !== false,
        select_validator: input.select_validator === true,
        disclosure_confirmed: input.disclosure_confirmed === true
      });
      providerSettings = await writeProviderConfiguration(paths.providerConfig, providerSettings);
      return json({ provider: await providerState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/settings/roles') {
      const input = await readJson(request);
      providerSettings = selectProviderRoles(providerSettings, input);
      providerSettings = await writeProviderConfiguration(paths.providerConfig, providerSettings);
      return json({ provider: await providerState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/settings/delete') {
      const input = await readJson(request);
      const providerId = String(input.provider_id || '');
      providerSettings = deleteProviderConfiguration(providerSettings, providerId);
      providerSettings = await writeProviderConfiguration(paths.providerConfig, providerSettings);
      if (input.clear_key === true) await secretStore.clear(providerId);
      cachedKeys.delete(providerId);
      return json({ provider: await providerState() });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/settings/test') {
      return json({ result: await testProviderConnection(await readJson(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/backup') {
      const created = await createBackup();
      return json({ backup: created, backups: await listBackups(paths.backups) }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/api/local/restore') {
      const input = await readJson(request);
      const backupId = assertBackupId(input.backup_id);
      const source = path.join(paths.backups, backupId);
      const safety = path.join(paths.data, '.restore-safety.sqlite');
      await createBackup('dramago');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      try {
        await replaceDatabaseFile({ activePath: paths.database, backupPath: source, safetyPath: safety });
        db = new SQLiteD1(paths.database);
        await applyMigrations(db, migrationsDirectory);
      } catch (error) {
        if (!db.database) db = new SQLiteD1(paths.database);
        throw error;
      }
      return json({ restored: true, backup_id: backupId, requires_reload: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/local/export') {
      const workId = url.searchParams.get('work_id');
      const versionId = url.searchParams.get('version_id');
      const version = await db.prepare('SELECT * FROM versions WHERE id = ? AND work_id = ? LIMIT 1').bind(versionId, workId).first();
      if (!version) return json({ error: { code: 'VERSION_NOT_FOUND', message: '找不到要导出的版本。' } }, 404);
      const body = `# ${version.title}\n\n${version.content}\n`;
      const safeName = String(version.title || '未命名短剧').replace(/[\\/:*?"<>|]/gu, '_').slice(0, 80);
      return new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.md`, 'cache-control': 'no-store' } });
    }
    if (request.method === 'POST' && url.pathname === '/api/local/shutdown') {
      setTimeout(() => close(), 100);
      return json({ shutting_down: true });
    }
    return json({ error: { code: 'LOCAL_ROUTE_NOT_FOUND', message: '本地功能不存在。' } }, 404);
  }

  const server = createServer(async (nodeRequest, nodeResponse) => {
    try {
      if (!isAllowedHost(String(nodeRequest.headers.host || ''), actualPort)) {
        nodeResponse.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' });
        nodeResponse.end('Misdirected Request');
        return;
      }
      const request = await nodeRequestToWeb(nodeRequest, actualPort);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        if (!isAllowedOrigin(request.headers.get('origin'), actualPort)
          || request.headers.get('x-dramago-local-token') !== token
          || request.method === 'OPTIONS') {
          nodeResponse.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          nodeResponse.end(JSON.stringify({ error: { code: 'LOCAL_ACCESS_DENIED', message: '本地 API 拒绝了未经授权的请求。' } }));
          return;
        }
      }
      let response;
      if (url.pathname.startsWith('/api/local/')) response = await localApi(request, url);
      else response = await worker.fetch(request, await workerEnv());
      if ((url.pathname === '/' || url.pathname === '/index.html') && response.ok) {
        const html = (await response.text()).replace('content="__DRAMAGO_LOCAL_TOKEN__"', `content="${token}"`);
        response = new Response(html, { status: response.status, headers: response.headers });
      }
      response = withSecurityHeaders(response);
      nodeResponse.writeHead(response.status, Object.fromEntries(response.headers));
      nodeResponse.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const response = withSecurityHeaders(safeError(error));
      nodeResponse.writeHead(response.status, Object.fromEntries(response.headers));
      nodeResponse.end(Buffer.from(await response.arrayBuffer()));
    }
  });

  async function listen() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', resolve);
    });
    actualPort = server.address().port;
    const url = `http://127.0.0.1:${actualPort}/`;
    if (options.openBrowser) await openBrowser(url);
    return { url, port: actualPort, paths, token };
  }

  async function close() {
    if (closing) return;
    closing = true;
    const stopped = new Promise((resolve) => server.close(resolve));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await stopped;
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    db.close();
    await releaseLock();
  }

  return { listen, close, paths, get database() { return db; }, providerState, testProviderConnection, createBackup };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const runtime = await createLocalRuntime({ openBrowser: args.has('--open') && !args.has('--no-open') });
  const info = await runtime.listen();
  console.log(`DramaGo Windows local workbench is running at ${info.url}`);
  console.log(`Data directory: ${info.paths.root}`);
  console.log('Press Ctrl+C or use “安全退出” in the app to stop.');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await runtime.close();
      process.exit(0);
    });
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
