import type { BlockedDecision } from "./policy.js";

export type BrokerAction =
  | "navigate"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "readText"
  | "snapshot"
  | "getTitle"
  | "getUrl"
  | "wait"
  | "scroll"
  | "screenshotSelector"
  | "screenshotFullPage"
  | "submitForm"
  | "download"
  | "upload"
  | "close";

export type BrokerRequestTarget =
  | { kind: "url"; url: string }
  | { kind: "selector"; selector: string }
  | { kind: "ref"; ref: string }
  | { kind: "key"; key: string }
  | { kind: "none" };

export interface BrokerRequest {
  requestId: string;
  siteId: string;
  sessionId?: string;
  action: BrokerAction;
  target: BrokerRequestTarget;
  value?: string;
  createdAt: string;
}

export interface BrokerAllowedResponse {
  ok: true;
  requestId: string;
  action: BrokerAction;
  result?: BrokerResult;
}

export interface BrokerBlockedResponse extends BlockedDecision {
  requestId: string;
  action: BrokerAction;
  siteId: string;
  sessionId?: string;
}

export type BrokerResponse = BrokerAllowedResponse | BrokerBlockedResponse;

export type BrokerResult =
  | { kind: "text"; text: string }
  | { kind: "snapshot"; snapshot: unknown }
  | { kind: "title"; title: string }
  | { kind: "url"; url: string }
  | { kind: "screenshot"; mimeType: "image/png"; data: string }
  | { kind: "empty" };

export type AuditOutcome = "allowed" | "blocked";

export interface BrokerAuditEvent {
  type: "broker.request";
  timestamp: string;
  requestId: string;
  siteId: string;
  sessionId?: string;
  action: BrokerAction;
  target?: AuditTarget;
  outcome: AuditOutcome;
  policyRule?: string;
  reason?: string;
}

export type AuditTarget =
  | { kind: "url"; url: string }
  | { kind: "selector"; selector: string }
  | { kind: "ref"; ref: string }
  | { kind: "key" }
  | { kind: "none" };

export function allowedResponse(
  request: BrokerRequest,
  result: BrokerResult = { kind: "empty" },
): BrokerAllowedResponse {
  return {
    ok: true,
    requestId: request.requestId,
    action: request.action,
    result,
  };
}

export function blockedResponse(request: BrokerRequest, decision: BlockedDecision): BrokerBlockedResponse {
  return {
    ...decision,
    requestId: request.requestId,
    action: request.action,
    siteId: request.siteId,
    sessionId: request.sessionId,
  };
}

export function auditEvent(
  request: BrokerRequest,
  response: BrokerResponse,
  timestamp: string = new Date().toISOString(),
): BrokerAuditEvent {
  if (response.ok) {
    return {
      type: "broker.request",
      timestamp,
      requestId: request.requestId,
      siteId: request.siteId,
      sessionId: request.sessionId,
      action: request.action,
      target: auditTarget(request.target),
      outcome: "allowed",
    };
  }

  return {
    type: "broker.request",
    timestamp,
    requestId: request.requestId,
    siteId: request.siteId,
    sessionId: request.sessionId,
    action: request.action,
    target: auditTarget(request.target),
    outcome: "blocked",
    policyRule: response.blocked.rule,
    reason: response.blocked.reason,
  };
}

function auditTarget(target: BrokerRequestTarget): AuditTarget {
  if (target.kind === "key") {
    return { kind: "key" };
  }
  return target;
}
