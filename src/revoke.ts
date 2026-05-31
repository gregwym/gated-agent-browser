import { appendAuditEvent } from "./audit.js";
import { archivePolicy } from "./policy-store.js";
import { listSessions, revokeSession } from "./session-store.js";
import { initializeStorage, storageLayout, type StorageLayout } from "./storage.js";

export interface RevokeSiteResult {
  ok: true;
  site: string;
  revokedSessions: string[];
  policyArchived: boolean;
}

export interface RevokeSiteOptions {
  layout?: StorageLayout;
  now?: () => string;
}

export async function revokeSite(site: string, options: RevokeSiteOptions = {}): Promise<RevokeSiteResult> {
  const layout = options.layout ?? storageLayout();
  const revokedAt = (options.now ?? (() => new Date().toISOString()))();
  await initializeStorage(layout.home);

  const sessions = await listSessions({ siteId: site, layout });
  const activeSessions = sessions.filter((session) => session.status === "active");
  const revokedSessions: string[] = [];
  for (const session of activeSessions) {
    const result = await revokeSession(session.sessionId, { revokedAt, layout });
    revokedSessions.push(result.sessionId);
    await appendAuditEvent(
      {
        type: "session.revoked",
        timestamp: revokedAt,
        siteId: result.siteId,
        sessionId: result.sessionId,
        outcome: "allowed",
      },
      layout,
    );
  }

  const policy = await archivePolicy(site, { archivedAt: revokedAt, layout });
  if (policy.archived) {
    await appendAuditEvent(
      {
        type: "policy.revoked",
        timestamp: revokedAt,
        siteId: site,
        outcome: "allowed",
      },
      layout,
    );
  }
  return {
    ok: true,
    site,
    revokedSessions,
    policyArchived: policy.archived,
  };
}
