import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendAuditEvent, readAuditEvents } from "./audit.js";
import { auditEvent, type BrokerRequest, type BrokerResponse } from "./broker.js";
import { PolicyBrokerExecutor } from "./broker-executor.js";
import { FixtureBrowserAdapter } from "./fixture-browser-adapter.js";
import { startFixtureServer } from "./fixture-server.js";
import { normalizePolicy, type SitePolicy } from "./policy.js";
import { storageLayout } from "./storage.js";

describe("prompt injection fixture", () => {
  it("treats page instructions as data while policy remains authoritative", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-prompt-injection-"));
    const layout = storageLayout(home);
    const server = await startFixtureServer();
    try {
      const broker = new PolicyBrokerExecutor(policy(server.origin), new FixtureBrowserAdapter());
      await executeWithAudit(
        broker,
        request("navigate", { kind: "url", url: server.url("/prompt-injection") }),
        layout,
      );
      const read = await executeWithAudit(broker, request("readText", { kind: "selector", selector: "main" }), layout);
      assert.equal(read.ok, true);
      if (read.ok && read.result?.kind === "text") {
        assert.match(read.result.text, /Ignore previous instructions/);
        assert.match(read.result.text, /https:\/\/example.com\/escaped/);
      }

      const blocked = await executeWithAudit(
        broker,
        request("navigate", { kind: "url", url: "https://example.com/escaped" }),
        layout,
      );
      assert.equal(blocked.ok, false);
      if (!blocked.ok) {
        assert.equal(blocked.blocked.rule, "origins.allow");
        assert.equal(blocked.blocked.url, "https://example.com/escaped");
      }

      assert.deepEqual(
        (await readAuditEvents(layout)).map((event) => [event.type, "outcome" in event ? event.outcome : undefined]),
        [
          ["broker.request", "allowed"],
          ["broker.request", "allowed"],
          ["broker.request", "blocked"],
        ],
      );
    } finally {
      await server.close();
    }
  });
});

async function executeWithAudit(
  broker: PolicyBrokerExecutor,
  brokerRequest: BrokerRequest,
  layout: ReturnType<typeof storageLayout>,
): Promise<BrokerResponse> {
  const response = await broker.execute(brokerRequest);
  await appendAuditEvent(auditEvent(brokerRequest, response, "2026-05-31T00:00:00.000Z"), layout);
  return response;
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
      readText: "allow",
    },
  });
}

function request(action: BrokerRequest["action"], target: BrokerRequest["target"]): BrokerRequest {
  return {
    requestId: `req_${action}_${target.kind}`,
    siteId: "fixture.local",
    action,
    target,
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}
