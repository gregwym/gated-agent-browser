import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { storageLayout, type StorageLayout } from "./storage.js";

export type SessionStatus = "active" | "revoked" | "expired";

export interface SessionMetadata {
  version: 1;
  sessionId: string;
  siteId: string;
  profileId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface PublicSessionSummary {
  sessionId: string;
  siteId: string;
  profileId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface CreateSessionOptions {
  siteId: string;
  sessionId?: string;
  profileId?: string;
  createdAt?: string;
  expiresAt?: string;
  layout?: StorageLayout;
}

export interface RevokeSessionResult {
  ok: true;
  sessionId: string;
  siteId: string;
  revoked: true;
}

export async function createSession(options: CreateSessionOptions): Promise<PublicSessionSummary> {
  const layout = options.layout ?? storageLayout();
  const siteId = validateSafeId(options.siteId, "siteId");
  const sessionId = validateSafeId(options.sessionId ?? `sess_${randomUUID()}`, "sessionId");
  const profileId = validateSafeId(options.profileId ?? `prof_${randomUUID()}`, "profileId");
  const now = options.createdAt ?? new Date().toISOString();
  const metadata: SessionMetadata = {
    version: 1,
    sessionId,
    siteId,
    profileId,
    status: "active",
    createdAt: now,
    updatedAt: now,
    expiresAt: options.expiresAt,
  };

  await mkdir(layout.dirs.sessions, { recursive: true, mode: 0o700 });
  await mkdir(profileDirectory(profileId, layout), { recursive: true, mode: 0o700 });
  await writeSession(metadata, layout);
  return publicSessionSummary(metadata);
}

export async function loadSession(sessionId: string, layout: StorageLayout = storageLayout()): Promise<SessionMetadata> {
  validateSafeId(sessionId, "sessionId");
  return normalizeSession(JSON.parse(await readFile(sessionFilePath(sessionId, layout), "utf8")) as unknown);
}

export async function listSessions(
  options: { siteId?: string; layout?: StorageLayout } = {},
): Promise<PublicSessionSummary[]> {
  const layout = options.layout ?? storageLayout();
  const siteId = options.siteId ? validateSafeId(options.siteId, "siteId") : undefined;
  const entries = await readdir(layout.dirs.sessions, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => loadSession(basename(entry.name, ".json"), layout)),
  );

  return sessions
    .filter((session) => !siteId || session.siteId === siteId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(publicSessionSummary);
}

export async function revokeSession(
  sessionId: string,
  options: { revokedAt?: string; layout?: StorageLayout } = {},
): Promise<RevokeSessionResult> {
  const layout = options.layout ?? storageLayout();
  const session = await loadSession(sessionId, layout);
  const revokedAt = options.revokedAt ?? new Date().toISOString();
  const next: SessionMetadata = {
    ...session,
    status: "revoked",
    updatedAt: revokedAt,
    revokedAt,
  };
  await writeSession(next, layout);
  return { ok: true, sessionId: next.sessionId, siteId: next.siteId, revoked: true };
}

export function publicSessionSummary(session: SessionMetadata): PublicSessionSummary {
  const summary: PublicSessionSummary = {
    sessionId: session.sessionId,
    siteId: session.siteId,
    profileId: session.profileId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
  if (session.expiresAt) {
    summary.expiresAt = session.expiresAt;
  }
  if (session.revokedAt) {
    summary.revokedAt = session.revokedAt;
  }
  return summary;
}

export function sessionFilePath(sessionId: string, layout: StorageLayout = storageLayout()): string {
  validateSafeId(sessionId, "sessionId");
  return join(layout.dirs.sessions, `${sessionId}.json`);
}

export function profileDirectory(profileId: string, layout: StorageLayout = storageLayout()): string {
  validateSafeId(profileId, "profileId");
  return join(layout.dirs.profiles, profileId);
}

function writeSession(session: SessionMetadata, layout: StorageLayout): Promise<void> {
  return writeFile(sessionFilePath(session.sessionId, layout), `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

function normalizeSession(value: unknown): SessionMetadata {
  if (!isRecord(value)) {
    throw new Error("Session metadata must be a JSON object");
  }
  const version = expectNumber(value.version, "version");
  if (version !== 1) {
    throw new Error("Session metadata version must be 1");
  }
  const status = expectString(value.status, "status");
  if (status !== "active" && status !== "revoked" && status !== "expired") {
    throw new Error("status must be active, revoked, or expired");
  }
  return {
    version,
    sessionId: validateSafeId(expectString(value.sessionId, "sessionId"), "sessionId"),
    siteId: validateSafeId(expectString(value.siteId, "siteId"), "siteId"),
    profileId: validateSafeId(expectString(value.profileId, "profileId"), "profileId"),
    status,
    createdAt: expectString(value.createdAt, "createdAt"),
    updatedAt: expectString(value.updatedAt, "updatedAt"),
    expiresAt: optionalString(value.expiresAt, "expiresAt"),
    revokedAt: optionalString(value.revokedAt, "revokedAt"),
  };
}

function validateSafeId(value: string, path: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) || value.includes("..")) {
    throw new Error(`${path} must be a safe id`);
  }
  return value;
}

function expectNumber(value: unknown, path: string): 1 {
  if (value !== 1) {
    throw new Error(`${path} must be 1`);
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return expectString(value, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
