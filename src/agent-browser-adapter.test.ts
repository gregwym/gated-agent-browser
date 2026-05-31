import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentBrowserAdapter, AGENT_BROWSER_VERSION, agentBrowserArgs, type SubprocessRunner } from "./agent-browser-adapter.js";
import { PolicyBrokerExecutor } from "./broker-executor.js";
import type { BrokerRequest } from "./broker.js";
import { normalizePolicy } from "./policy.js";

describe("agentBrowserArgs", () => {
  it("pins the documented agent-browser package version", () => {
    assert.equal(AGENT_BROWSER_VERSION, "0.27.0");
  });

  it("maps broker requests to the narrow agent-browser command surface", () => {
    assert.deepEqual(
      agentBrowserArgs(request("navigate", { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" }), {
        sessionName: "sess_1",
      }),
      [
        "--json",
        "--max-output",
        "20000",
        "--session",
        "sess_1",
        "open",
        "https://github.com/gregwym/gated-agent-browser/issues",
      ],
    );
    assert.deepEqual(agentBrowserArgs(request("readText", { kind: "selector", selector: "main" })), [
      "--json",
      "--max-output",
      "20000",
      "get",
      "text",
      "main",
    ]);
    assert.deepEqual(agentBrowserArgs(request("fill", { kind: "ref", ref: "@e1" }, "hello")), [
      "--json",
      "--max-output",
      "20000",
      "fill",
      "@e1",
      "hello",
    ]);
  });
});

describe("AgentBrowserAdapter", () => {
  it("runs agent-browser through an injectable subprocess runner", async () => {
    const runner = new RecordingRunner({ exitCode: 0, stdout: "Issue text", stderr: "" });
    const adapter = new AgentBrowserAdapter({ binary: "agent-browser", runner, sessionName: "sess_1" });
    const result = await adapter.perform(request("readText", { kind: "selector", selector: "main" }));

    assert.deepEqual(result, { result: { kind: "text", text: "Issue text" } });
    assert.equal(runner.calls[0]?.command, "agent-browser");
    assert.deepEqual(runner.calls[0]?.args, ["--json", "--max-output", "20000", "--session", "sess_1", "get", "text", "main"]);
  });

  it("maps adapter failures to structured broker blocks without leaking profile paths", async () => {
    const secretProfile = "/tmp/gated-agent-browser/profiles/github.com";
    const runner = new RecordingRunner({ exitCode: 1, stdout: "", stderr: `failed at ${secretProfile}` });
    const adapter = new AgentBrowserAdapter({ runner, profilePath: secretProfile });
    const executor = new PolicyBrokerExecutor(
      normalizePolicy({
        version: 1,
        site: "github.com",
        canonicalOrigin: "https://github.com",
        origins: { allow: ["https://github.com/gregwym/gated-agent-browser/**"] },
        actions: { navigate: "allow" },
      }),
      adapter,
    );

    const response = await executor.execute(
      request("navigate", { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" }),
    );

    assert.equal(response.ok, false);
    const serialized = JSON.stringify(response);
    assert.match(serialized, /adapter\.browser/);
    assert.doesNotMatch(serialized, /profiles\/github\.com/);
    assert.equal(runner.calls.length, 1);
  });
});

class RecordingRunner implements SubprocessRunner {
  readonly calls: { command: string; args: string[] }[] = [];

  constructor(private readonly result: { exitCode: number; stdout: string; stderr: string }) {}

  async run(command: string, args: string[]) {
    this.calls.push({ command, args });
    return this.result;
  }
}

function request(action: BrokerRequest["action"], target: BrokerRequest["target"], value?: string): BrokerRequest {
  return {
    requestId: "req_1",
    siteId: "github.com",
    sessionId: "sess_from_request",
    action,
    target,
    value,
    createdAt: "2026-05-31T00:00:00.000Z",
  };
}
