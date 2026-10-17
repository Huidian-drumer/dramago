import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import worker from '../dist/server/index.js';
import { FakeD1 } from '../audit/fake-d1.mjs';

const port = Number(process.argv[2] || 4182);
const providerEnvFile = process.env.DRAMAGO_PROVIDER_ENV_FILE;

if (!providerEnvFile) {
  throw new Error('DRAMAGO_PROVIDER_ENV_FILE must point to an untracked local environment file.');
}

function parseEnv(source) {
  const entries = {};
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[match[1]] = value;
  }
  return entries;
}

const localProviderEnv = parseEnv(await readFile(providerEnvFile, 'utf8'));
if (!localProviderEnv.OPENAI_API_KEY?.trim()) {
  throw new Error('The selected local environment file does not contain OPENAI_API_KEY.');
}

const env = {
  DB: new FakeD1(),
  OPENAI_API_KEY: localProviderEnv.OPENAI_API_KEY.trim(),
  OPENAI_ENDPOINT: localProviderEnv.OPENAI_ENDPOINT || 'https://api.deepseek.com/chat/completions',
  OPENAI_MODEL: localProviderEnv.OPENAI_MODEL || 'deepseek-v4-pro',
  VALIDATOR_MODEL: localProviderEnv.VALIDATOR_MODEL || 'deepseek-flash',
  PROVIDER_TIMEOUT_MS: localProviderEnv.PROVIDER_TIMEOUT_MS || '180000'
};

async function nodeRequestToWeb(request) {
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : Buffer.concat(await Array.fromAsync(request)).toString('utf8');
  return new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body
  });
}

const server = createServer(async (request, response) => {
  try {
    const result = await worker.fetch(await nodeRequestToWeb(request), env);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'LOCAL_PREVIEW_FAILURE', message: error.message } }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DramaGo isolated real-provider preview ready at http://127.0.0.1:${port}`);
  console.log(`Writer ${env.OPENAI_MODEL}; Validator ${env.VALIDATOR_MODEL}; independent in-memory database.`);
  console.log('The provider credential remains in the external local environment file and is never printed or copied.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
