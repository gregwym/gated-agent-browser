import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrokerAuditEvent } from "./broker.js";
import { storageLayout, type StorageLayout } from "./storage.js";

export type AuditEvent =
  | BrokerAuditEvent
  | {
      type: "login.start" | "login.complete";
      timestamp: string;
      siteId: string;
      sessionId?: string;
      url: string;
      resetSiteDataRequested: boolean;
      outcome: "started" | "completed";
    }
  | {
      type: "policy.created" | "policy.updated" | "policy.revoked";
      timestamp: string;
      siteId: string;
      policyPath?: string;
      outcome: "allowed";
    }
  | {
      type: "session.revoked";
      timestamp: string;
      siteId: string;
      sessionId: string;
      outcome: "allowed";
    };

export async function appendAuditEvent(
  event: AuditEvent,
  layout: StorageLayout = storageLayout(),
): Promise<void> {
  assertSafeAuditEvent(event);
  await mkdir(layout.dirs.logs, { recursive: true, mode: 0o700 });
  await writeFile(auditLogPath(layout), `${JSON.stringify(event)}\n`, { flag: "a", mode: 0o600 });
}

export async function readAuditEvents(layout: StorageLayout = storageLayout()): Promise<AuditEvent[]> {
  const raw = await readFile(auditLogPath(layout), "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEvent);
}

export function auditLogPath(layout: StorageLayout = storageLayout()): string {
  return join(layout.dirs.logs, "audit.jsonl");
}

function assertSafeAuditEvent(event: AuditEvent): void {
  const raw = JSON.stringify(event);
  if (/"(?:profilePath|profileDirectory|cookies|storage|cdpUrl|har|clipboard)"\s*:/.test(raw)) {
    throw new Error("Audit event contains a sensitive browser field");
  }
  if (/\/profiles\/|\\profiles\\/.test(raw)) {
    throw new Error("Audit event contains a profile path");
  }
}
