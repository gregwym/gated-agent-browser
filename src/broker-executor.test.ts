import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeBrowserAdapter } from "./browser-adapter.js";
import { PolicyBrokerExecutor } from "./broker-executor.js";
import type { BrokerRequest } from "./broker.js";
import { normalizePolicy, type SitePolicy } from "./policy.js";

const policy: SitePolicy = normalizePolicy({
  version: 1,
  site: "github.com",
  canonicalOrigin: "https://github.com",
  origins: {
    allow: ["https://github.com/gregwym/gated-agent-browser/**"],
  },
  actions: {
    navigate: "allow",
    readText: "allow",
    fill: "requireExplicitAllow",
  },
});

describe("PolicyBrokerExecutor with FakeBrowserAdapter", () => {
  it("allows navigation inside policy scope without network or browser binaries", async () => {
    const adapter = new FakeBrowserAdapter();
    const executor = new PolicyBrokerExecutor(policy, adapter);
    const response = await executor.execute(
      request("navigate", { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" }),
    );

    assert.deepEqual(response, {
      ok: true,
      requestId: "req_1",
      action: "navigate",
      result: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
    });
    assert.equal(adapter.requests.length, 1);
  });

  it("blocks navigation outside policy before calling the adapter", async () => {
    const adapter = new FakeBrowserAdapter();
    const executor = new PolicyBrokerExecutor(policy, adapter);
    const response = await executor.execute(request("navigate", { kind: "url", url: "https://github.com/gregwym/other" }));

    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.blocked.rule, "origins.allow");
      assert.equal(response.siteId, "github.com");
    }
    assert.equal(adapter.requests.length, 0);
  });

  it("blocks post-action URLs that leave policy scope", async () => {
    const adapter = new FakeBrowserAdapter({
      redirects: {
        "https://github.com/gregwym/gated-agent-browser/issues": "https://example.com/phish",
      },
    });
    const executor = new PolicyBrokerExecutor(policy, adapter);
    const response = await executor.execute(
      request("navigate", { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" }),
    );

    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.blocked.rule, "origins.allow");
      assert.equal(response.blocked.url, "https://example.com/phish");
      assert.match(response.blocked.reason, /Post-action URL/);
    }
    assert.equal(adapter.requests.length, 1);
  });

  it("blocks denied actions before calling the adapter", async () => {
    const adapter = new FakeBrowserAdapter();
    const executor = new PolicyBrokerExecutor(policy, adapter);
    const response = await executor.execute(request("fill", { kind: "selector", selector: "input" }, "secret-ish"));

    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.blocked.rule, "actions.fill");
    }
    assert.equal(adapter.requests.length, 0);
  });
});

function request(action: BrokerRequest["action"], target: BrokerRequest["target"], value?: string): BrokerRequest {
  return {
    requestId: "req_1",
    siteId: "github.com",
    sessionId: "sess_1",
    action,
    target,
    value,
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}
