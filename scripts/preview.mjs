import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const port = Number(process.argv[2] || 4173);
const routes = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/workbench.css', ['web/styles.css', 'text/css; charset=utf-8']],
  ['/workbench.js', ['web/app.js', 'text/javascript; charset=utf-8']]
]);

createServer(async (request, response) => {
  if (request.url === '/api/bootstrap') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ work: null, current_version: null, versions: [], provider: { configured: false, missing: ['OPENAI_API_KEY', 'OPENAI_MODEL'] } }));
    return;
  }
  if (request.url === '/api/generate' && request.method === 'POST') {
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'PROVIDER_NOT_CONFIGURED', message: '文本模型尚未配置：缺少 OPENAI_API_KEY、OPENAI_MODEL。请在 Sites 项目的服务端环境变量中设置。', details: { missing: ['OPENAI_API_KEY', 'OPENAI_MODEL'] } } }));
    return;
  }
  const route = routes.get(request.url);
  if (!route) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'content-type': route[1] });
  response.end(await readFile(path.join(root, route[0])));
}).listen(port, '127.0.0.1', () => console.log(`Preview ready at http://127.0.0.1:${port}`));
