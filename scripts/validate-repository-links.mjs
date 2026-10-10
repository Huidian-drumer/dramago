import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.cache', 'node_modules']);
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(?:md|html)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

async function targetExists(target) {
  try {
    const result = await stat(target);
    if (result.isFile()) return true;
    if (result.isDirectory()) {
      try { return (await stat(path.join(target, 'index.html'))).isFile() || result.isDirectory(); } catch { return result.isDirectory(); }
    }
  } catch {}
  return false;
}

function normalizeReference(raw) {
  let value = raw.trim();
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
  if (/\s+["']/.test(value)) value = value.split(/\s+["']/)[0];
  return value;
}

const files = await walk(root);
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const references = file.endsWith('.md')
    ? [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => normalizeReference(match[1]))
    : [...source.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map((match) => normalizeReference(match[1]));

  for (const reference of references) {
    if (!reference || /^(?:https?:|mailto:|data:|#|javascript:)/i.test(reference)) continue;
    const clean = decodeURIComponent(reference.split('#')[0].split('?')[0]);
    if (!clean || clean === '/') continue;

    let target;
    if (clean === '/dramago' || clean === '/dramago/') target = path.join(root, 'docs', 'index.html');
    else if (clean.startsWith('/dramago/')) target = path.join(root, 'docs', clean.slice('/dramago/'.length));
    else if (clean.startsWith('/')) continue; // Runtime routes/assets are validated by the build artifact gate.
    else target = path.resolve(path.dirname(file), clean);

    if (!await targetExists(target)) failures.push(`${relative}: broken local reference ${reference}`);
  }
}

if (failures.length) {
  console.error(`Repository link validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Repository link validation passed: ${files.length} Markdown/HTML files, 0 broken local links.`);
