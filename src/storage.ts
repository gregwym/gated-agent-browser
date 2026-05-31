import { chmod, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const STORAGE_DIR_NAMES = ["policies", "sessions", "approvals", "logs", "profiles"] as const;

export type StorageDirName = (typeof STORAGE_DIR_NAMES)[number];

export interface StorageLayout {
  home: string;
  dirs: Record<StorageDirName, string>;
}

export interface StorageInitSummary {
  ok: true;
  initialized: true;
  directories: StorageDirName[];
}

const RESTRICTED_DIR_MODE = 0o700;

export function resolveStorageHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GATED_AGENT_BROWSER_HOME?.trim();
  if (configured) {
    return resolve(configured);
  }
  return join(homedir(), ".local", "share", "gated-agent-browser");
}

export function storageLayout(home: string = resolveStorageHome()): StorageLayout {
  return {
    home,
    dirs: {
      policies: join(home, "policies"),
      sessions: join(home, "sessions"),
      approvals: join(home, "approvals"),
      logs: join(home, "logs"),
      profiles: join(home, "profiles"),
    },
  };
}

export async function initializeStorage(home: string = resolveStorageHome()): Promise<StorageInitSummary> {
  const layout = storageLayout(home);
  await ensureRestrictedDirectory(layout.home);

  for (const dirName of STORAGE_DIR_NAMES) {
    await ensureRestrictedDirectory(layout.dirs[dirName]);
  }

  return {
    ok: true,
    initialized: true,
    directories: [...STORAGE_DIR_NAMES],
  };
}

export async function directoryMode(path: string): Promise<number> {
  const stats = await stat(path);
  return stats.mode & 0o777;
}

async function ensureRestrictedDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: RESTRICTED_DIR_MODE });
  if (process.platform !== "win32") {
    await chmod(path, RESTRICTED_DIR_MODE);
  }
}
