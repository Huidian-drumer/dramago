import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function resolveDataRoot(override = process.env.DRAMAGO_DATA_DIR) {
  if (override) return path.resolve(override);
  const windowsAppData = process.env.APPDATA;
  if (process.platform === 'win32' && windowsAppData) return path.join(windowsAppData, 'DramaGo');
  return path.join(os.homedir(), '.dramago');
}

export function localPaths(override) {
  const root = resolveDataRoot(override);
  return {
    root,
    data: path.join(root, 'data'),
    backups: path.join(root, 'backups'),
    config: path.join(root, 'config'),
    database: path.join(root, 'data', 'dramago.sqlite'),
    providerConfig: path.join(root, 'config', 'provider.json'),
    authoringState: path.join(root, 'config', 'authoring-state.json'),
    providerSecret: path.join(root, 'config', 'provider-key.dpapi'),
    providerSecrets: path.join(root, 'config', 'provider-keys'),
    lock: path.join(root, 'dramago.lock')
  };
}

export async function ensureLocalDirectories(paths) {
  await Promise.all([
    mkdir(paths.data, { recursive: true }),
    mkdir(paths.backups, { recursive: true }),
    mkdir(paths.config, { recursive: true }),
    mkdir(paths.providerSecrets, { recursive: true })
  ]);
}
