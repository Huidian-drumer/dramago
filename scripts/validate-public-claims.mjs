import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const auditRelative = 'reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md';
const expectedAuditSha256 = 'db6bac90fb0fdf6bfb044d2bf92037c4aaf1ea22d76b935b2a8543e7834956e6';

async function exists(relative) {
  try { return (await stat(path.join(root, relative))).isFile(); } catch { return false; }
}

async function text(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function requireFile(relative) {
  if (!await exists(relative)) failures.push(`Missing required public-claims artifact: ${relative}`);
}

function requireAll(source, relative, phrases) {
  for (const phrase of phrases) {
    if (!source.includes(phrase)) failures.push(`${relative}: missing required claim boundary "${phrase}"`);
  }
}

for (const relative of [
  'PROVENANCE.md',
  'docs/PROVENANCE.md',
  'docs/CAPABILITY_BOUNDARIES.md',
  'docs/errata/v0.5.0-capability-clarifications.md',
  'docs/guide/capability-boundaries.html',
  'docs/guide/provenance.html',
  'reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md',
  'reports/audit/P1_CREDIBILITY_ALIGNMENT_REPORT.md'
]) await requireFile(relative);

const readme = await text('README.md');
requireAll(readme, 'README.md', [
  'docs/CAPABILITY_BOUNDARIES.md',
  'docs/PROVENANCE.md',
  'reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md',
  'v0.5.0 前台没有该开关',
  '项目内部定义的 L2',
  'It does not mean market validation'
]);

const boundaries = await text('docs/CAPABILITY_BOUNDARIES.md');
requireAll(boundaries, 'docs/CAPABILITY_BOUNDARIES.md', [
  'The Writer does not consume Story Facts directly',
  'not exposed as a toggle in the v0.5.0 UI',
  'Mechanism selection and Writer fulfillment remain model-mediated',
  'project-specific Wrapper maturity rubric',
  'does **not** mean market validation',
  'separate model-assisted semantic-validation stage with programmatic enforcement'
]);

const legacyReadme = await text('script-writer/README.md');
requireAll(legacyReadme, 'script-writer/README.md', [
  '# Legacy Experiment — Script Writer V0.1',
  'Not imported by the current Worker runtime',
  'not part of the v0.5.0 authoring path'
]);

const legacyExperience = await text('dist/index.html');
requireAll(legacyExperience, 'dist/index.html', [
  '<meta name="robots" content="noindex" />',
  'Legacy Interactive Experiment｜历史互动实验',
  '不是当前 DramaGo 作者工作流'
]);

const runtimeFiles = ['worker/core.mjs', 'worker/index.mjs', 'web/app.js', 'db/schema.ts'];
for (const relative of runtimeFiles) {
  const source = await text(relative);
  if (/script-writer|script_writer/i.test(source)) failures.push(`${relative}: current runtime unexpectedly references legacy script-writer`);
}

if (await exists(auditRelative)) {
  const audit = await readFile(path.join(root, auditRelative));
  const actual = createHash('sha256').update(audit).digest('hex');
  if (actual !== expectedAuditSha256) failures.push(`${auditRelative}: immutable audit hash changed (${actual})`);
}

if (failures.length) {
  console.error(`Public claim validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Public claim validation passed: capability, provenance, legacy and immutable-audit boundaries are present.');
