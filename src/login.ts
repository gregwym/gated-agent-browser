import { appendAuditEvent } from "./audit.js";
import { createSession, loadSession, profileDirectory, type PublicSessionSummary } from "./session-store.js";
import { savePolicy } from "./policy-store.js";
import { initializeStorage, storageLayout, type StorageLayout } from "./storage.js";
import type { SitePolicy } from "./policy.js";

export interface LoginResult {
  ok: true;
  siteId: string;
  canonicalOrigin: string;
  session: PublicSessionSummary;
  policy: {
    site: string;
    saved: true;
    path: string;
  };
  resetSiteDataRequested: true;
}

export interface LoginOptions {
  layout?: StorageLayout;
  now?: () => string;
  adapter?: LoginAdapter;
}

export interface LoginAdapter {
  start(options: LoginAdapterStartOptions): Promise<LoginAdapterResult>;
}

export interface LoginAdapterStartOptions {
  initialUrl: string;
  canonicalOrigin: string;
  profilePath: string;
  resetSiteData: true;
}

export interface LoginAdapterResult {
  finalUrl: string;
}

export class NoopLoginAdapter implements LoginAdapter {
  async start(options: LoginAdapterStartOptions): Promise<LoginAdapterResult> {
    return { finalUrl: options.initialUrl };
  }
}

export async function startLogin(url: string, options: LoginOptions = {}): Promise<LoginResult> {
  const layout = options.layout ?? storageLayout();
  const now = options.now ?? (() => new Date().toISOString());
  const adapter = options.adapter ?? new NoopLoginAdapter();
  const boundary = siteBoundaryFromUrl(url);
  const timestamp = now();
  await initializeStorage(layout.home);
  await appendAuditEvent(
    {
      type: "login.start",
      timestamp,
      siteId: boundary.siteId,
      url: boundary.initialUrl,
      resetSiteDataRequested: true,
      outcome: "started",
    },
    layout,
  );

  const session = await createSession({
    siteId: boundary.siteId,
    createdAt: timestamp,
    login: {
      initialUrl: boundary.initialUrl,
      resetSiteDataRequested: true,
    },
    layout,
  });
  const storedSession = await loadSession(session.sessionId, layout);
  await adapter.start({
    initialUrl: boundary.initialUrl,
    canonicalOrigin: boundary.canonicalOrigin,
    profilePath: profileDirectory(storedSession.profileId, layout),
    resetSiteData: true,
  });
  const policy = await savePolicy(defaultPolicyDraft(boundary, timestamp), { layout });
  await appendAuditEvent(
    {
      type: "policy.created",
      timestamp,
      siteId: boundary.siteId,
      policyPath: policy.path,
      outcome: "allowed",
    },
    layout,
  );
  await appendAuditEvent(
    {
      type: "login.complete",
      timestamp,
      siteId: boundary.siteId,
      sessionId: session.sessionId,
      url: boundary.initialUrl,
      resetSiteDataRequested: true,
      outcome: "completed",
    },
    layout,
  );

  return {
    ok: true,
    siteId: boundary.siteId,
    canonicalOrigin: boundary.canonicalOrigin,
    session,
    policy: {
      site: policy.site,
      saved: true,
      path: policy.path,
    },
    resetSiteDataRequested: true,
  };
}

export function siteBoundaryFromUrl(url: string): { siteId: string; canonicalOrigin: string; initialUrl: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("login URL must be an absolute http or https URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("login URL must be an absolute http or https URL");
  }
  parsed.hash = "";
  const hostname = parsed.hostname.toLowerCase();
  return {
    siteId: hostname,
    canonicalOrigin: `${parsed.protocol}//${parsed.host}`,
    initialUrl: parsed.toString(),
  };
}

function defaultPolicyDraft(
  boundary: { siteId: string; canonicalOrigin: string },
  timestamp: string,
): SitePolicy {
  return {
    version: 1,
    site: boundary.siteId,
    canonicalOrigin: boundary.canonicalOrigin,
    origins: {
      allow: [`${boundary.canonicalOrigin}/**`],
      auth: [],
      deny: [],
    },
    actions: {
      navigate: "allow",
      click: "allow",
      fill: "requireExplicitAllow",
      type: "requireExplicitAllow",
      press: "allow",
      readText: "allow",
      snapshot: "allow",
      getTitle: "allow",
      getUrl: "allow",
      wait: "allow",
      scroll: "allow",
      screenshotSelector: "requireExplicitAllow",
      screenshotFullPage: "deny",
      submitForm: "requireExplicitAllow",
      download: "deny",
      upload: "deny",
      evaluateScript: "deny",
      cookies: "deny",
      storage: "deny",
    },
    sensitiveSelectors: [],
    destructiveSelectors: ['[data-testid*="delete" i]', 'button:has-text("Delete")'],
    ttl: "7d",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
