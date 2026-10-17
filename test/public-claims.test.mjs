import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCheckedOutText, sha256, verifyImmutableGitFile } from '../scripts/lib/git-canonical-file.mjs';

const auditRelative = 'reports/audit/DRAMAGO_FULL_NON_WRAPPER_RED_TEAM_AUDIT_V1.md';
const expectedAuditSha256 = 'db6bac90fb0fdf6bfb044d2bf92037c4aaf1ea22d76b935b2a8543e7834956e6';

test('immutable text normalization makes LF and Windows CRLF equivalent', () => {
  const lf = Buffer.from('first\nsecond\n', 'utf8');
  const crlf = Buffer.from('first\r\nsecond\r\n', 'utf8');

  assert.deepEqual(normalizeCheckedOutText(crlf), lf);
  assert.equal(sha256(normalizeCheckedOutText(crlf)), sha256(lf));
});

test('immutable text normalization still detects substantive changes', () => {
  const canonical = Buffer.from('first\nsecond\n', 'utf8');
  const changed = Buffer.from('first\r\nchanged\r\n', 'utf8');

  assert.notDeepEqual(normalizeCheckedOutText(changed), canonical);
  assert.notEqual(sha256(normalizeCheckedOutText(changed)), sha256(canonical));
});

test('public audit matches canonical Git bytes and the checked-out content', async () => {
  const result = await verifyImmutableGitFile({
    root: process.cwd(),
    relative: auditRelative,
    expectedSha256: expectedAuditSha256
  });

  assert.equal(result.canonicalHashMatches, true);
  assert.equal(result.workingTreeMatches, true);
  assert.equal(result.canonicalSha256, expectedAuditSha256);
  assert.equal(result.normalizedWorkingTreeSha256, expectedAuditSha256);
});
