import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedResponse, auditEvent, blockedResponse, type BrokerRequest } from "./broker.js";

const request: BrokerRequest = {
  requestId: "req_123",
  siteId: "github.com",
  sessionId: "sess_123",
  action: "navigate",
  target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
  createdAt: "2026-05-30T00:00:00.000Z",
};

describe("broker responses", () => {
  it("wraps a policy block with request and session context", () => {
    const response = blockedResponse(request, {
      ok: false,
      blocked: {
        rule: "origins.allow",
        reason: "URL is outside the allowed policy scope",
        url: "https://github.com/gregwym/other",
      },
    });

    assert.deepEqual(response, {
      ok: false,
      requestId: "req_123",
      action: "navigate",
      siteId: "github.com",
      sessionId: "sess_123",
      blocked: {
        rule: "origins.allow",
        reason: "URL is outside the allowed policy scope",
        url: "https://github.com/gregwym/other",
      },
    });
  });

  it("creates allowed responses with explicit result kinds", () => {
    assert.deepEqual(allowedResponse(request, { kind: "title", title: "Issues" }), {
      ok: true,
      requestId: "req_123",
      action: "navigate",
      result: { kind: "title", title: "Issues" },
    });
  });
});

describe("auditEvent", () => {
  it("records allowed requests without policy rule fields", () => {
    const event = auditEvent(request, allowedResponse(request), "2026-05-30T00:00:01.000Z");

    assert.deepEqual(event, {
      type: "broker.request",
      timestamp: "2026-05-30T00:00:01.000Z",
      requestId: "req_123",
      siteId: "github.com",
      sessionId: "sess_123",
      action: "navigate",
      target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
      outcome: "allowed",
    });
  });

  it("records blocked requests with the responsible policy rule", () => {
    const response = blockedResponse(request, {
      ok: false,
      blocked: {
        rule: "origins.allow",
        reason: "URL is outside the allowed policy scope",
        url: "https://github.com/gregwym/other",
      },
    });
    const event = auditEvent(request, response, "2026-05-30T00:00:02.000Z");

    assert.deepEqual(event, {
      type: "broker.request",
      timestamp: "2026-05-30T00:00:02.000Z",
      requestId: "req_123",
      siteId: "github.com",
      sessionId: "sess_123",
      action: "navigate",
      target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
      outcome: "blocked",
      policyRule: "origins.allow",
      reason: "URL is outside the allowed policy scope",
    });
  });

  it("omits key values from audit targets", () => {
    const keyRequest: BrokerRequest = {
      ...request,
      action: "press",
      target: { kind: "key", key: "Enter" },
    };

    assert.equal(auditEvent(keyRequest, allowedResponse(keyRequest)).target?.kind, "key");
  });
});
