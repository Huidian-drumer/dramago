export const PROVIDER_REGISTRY_VERSION = '2026-10-14.2';
export const OPENAI_CHAT_COMPLETIONS_PROTOCOL = 'openai-chat-completions';

function model(modelId, displayName, capabilities, recommendedValidator = modelId) {
  return Object.freeze({ model_id: modelId, display_name: displayName,
    capabilities: Object.freeze(capabilities), recommended_validator: recommendedValidator,
    compatibility: 'preset_example_not_runtime_guarantee' });
}

function preset(definition) {
  return Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL, allow_custom_models: true,
    default_request_capabilities: Object.freeze({ temperature: true, response_format_json_object: false, max_tokens: false }),
    ...definition, models: Object.freeze(definition.models || []) });
}

const registry = Object.freeze({
  deepseek: preset({ provider_id: 'deepseek', provider_name: 'DeepSeek 官方 API',
    endpoint: 'https://api.deepseek.com/chat/completions', default_writer_model: 'deepseek-v4-pro',
    default_validator_model: 'deepseek-flash',
    default_request_capabilities: Object.freeze({ temperature: true, response_format_json_object: true, max_tokens: false }),
    compatibility: Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL, status: 'official_documented',
      verified_at: '2026-10-14', source: 'https://api-docs.deepseek.com/api/create-chat-completion/' }),
    models: [model('deepseek-v4-pro', 'DeepSeek V4 Pro', ['writer', 'planner', 'json_output'], 'deepseek-flash'),
      model('deepseek-flash', 'DeepSeek Flash', ['writer', 'validator', 'planner', 'json_output'], 'deepseek-flash')] }),
  zhipu: preset({ provider_id: 'zhipu', provider_name: '智谱 GLM 官方 API',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', default_writer_model: 'glm-4.7',
    default_validator_model: 'glm-4.7-flash',
    default_request_capabilities: Object.freeze({ temperature: true, response_format_json_object: true, max_tokens: false }),
    compatibility: Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL, status: 'official_documented',
      verified_at: '2026-10-14', source: 'https://docs.bigmodel.cn/cn/guide/start/model-overview' }),
    models: [model('glm-4.7', 'GLM-4.7', ['writer', 'planner', 'json_output'], 'glm-4.7-flash'),
      model('glm-4.7-flash', 'GLM-4.7-Flash', ['writer', 'validator', 'planner', 'json_output'], 'glm-4.7-flash')] }),
  qwen_bailian: preset({ provider_id: 'qwen_bailian', provider_name: '阿里云百炼 / Qwen',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', default_writer_model: 'qwen-plus',
    default_validator_model: 'qwen-plus',
    compatibility: Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL,
      status: 'official_documented_legacy_domain', verified_at: '2026-10-14',
      source: 'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/',
      note: '业务空间专属域名需在高级设置中填写；模型和参数能力以所属地域文档为准。' }),
    models: [model('qwen-plus', 'Qwen Plus', ['writer', 'validator', 'planner'])] }),
  siliconflow: preset({ provider_id: 'siliconflow', provider_name: '硅基流动 SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions', default_writer_model: 'deepseek-ai/DeepSeek-V3.2',
    default_validator_model: 'deepseek-ai/DeepSeek-V3.2',
    default_request_capabilities: Object.freeze({ temperature: true, response_format_json_object: true, max_tokens: true }),
    compatibility: Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL, status: 'official_documented',
      verified_at: '2026-10-14', source: 'https://docs.siliconflow.cn/docs/userguide/quickstart',
      note: '平台模型会动态上下线；预设模型只是示例。' }),
    models: [model('deepseek-ai/DeepSeek-V3.2', 'DeepSeek V3.2（示例）', ['writer', 'validator', 'planner', 'json_output'])] }),
  openrouter: preset({ provider_id: 'openrouter', provider_name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions', default_writer_model: 'openrouter/free',
    default_validator_model: 'openrouter/free',
    compatibility: Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL, status: 'official_documented_gateway',
      verified_at: '2026-10-14', source: 'https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request',
      note: '参数和结构化输出能力取决于下游模型；默认不发送 response_format。' }),
    models: [model('openrouter/free', 'OpenRouter Free Router（示例）', ['writer', 'validator', 'planner'])] }),
  custom: preset({ provider_id: 'custom', provider_name: '自定义 OpenAI 兼容接口', endpoint: null,
    default_writer_model: '', default_validator_model: '',
    compatibility: Object.freeze({ protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL, status: 'user_supplied_unverified',
      verified_at: null, source: null,
      note: '只支持 OpenAI-compatible Chat Completions；不代表支持原生 Anthropic、Gemini 或其他协议。' }), models: [] })
});

export const DEFAULT_PROVIDER_ID = 'deepseek';
export const DEFAULT_WRITER_MODEL_BY_PROVIDER = Object.freeze(Object.fromEntries(
  Object.values(registry).map((item) => [item.provider_id, item.default_writer_model])
));

function publicProvider(provider) {
  return { provider_id: provider.provider_id, provider_name: provider.provider_name, endpoint: provider.endpoint,
    protocol: provider.protocol, allow_custom_models: provider.allow_custom_models,
    default_writer_model: provider.default_writer_model, default_validator_model: provider.default_validator_model,
    default_request_capabilities: provider.default_request_capabilities, compatibility: provider.compatibility,
    models: provider.models };
}

export function listProviders() { return Object.values(registry).map(publicProvider); }
export function providerById(providerId) { return registry[String(providerId || '')] || null; }

export function modelForProvider(providerId, modelId, capability = null) {
  const provider = providerById(providerId);
  if (!provider) return null;
  const found = provider.models.find((item) => item.model_id === String(modelId || '')) || null;
  return !found || (capability && !found.capabilities.includes(capability)) ? null : found;
}

export function validateModelId(modelId, field = '模型 ID') {
  const value = String(modelId || '').trim();
  if (!value || value.length > 180 || /[\u0000-\u001f\u007f]/u.test(value)) {
    const error = new Error(`${field} 无效。`); error.code = 'MODEL_ID_INVALID'; throw error;
  }
  return value;
}

export function assertProviderModel(providerId, modelId, capability = 'writer', options = {}) {
  const provider = providerById(providerId);
  if (!provider) { const error = new Error('不支持该模型平台预设。'); error.code = 'PROVIDER_NOT_ALLOWED'; throw error; }
  const cleanModelId = validateModelId(modelId);
  const known = modelForProvider(providerId, cleanModelId, capability);
  if (!known && options.allowCustom !== true) {
    const error = new Error(`模型 ${cleanModelId} 不在 ${provider.provider_name} 的已登记示例列表中。`);
    error.code = 'MODEL_NOT_ALLOWED'; throw error;
  }
  return { provider, model: known || { model_id: cleanModelId, display_name: cleanModelId,
    capabilities: [capability], recommended_validator: cleanModelId, compatibility: 'user_configured_unverified' } };
}

export function recommendedValidatorModel(providerId, writerModelId) {
  const provider = providerById(providerId);
  if (!provider) throw Object.assign(new Error('不支持该模型平台预设。'), { code: 'PROVIDER_NOT_ALLOWED' });
  return modelForProvider(providerId, writerModelId, 'writer')?.recommended_validator
    || provider.default_validator_model || validateModelId(writerModelId);
}

export function inferProviderFromEndpoint(endpoint) {
  let normalized;
  try { normalized = new URL(String(endpoint || '')).toString().replace(/\/$/u, ''); } catch { return null; }
  return Object.values(registry).find((provider) => provider.endpoint?.replace(/\/$/u, '') === normalized)?.provider_id || null;
}
