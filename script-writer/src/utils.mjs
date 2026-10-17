import { createHash } from 'node:crypto';

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function countHanAndWords(value) {
  const han = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (value.match(/[A-Za-z0-9]+/g) || []).length;
  return han + words;
}

export function locate(text, index) {
  const safeIndex = Math.max(0, index);
  const before = text.slice(0, safeIndex);
  const line = before.split('\n').length;
  const paragraphs = text.slice(0, safeIndex).split(/\n\s*\n/);
  return { line, paragraph: paragraphs.length };
}

export function excerpt(text, index, length = 72) {
  const start = Math.max(0, index - 18);
  return text.slice(start, Math.min(text.length, index + length)).replace(/\s+/g, ' ').trim();
}

export function readerFacingText(draft) {
  return [draft.title, draft.identityOpening, draft.body].filter(Boolean).join('\n\n');
}

export function normalizeDraft(draft) {
  return {
    title: String(draft.title || '').trim(),
    identityOpening: String(draft.identityOpening || '').trim(),
    body: String(draft.body || '').trim()
  };
}

export function parseDraftMarkdown(markdown) {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const titleLine = lines.findIndex((line) => /^#\s+/.test(line));
  if (titleLine < 0) throw new Error('Draft must begin with a level-one title.');
  const title = lines[titleLine].replace(/^#\s+/, '').trim();
  const content = lines.slice(titleLine + 1).join('\n').trim();
  const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
  if (paragraphs.length < 2) throw new Error('Draft must contain an identity opening and continuous body.');
  return normalizeDraft({ title, identityOpening: paragraphs[0], body: paragraphs.slice(1).join('\n\n') });
}

export function issueKey(issue) {
  return `${issue.issue_type}:${issue.location?.paragraph ?? 0}:${issue.quote ?? ''}`;
}
