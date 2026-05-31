import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PolicyBrokerExecutor } from "./broker-executor.js";
import { FixtureBrowserAdapter } from "./fixture-browser-adapter.js";
import { startFixtureServer } from "./fixture-server.js";
import { normalizePolicy, type SitePolicy } from "./policy.js";

describe("runtime URL escape fixtures", () => {
  it("blocks server redirects that leave policy scope", async () => {
    const server = await startFixtureServer();
    try {
      const response = await executor(server.origin).execute(request("navigate", server.url("/redirect/server")));
      assert.equal(response.ok, false);
      if (!response.ok) {
        assert.equal(response.blocked.rule, "origins.allow");
        assert.equal(response.blocked.url, "https://example.com/escaped");
        assert.match(response.blocked.reason, /Post-action URL/);
      }
    } finally {
      await server.close();
    }
  });

  it("blocks JavaScript redirects that leave policy scope", async () => {
    const server = await startFixtureServer();
    try {
      const response = await executor(server.origin).execute(request("navigate", server.url("/redirect/js")));
      assert.equal(response.ok, false);
      if (!response.ok) {
        assert.equal(response.blocked.rule, "origins.allow");
        assert.equal(response.blocked.url, "https://example.com/escaped");
      }
    } finally {
      await server.close();
    }
  });

  it("blocks popup URLs observed after a click", async () => {
    const server = await startFixtureServer();
    try {
      const broker = executor(server.origin);
      assert.equal((await broker.execute(request("navigate", server.url("/popup")))).ok, true);
      const response = await broker.execute({
        requestId: "req_click",
        siteId: "fixture.local",
        action: "click",
        target: { kind: "selector", selector: "#popup" },
        createdAt: "2026-05-31T00:00:00.000Z",
      });
      assert.equal(response.ok, false);
      if (!response.ok) {
        assert.equal(response.blocked.rule, "origins.allow");
        assert.match(response.blocked.reason, /popup URL/);
      }
    } finally {
      await server.close();
    }
  });

  it("blocks iframe URLs observed on a permitted page", async () => {
    const server = await startFixtureServer();
    try {
      const response = await executor(server.origin).execute(request("navigate", server.url("/iframe")));
      assert.equal(response.ok, false);
      if (!response.ok) {
        assert.equal(response.blocked.rule, "origins.allow");
        assert.match(response.blocked.reason, /iframe URL/);
      }
    } finally {
      await server.close();
    }
  });
});

function executor(origin: string): PolicyBrokerExecutor {
  return new PolicyBrokerExecutor(policy(origin), new FixtureBrowserAdapter());
}

function policy(origin: string): SitePolicy {
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
      readText: "allow",
    },
  });
}

function request(action: "navigate", url: string) {
  return {
    requestId: `req_${action}`,
    siteId: "fixture.local",
    action,
    target: { kind: "url" as const, url },
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}
