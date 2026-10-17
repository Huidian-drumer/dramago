import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(moduleDirectory, '..');
const cacheRoot = path.join(root, '.cache');
await mkdir(cacheRoot, { recursive: true });
const candidateId = process.env.DRAMAGO_PORTABLE_CANDIDATE_ID || 'v1-4-legacy-validator-compat';
const zipName = process.env.DRAMAGO_PORTABLE_ZIP_NAME || 'DramaGo-v1.4-windows-x64-internal-legacy-validator-compat.zip';
if (!/^[a-z0-9-]+$/.test(candidateId) || !/^DramaGo-[A-Za-z0-9.-]+\.zip$/.test(zipName)) {
  throw new Error('Invalid portable candidate identifier or ZIP filename.');
}
const staging = await mkdtemp(path.join(cacheRoot, `desktop-staging-${candidateId}-`));
const artifacts = path.join(root, 'artifacts', 'windows');
const packageOutput = path.join(artifacts, candidateId);
const packageDirectory = path.join(packageOutput, 'DramaGo-win32-x64');
const executable = path.join(packageDirectory, 'DramaGo.exe');
const zipFile = path.join(artifacts, zipName);
const manifestFile = path.join(artifacts, `portable-manifest-${candidateId}.json`);
const electronZipName = 'electron-v44.7.0-win32-x64.zip';
const runtimeEntries = [
  path.join('desktop', 'utility', 'service.mjs'),
  path.join('desktop', 'utility', 'compatibility-probe.mjs'),
  path.join('worker', 'provider-registry.mjs'),
  'local',
  path.join('dist', 'server'),
  'drizzle'
];

async function findCachedElectronZipDirectory() {
  const configured = process.env.ELECTRON_ZIP_DIR?.trim();
  if (configured) return configured;
  const cache = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'electron', 'Cache') : null;
  if (!cache) return null;
  const entries = await readdir(cache, { recursive: true, withFileTypes: true }).catch(() => []);
  const match = entries.find((entry) => entry.isFile() && entry.name === electronZipName);
  return match ? match.parentPath : null;
}

async function runtimeIntegrityManifest() {
  const files = {};
  async function include(relative) {
    const absolute = path.join(staging, relative);
    const details = await stat(absolute);
    if (details.isDirectory()) {
      for (const child of (await readdir(absolute)).sort()) await include(path.join(relative, child));
      return;
    }
    files[relative.replaceAll('\\', '/')] = createHash('sha256').update(await readFile(absolute)).digest('hex');
  }
  for (const entry of runtimeEntries) await include(entry);
  return { algorithm: 'sha256', files };
}

if (!path.resolve(staging).startsWith(`${path.resolve(cacheRoot)}${path.sep}`)) throw new Error('Unsafe staging path.');
for (const target of [packageOutput, zipFile, manifestFile]) {
  if (await stat(target).then(() => true, () => false)) throw new Error(`Refusing to overwrite existing package artifact: ${target}`);
}

for (const directory of ['desktop', 'local', path.join('dist', 'server')]) {
  await cp(path.join(root, directory), path.join(staging, directory), { recursive: true });
}
await mkdir(path.join(staging, 'worker'), { recursive: true });
await cp(path.join(root, 'worker', 'provider-registry.mjs'), path.join(staging, 'worker', 'provider-registry.mjs'));
await mkdir(path.join(staging, 'drizzle'), { recursive: true });
for (const migration of ['0000_low_the_fallen.sql', '0001_kind_the_spike.sql', '0002_conscious_oracle.sql',
  '0003_transport_attempts_and_version_restores.sql', '0004_multi_provider_and_task_control.sql',
  '0005_candidate_validation_runs.sql', '0006_story_memory_snapshots.sql', '0007_open_model_api_routes.sql',
  '0008_text_studio_completion_and_planning.sql', '0009_stability_and_creative_intelligence.sql']) {
  await cp(path.join(root, 'drizzle', migration), path.join(staging, 'drizzle', migration));
}
await writeFile(path.join(staging, 'package.json'), `${JSON.stringify({
  name: 'dramago-desktop',
  productName: 'DramaGo',
  version: '0.5.0',
  private: true,
  type: 'module',
  main: 'desktop/main.mjs'
}, null, 2)}\n`);
await writeFile(
  path.join(staging, 'runtime-integrity.json'),
  `${JSON.stringify(await runtimeIntegrityManifest(), null, 2)}\n`
);

await mkdir(artifacts, { recursive: true });
const electronZipDir = await findCachedElectronZipDirectory();
await packager({
  dir: staging,
  out: packageOutput,
  name: 'DramaGo',
  executableName: 'DramaGo',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '44.7.0',
  appVersion: '0.5.0',
  asar: {
    unpackDir: '{desktop/utility,local,dist,drizzle,worker}'
  },
  overwrite: false,
  prune: true,
  ...(electronZipDir ? { electronZipDir } : { download: { cacheRoot: path.join(root, 'node_modules', '.cache', 'electron') } }),
  win32metadata: {
    CompanyName: 'DramaGo',
    FileDescription: 'DramaGo AI 短剧创作工作台',
    InternalName: 'DramaGo',
    OriginalFilename: 'DramaGo.exe',
    ProductName: 'DramaGo'
  }
});

await flipFuses(executable, {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // Official generic Electron archives contain v8_context_snapshot.bin, not the
  // optional browser_v8_context_snapshot.bin required when this fuse is enabled.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true
});

const archive = spawnSync('tar.exe', ['-a', '-c', '-f', zipFile, '-C', packageOutput, path.basename(packageDirectory)], {
  encoding: 'utf8',
  windowsHide: true
});
if (archive.status !== 0) throw new Error(`Portable archive failed: ${archive.stderr || archive.stdout}`);

const bytes = await readFile(zipFile);
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (gitCommit.status !== 0) throw new Error('Unable to resolve source Git commit.');
const gitStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (gitStatus.status !== 0) throw new Error('Unable to inspect source worktree state.');
const manifest = {
  created_at: new Date().toISOString(),
  candidate_id: candidateId,
  source_git_commit: gitCommit.stdout.trim(),
  source_worktree_dirty: Boolean(gitStatus.stdout.trim()),
  electron: '44.7.0',
  node: '24.21.0',
  platform: 'win32',
  arch: 'x64',
  signed: false,
  executable: path.relative(root, executable).replaceAll('\\', '/'),
  package_directory: path.relative(root, packageDirectory).replaceAll('\\', '/'),
  archive: path.relative(root, zipFile).replaceAll('\\', '/'),
  archive_bytes: (await stat(zipFile)).size,
  archive_sha256: createHash('sha256').update(bytes).digest('hex'),
  fuses: await getCurrentFuseWire(executable)
};
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ package_directory: packageDirectory, archive: zipFile, manifest: manifestFile,
  archive_bytes: manifest.archive_bytes, archive_sha256: manifest.archive_sha256,
  source_git_commit: manifest.source_git_commit, source_worktree_dirty: manifest.source_worktree_dirty }, null, 2));
