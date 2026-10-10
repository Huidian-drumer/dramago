import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsRoot = path.join(root, 'docs');
const required = [
  'index.html', '404.html', 'product/index.html', 'guide/index.html',
  'guide/quick-start.html', 'guide/concepts.html', 'guide/operations.html',
  'guide/architecture.html', 'guide/capability-boundaries.html', 'guide/reference.html',
  'guide/provenance.html', 'experiments/index.html',
  'changelog/index.html', 'roadmap/index.html', 'assets/tokens.css',
  'assets/site.css', 'assets/site.js', 'sitemap.xml'
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function exists(target) {
  try { return (await stat(target)).isFile(); } catch { return false; }
}

const failures = [];
for (const relative of required) {
  if (!await exists(path.join(docsRoot, relative))) failures.push(`Missing required page: docs/${relative}`);
}

const htmlFiles = (await walk(docsRoot)).filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  const relativeFile = path.relative(root, file).replaceAll('\\', '/');
  const source = await readFile(file, 'utf8');
  if (!source.includes('<main')) failures.push(`${relativeFile}: missing <main>`);
  if (!source.includes('data-theme-picker')) failures.push(`${relativeFile}: missing theme picker`);
  if (/v0\.2|10\/10|WRAPPER_AUDIT_RESULTS\.json|CREATIVE_TRACE_SAMPLE\.json/.test(source)) {
    failures.push(`${relativeFile}: contains stale release or removed evidence reference`);
  }

  const refs = [...source.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(?:https?:|mailto:|#|data:)/.test(ref)) continue;
    const withoutHash = ref.split('#')[0].split('?')[0];
    if (!withoutHash) continue;
    let target;
    if (withoutHash.startsWith('/dramago/')) target = path.join(docsRoot, withoutHash.slice('/dramago/'.length));
    else if (withoutHash === '/dramago') target = path.join(docsRoot, 'index.html');
    else target = path.resolve(path.dirname(file), withoutHash);
    try {
      const targetStat = await stat(target);
      if (targetStat.isDirectory()) target = path.join(target, 'index.html');
    } catch {}
    if (!await exists(target)) failures.push(`${relativeFile}: broken local reference ${ref}`);
  }
}

const index = await readFile(path.join(docsRoot, 'index.html'), 'utf8');
for (const phrase of ['Validated MVP', 'Content Intelligence', 'selective—not universal', 'not a production SaaS', 'Demo access may be required']) {
  if (!index.includes(phrase)) failures.push(`docs/index.html: missing release truth "${phrase}"`);
}

if (failures.length) {
  console.error(`Documentation validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation validation passed: ${htmlFiles.length} HTML pages, ${required.length} required assets/pages.`);
