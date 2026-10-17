import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROVIDER_ID, PROVIDER_REGISTRY_VERSION, inferProviderFromEndpoint, listProviders, providerById,
  recommendedValidatorModel, validateModelId
} from '../worker/provider-registry.mjs';

const protectScript = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $plain=[Console]::In.ReadToEnd(); $bytes=[Text.Encoding]::UTF8.GetBytes($plain); $cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($cipher));`;
const unprotectScript = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $cipher=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes));`;

function encodedPowerShell(script) { return Buffer.from(script, 'utf16le').toString('base64'); }
function runDpapi(script, input) {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI is only available on Windows.');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedPowerShell(script)], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('Windows secure storage operation failed.');
  return String(result.stdout || '');
}

export class WindowsDpapiSecretStore {
  constructor(filename) { this.filename = filename; }
  async has() { try { return (await readFile(this.filename, 'utf8')).trim().length > 0; } catch { return false; } }
  async set(secret) {
    const value = String(secret || '').trim();
    if (!value) throw new Error('API Key 不能为空。');
    await writeFile(this.filename, runDpapi(protectScript, value), { encoding: 'utf8', mode: 0o600 });
    await chmod(this.filename, 0o600).catch(() => {});
  }
  async get() {
    const encrypted = (await readFile(this.filename, 'utf8')).trim();
    return encrypted ? runDpapi(unprotectScript, encrypted) : null;
  }
  async clear() { await unlink(this.filename).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

export class MemorySecretStore {
  constructor(initial = null) { this.value = initial; }
  async has() { return Boolean(this.value); }
  async set(value) { this.value = String(value || '').trim(); }
  async get() { return this.value; }
  async clear() { this.value = null; }
}

export function safeProviderId(providerId) {
  const value = String(providerId || '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value)) throw new Error('AI 服务 ID 无效。');
  return value;
}

export class WindowsDpapiProviderSecretStore {
  constructor(directory) { this.directory = directory; }
  filename(providerId) { return path.join(this.directory, `${safeProviderId(providerId)}.dpapi`); }
  async has(providerId) { return new WindowsDpapiSecretStore(this.filename(providerId)).has(); }
  async set(providerId, secret) { await mkdir(this.directory, { recursive: true }); return new WindowsDpapiSecretStore(this.filename(providerId)).set(secret); }
  async get(providerId) { return new WindowsDpapiSecretStore(this.filename(providerId)).get(); }
  async clear(providerId) { return new WindowsDpapiSecretStore(this.filename(providerId)).clear(); }
}

export class MemoryProviderSecretStore {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  async has(providerId) { return Boolean(this.values.get(safeProviderId(providerId))); }
  async set(providerId, value) {
    const secret = String(value || '').trim();
    if (!secret) throw new Error('API Key 不能为空。');
    this.values.set(safeProviderId(providerId), secret);
  }
  async get(providerId) { return this.values.get(safeProviderId(providerId)) || null; }
  async clear(providerId) { this.values.delete(safeProviderId(providerId)); }
}

export class LegacySecretStoreAdapter {
  constructor(store) { this.store = store; }
  async has() { return this.store.has(); }
  async set(_providerId, value) { return this.store.set(value); }
  async get() { return this.store.get(); }
  async clear() { return this.store.clear(); }
}

export const defaultProviderSettings = Object.freeze({ endpoint: 'https://api.deepseek.com/chat/completions',
  writer_model: 'deepseek-v4-pro', validator_model: 'deepseek-flash', planner_model: 'deepseek-flash', provider_timeout_ms: 180000 });

export function validateProviderEndpoint(value, { allowInsecureLocalHttp = false } = {}) {
  let endpoint;
  try { endpoint = new URL(String(value || '')); } catch { throw new Error('API 地址无效。'); }
  if (endpoint.username || endpoint.password || endpoint.hash) throw new Error('API 地址不得包含凭据或片段。');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback && allowInsecureLocalHttp)) {
    throw new Error('远端 API 必须使用 HTTPS；本机 HTTP 需要单独确认风险。');
  }
  if (!endpoint.pathname || endpoint.pathname === '/') throw new Error('API 地址必须包含 Chat Completions 请求路径。');
  return endpoint.toString();
}

function requestCapabilities(preset, input = {}) {
  const defaults = preset.default_request_capabilities || {};
  return {
    temperature: input.temperature !== false && defaults.temperature !== false,
    response_format_json_object: input.response_format_json_object === true
      ? true : input.response_format_json_object === false ? false : defaults.response_format_json_object === true,
    max_tokens: input.max_tokens === true || (input.max_tokens == null && defaults.max_tokens === true)
  };
}

function defaultProviderEntry(presetId, providerId = presetId) {
  const preset = providerById(presetId);
  if (!preset || presetId === 'custom') throw new Error('自定义服务需要填写接口地址和模型 ID。');
  return {
    provider_id: safeProviderId(providerId), preset_id: presetId, display_name: preset.provider_name,
    endpoint: preset.endpoint, writer_model_id: preset.default_writer_model,
    validator_model_id: preset.default_validator_model || recommendedValidatorModel(presetId, preset.default_writer_model),
    request_capabilities: requestCapabilities(preset), writer_temperature: 0.75, validator_temperature: 0,
    timeout_ms: 180000, allow_insecure_local_http: false, config_version: 1,
    disclosure_confirmed_at: null, updated_at: null
  };
}

function normalizeEntry(raw, providerId) {
  const preset = providerById(raw.preset_id || providerId);
  if (!preset) throw new Error('未知的 AI 服务平台预设。');
  const allowLocal = raw.allow_insecure_local_http === true;
  const writerModel = validateModelId(raw.writer_model_id || preset.default_writer_model, 'Writer 模型 ID');
  const validatorModel = validateModelId(raw.validator_model_id || preset.default_validator_model || writerModel, 'Validator 模型 ID');
  return {
    provider_id: safeProviderId(providerId), preset_id: preset.provider_id,
    display_name: String(raw.display_name || preset.provider_name).trim().slice(0, 80),
    endpoint: validateProviderEndpoint(raw.endpoint || preset.endpoint, { allowInsecureLocalHttp: allowLocal }),
    writer_model_id: writerModel, validator_model_id: validatorModel,
    request_capabilities: requestCapabilities(preset, raw.request_capabilities),
    writer_temperature: Math.max(0, Math.min(2, Number(raw.writer_temperature ?? 0.75))),
    validator_temperature: Math.max(0, Math.min(2, Number(raw.validator_temperature ?? 0))),
    timeout_ms: Math.max(5000, Math.min(300000, Number(raw.timeout_ms) || 180000)),
    allow_insecure_local_http: allowLocal,
    config_version: Math.max(1, Math.trunc(Number(raw.config_version) || 1)),
    disclosure_confirmed_at: raw.disclosure_confirmed_at || null,
    updated_at: raw.updated_at || null
  };
}

function initialProviders() {
  return { deepseek: defaultProviderEntry('deepseek'), zhipu: defaultProviderEntry('zhipu') };
}

export const defaultProviderConfiguration = Object.freeze({
  schema_version: 3, registry_version: PROVIDER_REGISTRY_VERSION,
  selected_writer: Object.freeze({ provider_id: 'deepseek', model_id: 'deepseek-v4-pro' }),
  selected_validator: Object.freeze({ provider_id: 'deepseek', model_id: 'deepseek-flash' }),
  provider_timeout_ms: 180000, providers: Object.freeze(initialProviders()),
  migration: Object.freeze({ status: 'not_needed', source: null })
});

function normalizeConfiguration(input = {}) {
  const providers = {};
  const rawProviders = input.providers && typeof input.providers === 'object' ? input.providers : initialProviders();
  for (const [providerId, raw] of Object.entries(rawProviders)) providers[safeProviderId(providerId)] = normalizeEntry(raw, providerId);
  if (!Object.keys(providers).length) Object.assign(providers, initialProviders());
  const legacySelected = input.selected_provider_id;
  const writerRequested = input.selected_writer || { provider_id: legacySelected || DEFAULT_PROVIDER_ID,
    model_id: providers[legacySelected || DEFAULT_PROVIDER_ID]?.writer_model_id };
  const validatorRequested = input.selected_validator || { provider_id: legacySelected || DEFAULT_PROVIDER_ID,
    model_id: providers[legacySelected || DEFAULT_PROVIDER_ID]?.validator_model_id };
  const writerProvider = providers[writerRequested.provider_id] ? writerRequested.provider_id : Object.keys(providers)[0];
  const validatorProvider = providers[validatorRequested.provider_id] ? validatorRequested.provider_id : writerProvider;
  return {
    schema_version: 3, registry_version: PROVIDER_REGISTRY_VERSION,
    selected_writer: { provider_id: writerProvider,
      model_id: validateModelId(writerRequested.model_id || providers[writerProvider].writer_model_id) },
    selected_validator: { provider_id: validatorProvider,
      model_id: validateModelId(validatorRequested.model_id || providers[validatorProvider].validator_model_id) },
    provider_timeout_ms: Math.max(5000, Math.min(300000, Number(input.provider_timeout_ms) || 180000)), providers,
    migration: input.migration && typeof input.migration === 'object'
      ? { status: String(input.migration.status || 'not_needed'), source: input.migration.source || null }
      : { status: 'not_needed', source: null }
  };
}

function upgradeV2(parsed) {
  const providers = {};
  for (const [providerId, raw] of Object.entries(parsed.providers || {})) {
    if (!providerById(providerId) || providerId === 'custom') continue;
    providers[providerId] = { ...defaultProviderEntry(providerId), ...raw, preset_id: providerId,
      endpoint: providerById(providerId).endpoint };
  }
  const selected = providers[parsed.selected_provider_id] ? parsed.selected_provider_id : (providers.deepseek ? 'deepseek' : Object.keys(providers)[0]);
  return normalizeConfiguration({ ...parsed, providers,
    selected_writer: { provider_id: selected, model_id: providers[selected]?.writer_model_id },
    selected_validator: { provider_id: selected, model_id: providers[selected]?.validator_model_id },
    migration: { status: 'upgraded_v2', source: 'provider-config-v2' } });
}

export async function readProviderConfiguration(filename) {
  try {
    const parsed = JSON.parse(await readFile(filename, 'utf8'));
    if (parsed.schema_version === 3) return normalizeConfiguration(parsed);
    if (parsed.schema_version === 2) return upgradeV2(parsed);
    return { configuration: normalizeConfiguration({}), legacy: parsed };
  } catch { return normalizeConfiguration({}); }
}

export async function writeProviderConfiguration(filename, input) {
  const value = normalizeConfiguration(input);
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600).catch(() => {});
  return value;
}

export async function migrateLegacyProviderConfiguration({ filename, legacySecretStore, providerSecretStore }) {
  const loaded = await readProviderConfiguration(filename);
  if (!loaded?.legacy) {
    if (loaded.schema_version === 3 && loaded.migration?.status === 'upgraded_v2') return writeProviderConfiguration(filename, loaded);
    return loaded;
  }
  const legacy = { ...defaultProviderSettings, ...loaded.legacy };
  const presetId = inferProviderFromEndpoint(legacy.endpoint);
  const configuration = normalizeConfiguration({ migration: { status: presetId ? 'identified' : 'reconfirmation_required', source: 'legacy-single-provider' } });
  if (presetId && configuration.providers[presetId]) {
    configuration.providers[presetId].writer_model_id = validateModelId(legacy.writer_model || configuration.providers[presetId].writer_model_id);
    configuration.providers[presetId].validator_model_id = validateModelId(legacy.validator_model || configuration.providers[presetId].validator_model_id);
    configuration.selected_writer = { provider_id: presetId, model_id: configuration.providers[presetId].writer_model_id };
    configuration.selected_validator = { provider_id: presetId, model_id: configuration.providers[presetId].validator_model_id };
    if (legacySecretStore && await legacySecretStore.has()) {
      const secret = await legacySecretStore.get();
      if (secret && !await providerSecretStore.has(presetId)) await providerSecretStore.set(presetId, secret);
      configuration.migration.status = 'copied_preserved_legacy';
    }
  }
  return writeProviderConfiguration(filename, configuration);
}

export function updateProviderConfiguration(configuration, input) {
  const providerId = safeProviderId(input.provider_id || input.instance_id || configuration.selected_writer?.provider_id);
  const current = configuration.providers[providerId];
  const presetId = String(input.preset_id || current?.preset_id || providerId);
  const now = new Date().toISOString();
  const next = normalizeEntry({ ...(current || {}), ...input, preset_id: presetId,
    config_version: Number(current?.config_version || 0) + 1,
    disclosure_confirmed_at: input.disclosure_confirmed === true ? (current?.disclosure_confirmed_at || now) : current?.disclosure_confirmed_at,
    updated_at: now }, providerId);
  const selectedWriter = input.select_writer === false ? configuration.selected_writer
    : { provider_id: providerId, model_id: next.writer_model_id };
  const selectedValidator = input.select_validator === true
    ? { provider_id: providerId, model_id: next.validator_model_id }
    : configuration.selected_validator;
  return normalizeConfiguration({ ...configuration, providers: { ...configuration.providers, [providerId]: next },
    selected_writer: selectedWriter, selected_validator: selectedValidator });
}

export function selectProviderRoles(configuration, input = {}) {
  const writerProvider = safeProviderId(input.writer_provider_id || configuration.selected_writer.provider_id);
  const validatorProvider = safeProviderId(input.validator_provider_id || configuration.selected_validator.provider_id);
  if (!configuration.providers[writerProvider] || !configuration.providers[validatorProvider]) throw new Error('选择的 AI 服务不存在。');
  return normalizeConfiguration({ ...configuration,
    selected_writer: { provider_id: writerProvider,
      model_id: input.writer_model_id || configuration.providers[writerProvider].writer_model_id },
    selected_validator: { provider_id: validatorProvider,
      model_id: input.validator_model_id || configuration.providers[validatorProvider].validator_model_id } });
}

export function deleteProviderConfiguration(configuration, providerId) {
  const clean = safeProviderId(providerId);
  const providers = { ...configuration.providers };
  delete providers[clean];
  if (!Object.keys(providers).length) throw new Error('至少保留一个 AI 服务配置。');
  return normalizeConfiguration({ ...configuration, providers });
}

export function credentialReference(providerId, configVersion, secret) {
  const digest = createHash('sha256').update(String(secret || '')).digest('hex').slice(0, 16);
  return `${safeProviderId(providerId)}:v${Math.max(1, Number(configVersion) || 1)}:key:${digest}`;
}

export async function readProviderSettings(filename) {
  try { return { ...defaultProviderSettings, ...JSON.parse(await readFile(filename, 'utf8')) }; }
  catch { return { ...defaultProviderSettings }; }
}

export function validateProviderSettings(input) {
  return { endpoint: validateProviderEndpoint(input.endpoint || defaultProviderSettings.endpoint,
    { allowInsecureLocalHttp: input.allow_insecure_local_http === true }),
  writer_model: validateModelId(input.writer_model, 'Writer 模型'),
  validator_model: validateModelId(input.validator_model, 'Validator 模型'),
  planner_model: validateModelId(input.planner_model || input.validator_model, 'Planner 模型'),
  provider_timeout_ms: Math.max(5000, Math.min(300000, Number(input.provider_timeout_ms) || 180000)) };
}

export async function writeProviderSettings(filename, input) {
  const value = validateProviderSettings(input);
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600).catch(() => {});
  return value;
}
