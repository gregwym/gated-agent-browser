import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBatchInput, runBatch, type BatchExecutor } from "./batch.js";
import { allowedResponse, type BrokerRequest, type BrokerResponse } from "./broker.js";
import { startFixtureServer } from "./fixture-server.js";
import { normalizePolicy, type SitePolicy } from "./policy.js";

describe("file transfer and form defaults", () => {
  it("blocks download attempts before adapter side effects", async () => {
    const server = await startFixtureServer();
    try {
      const executor = new RecordingExecutor();
      const events: unknown[] = [];
      const result = await runBatch(
        policy(server.origin),
        normalizeBatchInput({
          siteId: "fixture.local",
          commands: [{ action: "download", target: { kind: "url", url: server.url("/download") } }],
        }),
        executor,
        { audit: async (event) => void events.push(event) },
      );

      assertBlock(result, "actions.download", "download");
      assert.equal(executor.requests.length, 0);
      assert.deepEqual(events.map((event) => (event as { outcome: string }).outcome), ["blocked"]);
    } finally {
      await server.close();
    }
  });

  it("blocks upload attempts without exposing local file values to the adapter", async () => {
    const server = await startFixtureServer();
    try {
      const executor = new RecordingExecutor();
      const result = await runBatch(
        policy(server.origin),
        normalizeBatchInput({
          siteId: "fixture.local",
          commands: [{ action: "upload", target: { kind: "selector", selector: "input[type=file]" }, value: "/tmp/secret.txt" }],
        }),
        executor,
      );

      assertBlock(result, "actions.upload", "upload");
      assert.equal(executor.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("blocks form submission attempts before adapter side effects", async () => {
    const server = await startFixtureServer();
    try {
      const executor = new RecordingExecutor();
      const result = await runBatch(
        policy(server.origin),
        normalizeBatchInput({
          siteId: "fixture.local",
          commands: [{ action: "submitForm", target: { kind: "selector", selector: "#submit-form" } }],
        }),
        executor,
      );

      assertBlock(result, "actions.submitForm", "submitForm");
      assert.equal(executor.requests.length, 0);
    } finally {
      await server.close();
    }
  });
});

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
      download: "deny",
      upload: "deny",
      submitForm: "requireExplicitAllow",
    },
  });
}

function assertBlock(result: Awaited<ReturnType<typeof runBatch>>, rule: string, action: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.blocked.rule, rule);
    assert.equal(result.blocked.action, action);
  }
}

class RecordingExecutor implements BatchExecutor {
  readonly requests: BrokerRequest[] = [];

  async execute(request: BrokerRequest): Promise<BrokerResponse> {
    this.requests.push(request);
    return allowedResponse(request);
  }
}
