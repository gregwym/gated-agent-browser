import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBatchInput, runBatch, type BatchExecutor } from "./batch.js";
import { PolicyBrokerExecutor } from "./broker-executor.js";
import { allowedResponse, type BrokerRequest, type BrokerResponse } from "./broker.js";
import { FixtureBrowserAdapter } from "./fixture-browser-adapter.js";
import { startFixtureServer } from "./fixture-server.js";
import { normalizePolicy, type SitePolicy } from "./policy.js";

describe("selector enforcement fixtures", () => {
  it("blocks destructive selectors before click reaches the adapter", async () => {
    const server = await startFixtureServer();
    try {
      const adapter = new FixtureBrowserAdapter();
      const broker = new PolicyBrokerExecutor(policy(server.origin, { screenshotSelector: "allow" }), adapter);
      assert.equal((await broker.execute(request("navigate", { kind: "url", url: server.url("/destructive") }))).ok, true);

      const response = await broker.execute(
        request("click", { kind: "selector", selector: 'button[data-testid="delete-repo"]' }),
      );

      assert.equal(response.ok, false);
      if (!response.ok) {
        assert.equal(response.blocked.rule, "destructiveSelectors");
      }
    } finally {
      await server.close();
    }
  });

  it("allows selector screenshots only when policy grants them", async () => {
    const server = await startFixtureServer();
    try {
      const allowedBroker = new PolicyBrokerExecutor(policy(server.origin, { screenshotSelector: "allow" }), new FixtureBrowserAdapter());
      assert.equal((await allowedBroker.execute(request("navigate", { kind: "url", url: server.url("/allowed") }))).ok, true);
      const allowed = await allowedBroker.execute(request("screenshotSelector", { kind: "selector", selector: "main" }));
      assert.equal(allowed.ok, true);

      const deniedExecutor = new RecordingExecutor();
      const denied = await runBatch(
        policy(server.origin, { screenshotSelector: "requireExplicitAllow" }),
        normalizeBatchInput({
          siteId: "fixture.local",
          commands: [{ action: "screenshotSelector", target: { kind: "selector", selector: "main" } }],
        }),
        deniedExecutor,
      );
      assert.equal(denied.ok, false);
      assert.equal(deniedExecutor.requests.length, 0);
      if (!denied.ok) {
        assert.equal(denied.blocked.rule, "actions.screenshotSelector");
      }
    } finally {
      await server.close();
    }
  });

  it("blocks sensitive selector screenshots even when screenshot action is granted", async () => {
    const server = await startFixtureServer();
    try {
      const broker = new PolicyBrokerExecutor(policy(server.origin, { screenshotSelector: "allow" }), new FixtureBrowserAdapter());
      const response = await broker.execute(request("screenshotSelector", { kind: "selector", selector: "#token" }));
      assert.equal(response.ok, false);
      if (!response.ok) {
        assert.equal(response.blocked.rule, "sensitiveSelectors");
      }
    } finally {
      await server.close();
    }
  });

  it("keeps full-page screenshots denied by default", async () => {
    const server = await startFixtureServer();
    try {
      const executor = new RecordingExecutor();
      const result = await runBatch(
        policy(server.origin, { screenshotSelector: "allow" }),
        normalizeBatchInput({
          siteId: "fixture.local",
          commands: [{ action: "screenshotFullPage", target: { kind: "none" } }],
        }),
        executor,
      );
      assert.equal(result.ok, false);
      assert.equal(executor.requests.length, 0);
      if (!result.ok) {
        assert.equal(result.blocked.rule, "actions.screenshotFullPage");
      }
    } finally {
      await server.close();
    }
  });
});

function policy(origin: string, actions: { screenshotSelector: "allow" | "requireExplicitAllow" }): SitePolicy {
  return normalizePolicy({
    version: 1,
    site: "fixture.local",
    canonicalOrigin: origin,
    origins: {
      allow: [`${origin}/**`],
    },
    actions: {
      navigate: "allow",
      click: "allow",
      screenshotSelector: actions.screenshotSelector,
      screenshotFullPage: "deny",
    },
    sensitiveSelectors: ["#token"],
    destructiveSelectors: ['[data-testid*="delete" i]', 'button:has-text("Delete")'],
  });
}

function request(action: BrokerRequest["action"], target: BrokerRequest["target"]): BrokerRequest {
  return {
    requestId: `req_${action}`,
    siteId: "fixture.local",
    action,
    target,
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}

class RecordingExecutor implements BatchExecutor {
  readonly requests: BrokerRequest[] = [];

  async execute(request: BrokerRequest): Promise<BrokerResponse> {
    this.requests.push(request);
    return allowedResponse(request);
  }
}
