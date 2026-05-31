import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBatchInput, runBatch, type BatchExecutor } from "./batch.js";
import { allowedResponse, type BrokerRequest, type BrokerResponse } from "./broker.js";
import { normalizePolicy, type SitePolicy } from "./policy.js";

const policy: SitePolicy = normalizePolicy({
  version: 1,
  site: "github.com",
  canonicalOrigin: "https://github.com",
  origins: {
    allow: ["https://github.com/gregwym/gated-agent-browser/**"],
    deny: ["https://github.com/gregwym/gated-agent-browser/settings/delete/**"],
  },
  actions: {
    navigate: "allow",
    click: "allow",
    readText: "allow",
    fill: "requireExplicitAllow",
    storage: "deny",
  },
});

describe("normalizeBatchInput", () => {
  it("defines the batch JSON command format", () => {
    assert.deepEqual(
      normalizeBatchInput({
        siteId: "github.com",
        sessionId: "sess_123",
        commands: [
          {
            action: "navigate",
            target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
          },
          { action: "click", target: { kind: "selector", selector: "a[href$='pulls']" } },
        ],
      }),
      {
        siteId: "github.com",
        sessionId: "sess_123",
        commands: [
          {
            action: "navigate",
            target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
            value: undefined,
          },
          {
            action: "click",
            target: { kind: "selector", selector: "a[href$='pulls']" },
            value: undefined,
          },
        ],
      },
    );
  });

  it("rejects unsupported actions while parsing", () => {
    assert.throws(
      () =>
        normalizeBatchInput({
          siteId: "github.com",
          commands: [{ action: "cookies" }],
        }),
      /supported broker action/,
    );
  });
});

describe("runBatch", () => {
  it("executes all commands after every action and URL validates", async () => {
    const executor = new RecordingExecutor();
    const events: unknown[] = [];
    const result = await runBatch(
      policy,
      normalizeBatchInput({
        siteId: "github.com",
        commands: [
          {
            action: "navigate",
            target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
          },
          { action: "readText", target: { kind: "selector", selector: "main" } },
        ],
      }),
      executor,
      { now: () => "2026-05-31T00:00:00.000Z", audit: async (event) => void events.push(event) },
    );

    assert.equal(result.ok, true);
    assert.equal(executor.requests.length, 2);
    assert.deepEqual(executor.requests.map((request) => request.requestId), ["batch_1", "batch_2"]);
    assert.deepEqual(
      events.map((event) => (event as { outcome: string }).outcome),
      ["allowed", "allowed"],
    );
  });

  it("rejects the whole batch before execution when an action is denied", async () => {
    const executor = new RecordingExecutor();
    const events: unknown[] = [];
    const result = await runBatch(
      policy,
      normalizeBatchInput({
        siteId: "github.com",
        commands: [
          {
            action: "navigate",
            target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
          },
          { action: "fill", target: { kind: "selector", selector: "input[name=q]" }, value: "secret-ish" },
        ],
      }),
      executor,
      { audit: async (event) => void events.push(event) },
    );

    assert.deepEqual(result, {
      ok: false,
      blocked: {
        rule: "actions.fill",
        reason: "Action requires an explicit policy grant",
        commandIndex: 1,
        requestId: "batch_2",
        action: "fill",
        url: undefined,
      },
    });
    assert.equal(executor.requests.length, 0);
    assert.deepEqual(events.map((event) => (event as { outcome: string }).outcome), ["blocked"]);
  });

  it("rejects the whole batch before execution when a target URL is outside policy", async () => {
    const executor = new RecordingExecutor();
    const result = await runBatch(
      policy,
      normalizeBatchInput({
        siteId: "github.com",
        commands: [
          {
            action: "navigate",
            target: { kind: "url", url: "https://github.com/gregwym/other" },
          },
          { action: "readText", target: { kind: "selector", selector: "main" } },
        ],
      }),
      executor,
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.blocked.rule, "origins.allow");
      assert.equal(result.blocked.commandIndex, 0);
      assert.equal(result.blocked.action, "navigate");
    }
    assert.equal(executor.requests.length, 0);
  });
});

class RecordingExecutor implements BatchExecutor {
  readonly requests: BrokerRequest[] = [];

  async execute(request: BrokerRequest): Promise<BrokerResponse> {
    this.requests.push(request);
    return allowedResponse(request);
  }
}
