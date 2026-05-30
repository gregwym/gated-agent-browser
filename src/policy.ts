import { readFile } from "node:fs/promises";
import { Minimatch } from "minimatch";
import YAML from "yaml";

export type PolicyDecision = "allow" | "deny" | "requireExplicitAllow";

export interface SitePolicy {
  version: number;
  site: string;
  canonicalOrigin: string;
  origins: {
    allow: string[];
    auth?: string[];
    deny?: string[];
  };
  actions: Record<string, PolicyDecision>;
  sensitiveSelectors?: string[];
  destructiveSelectors?: string[];
  ttl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BlockedDecision {
  ok: false;
  blocked: {
    rule: string;
    reason: string;
    url?: string;
    action?: string;
  };
}

export interface AllowedDecision {
  ok: true;
}

export type Decision = AllowedDecision | BlockedDecision;

export async function loadPolicy(path: string): Promise<SitePolicy> {
  const raw = await readFile(path, "utf8");
  const parsed = YAML.parse(raw) as unknown;
  return normalizePolicy(parsed);
}

export function normalizePolicy(value: unknown): SitePolicy {
  if (!isRecord(value)) {
    throw new Error("Policy must be a YAML object");
  }

  const version = expectNumber(value.version, "version");
  const site = expectString(value.site, "site");
  const canonicalOrigin = expectString(value.canonicalOrigin, "canonicalOrigin");
  const originsValue = expectRecord(value.origins, "origins");
  const actionsValue = expectRecord(value.actions, "actions");

  return {
    version,
    site,
    canonicalOrigin,
    origins: {
      allow: expectStringArray(originsValue.allow, "origins.allow"),
      auth: optionalStringArray(originsValue.auth, "origins.auth"),
      deny: optionalStringArray(originsValue.deny, "origins.deny"),
    },
    actions: normalizeActions(actionsValue),
    sensitiveSelectors: optionalStringArray(value.sensitiveSelectors, "sensitiveSelectors"),
    destructiveSelectors: optionalStringArray(value.destructiveSelectors, "destructiveSelectors"),
    ttl: optionalString(value.ttl, "ttl"),
    createdAt: optionalString(value.createdAt, "createdAt"),
    updatedAt: optionalString(value.updatedAt, "updatedAt"),
  };
}

export function decideAction(policy: SitePolicy, action: string): Decision {
  const decision = policy.actions[action] ?? "deny";
  if (decision === "allow") {
    return { ok: true };
  }

  return {
    ok: false,
    blocked: {
      rule: `actions.${action}`,
      reason:
        decision === "requireExplicitAllow"
          ? "Action requires an explicit policy grant"
          : "Action is denied by policy",
      action,
    },
  };
}

export function decideUrl(policy: SitePolicy, url: string, options: { allowAuth?: boolean } = {}): Decision {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return {
      ok: false,
      blocked: {
        rule: "url.parse",
        reason: "URL must be an absolute http or https URL",
        url,
      },
    };
  }

  const normalizedUrl = parsed.toString();
  if (matchesAny(normalizedUrl, policy.origins.deny ?? [])) {
    return {
      ok: false,
      blocked: {
        rule: "origins.deny",
        reason: "URL matches a denied policy pattern",
        url: normalizedUrl,
      },
    };
  }

  if (matchesAny(normalizedUrl, policy.origins.allow)) {
    return { ok: true };
  }

  if (options.allowAuth && matchesAny(normalizedUrl, policy.origins.auth ?? [])) {
    return { ok: true };
  }

  return {
    ok: false,
    blocked: {
      rule: "origins.allow",
      reason: "URL is outside the allowed policy scope",
      url: normalizedUrl,
    },
  };
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function matchesAny(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const matcher = new Minimatch(pattern, { nocase: true, nonegate: true });
    return matcher.match(url);
  });
}

function normalizeActions(value: Record<string, unknown>): Record<string, PolicyDecision> {
  const out: Record<string, PolicyDecision> = {};
  for (const [key, decision] of Object.entries(value)) {
    if (decision !== "allow" && decision !== "deny" && decision !== "requireExplicitAllow") {
      throw new Error(`actions.${key} must be allow, deny, or requireExplicitAllow`);
    }
    out[key] = decision;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
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

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer`);
  }
  return value;
}

function expectStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${path} must be an array of non-empty strings`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return expectStringArray(value, path);
}
