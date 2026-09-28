import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const workerPath = path.join(root, 'dist', 'server', 'index.js');
const [source, manifest, assets] = await Promise.all([
  readFile(workerPath, 'utf8'),
  readFile(path.join(root, 'dist', '.openai', 'hosting.json'), 'utf8'),
  readFile(path.join(root, 'dist', 'server', 'assets.mjs'), 'utf8')
]);
const parsed = JSON.parse(manifest);
assert.equal(parsed.d1, 'DB');
assert.match(source, /export default/);
assert.match(source, /async fetch/);
assert.match(assets, /AI 短剧创作工作台/);
assert.doesNotMatch(assets, /请输入 API Key/);
console.log('Artifact is valid and contains no client-side key input.');
