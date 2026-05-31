import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { appendAuditEvent } from "./audit.js";
import YAML from "yaml";
import { loadPolicy, normalizePolicy, type SitePolicy } from "./policy.js";
import { storageLayout, type StorageLayout } from "./storage.js";

export interface PolicySummary {
  site: string;
  version: number;
  canonicalOrigin: string;
  path: string;
  updatedAt?: string;
}

export interface PolicyEditResult {
  ok: true;
  site: string;
  saved: true;
}

export interface SavePolicyResult {
  ok: true;
  site: string;
  saved: true;
  path: string;
}

export interface ArchivePolicyResult {
  site: string;
  archived: boolean;
}

export async function listPolicies(layout: StorageLayout = storageLayout()): Promise<PolicySummary[]> {
  const entries = await readdir(layout.dirs.policies, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const policyFiles = entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")))
    .map((entry) => join(layout.dirs.policies, entry.name));

  const summaries = await Promise.all(policyFiles.map(readPolicySummary));
  return summaries.sort((a, b) => a.site.localeCompare(b.site));
}

export async function showPolicy(site: string, layout: StorageLayout = storageLayout()): Promise<SitePolicy> {
  return loadPolicy(policyFilePath(site, layout));
}

export async function savePolicy(
  policy: SitePolicy,
  options: { layout?: StorageLayout } = {},
): Promise<SavePolicyResult> {
  const layout = options.layout ?? storageLayout();
  const normalized = normalizePolicy(policy);
  const path = policyFilePath(normalized.site, layout);
  await mkdir(layout.dirs.policies, { recursive: true, mode: 0o700 });
  await writeFile(path, YAML.stringify(normalized), { mode: 0o600 });
  return { ok: true, site: normalized.site, saved: true, path: basename(path) };
}

export async function archivePolicy(
  site: string,
  options: { layout?: StorageLayout; archivedAt?: string } = {},
): Promise<ArchivePolicyResult> {
  const layout = options.layout ?? storageLayout();
  const policyPath = policyFilePath(site, layout);
  const timestamp = (options.archivedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const archiveDir = join(layout.dirs.policies, "revoked");
  const archivePath = join(archiveDir, `${site}.${timestamp}.yaml`);
  await mkdir(archiveDir, { recursive: true, mode: 0o700 });
  try {
    await rename(policyPath, archivePath);
    return { site, archived: true };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { site, archived: false };
    }
    throw error;
  }
}

export async function editPolicy(
  site: string,
  options: { editor?: string; layout?: StorageLayout } = {},
): Promise<PolicyEditResult> {
  const layout = options.layout ?? storageLayout();
  const policyPath = policyFilePath(site, layout);
  const editor = options.editor ?? process.env.EDITOR ?? process.env.VISUAL;
  if (!editor) {
    throw new Error("EDITOR or VISUAL must be set for policy edit");
  }

  const original = await readFile(policyPath, "utf8");
  const tempPath = `${policyPath}.${process.pid}.tmp`;
  await writeFile(tempPath, original, { mode: 0o600 });

  try {
    await runEditor(editor, tempPath);
    const normalized = normalizePolicy(YAML.parse(await readFile(tempPath, "utf8")));
    await rename(tempPath, policyPath);
    await appendAuditEvent(
      {
        type: "policy.updated",
        timestamp: new Date().toISOString(),
        siteId: normalized.site,
        policyPath: basename(policyPath),
        outcome: "allowed",
      },
      layout,
    );
    return { ok: true, site, saved: true };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export function policyFilePath(site: string, layout: StorageLayout = storageLayout()): string {
  validateSiteId(site);
  return join(layout.dirs.policies, `${site}.yaml`);
}

function validateSiteId(site: string): void {
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(site) || site.includes("..")) {
    throw new Error("Policy site must be a safe site id");
  }
}

async function readPolicySummary(path: string): Promise<PolicySummary> {
  const policy = await loadPolicy(path);
  return {
    site: policy.site,
    version: policy.version,
    canonicalOrigin: policy.canonicalOrigin,
    path: basename(path),
    updatedAt: policy.updatedAt,
  };
}

async function runEditor(editor: string, path: string): Promise<void> {
  const [command, ...args] = splitCommand(editor);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, path], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Editor exited with ${signal ?? code}`));
    });
  });
}

function splitCommand(command: string): string[] {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^["']|["']$/g, ""));
  if (!parts || parts.length === 0) {
    throw new Error("Editor command must be non-empty");
  }
  return parts;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
