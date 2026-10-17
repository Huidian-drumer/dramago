import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeCheckedOutText(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

export function readHeadBlob(root, relative) {
  const gitRelative = relative.split(path.sep).join('/');
  return execFileSync('git', ['show', `HEAD:${gitRelative}`], {
    cwd: root,
    encoding: null,
    maxBuffer: 20 * 1024 * 1024
  });
}

export async function verifyImmutableGitFile({ root, relative, expectedSha256 }) {
  const canonical = readHeadBlob(root, relative);
  const checkedOut = await readFile(path.join(root, relative));
  const canonicalSha256 = sha256(canonical);
  const normalizedCheckedOut = normalizeCheckedOutText(checkedOut);

  return {
    canonicalSha256,
    canonicalHashMatches: canonicalSha256 === expectedSha256,
    workingTreeMatches: normalizedCheckedOut.equals(canonical),
    workingTreeSha256: sha256(checkedOut),
    normalizedWorkingTreeSha256: sha256(normalizedCheckedOut)
  };
}
