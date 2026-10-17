export class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

export class MissingTextProvider {
  async generateText() {
    throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Text Provider is not configured. No draft was generated.');
  }
}

export class OpenAICompatibleTextProvider {
  constructor({ endpoint, apiKey, model, fetchImpl = globalThis.fetch }) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async generateText({ system, user, temperature = 0.7 }) {
    if (!this.endpoint || !this.apiKey || !this.model) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Endpoint, API key and model are required.');
    }
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    });
    if (!response.ok) {
      throw new ProviderError('PROVIDER_REQUEST_FAILED', `Provider returned HTTP ${response.status}.`, { status: response.status });
    }
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError('PROVIDER_EMPTY_RESPONSE', 'Provider returned no text content.');
    return {
      text,
      usage: payload.usage || null,
      provider: 'openai-compatible',
      model: payload.model || this.model,
      authenticProviderCall: true
    };
  }

  async repairText({ system, user }) {
    return this.generateText({ system, user, temperature: 0.35 });
  }
}

// Test-only adapter. It validates an externally generated draft but never claims
// that the product Provider produced it.
export class ExternalDraftAdapter {
  constructor({ draftText, source = 'external-model-session', model = 'unreported' }) {
    this.draftText = draftText;
    this.source = source;
    this.model = model;
  }

  async generateText() {
    if (!this.draftText) throw new ProviderError('EXTERNAL_DRAFT_MISSING', 'No external draft was supplied.');
    return {
      text: this.draftText,
      usage: null,
      provider: this.source,
      model: this.model,
      authenticProviderCall: false,
      generationMode: 'EXTERNAL_MODEL_SESSION_INPUT'
    };
  }
}
