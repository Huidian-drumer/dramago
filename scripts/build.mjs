import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const legacyHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
const legacyJs = await readFile(path.join(dist, 'app.js'), 'utf8');
const [html, css, clientJs, workerSource, coreSource, manifest] = await Promise.all([
  readFile(path.join(root, 'web', 'index.html'), 'utf8'),
  readFile(path.join(root, 'web', 'styles.css'), 'utf8'),
  readFile(path.join(root, 'web', 'app.js'), 'utf8'),
  readFile(path.join(root, 'worker', 'index.mjs'), 'utf8'),
  readFile(path.join(root, 'worker', 'core.mjs'), 'utf8'),
  readFile(path.join(root, '.openai', 'hosting.json'), 'utf8')
]);

const legacyPatched = legacyHtml
  .replace('<script src="app.js"></script>', '<script src="/experience/app.js"></script>')
  .replace('<body>', '<body><a href="/" style="position:fixed;z-index:100;top:12px;right:12px;padding:8px 12px;border-radius:999px;background:#f05b65;color:white;text-decoration:none;font:13px system-ui">实验体验 · 返回创作工作台</a>');

const assetsSource = [
  `export const workbenchHtml = ${JSON.stringify(html)};`,
  `export const workbenchCss = ${JSON.stringify(css)};`,
  `export const workbenchJs = ${JSON.stringify(clientJs)};`,
  `export const legacyHtml = ${JSON.stringify(legacyPatched)};`,
  `export const legacyJs = ${JSON.stringify(legacyJs)};`
].join('\n');

await rm(path.join(dist, 'server'), { recursive: true, force: true });
await rm(path.join(dist, '.openai'), { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });
await writeFile(path.join(dist, 'server', 'index.js'), workerSource, 'utf8');
await writeFile(path.join(dist, 'server', 'core.mjs'), coreSource, 'utf8');
await writeFile(path.join(dist, 'server', 'assets.mjs'), assetsSource, 'utf8');
await writeFile(path.join(dist, '.openai', 'hosting.json'), manifest, 'utf8');
try {
  await cp(path.join(root, 'drizzle'), path.join(dist, '.openai', 'drizzle'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log('Built DramaGo Creative Workbench Worker artifact.');
