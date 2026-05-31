import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setup } from "./setup.js";

describe("setup", () => {
  it("initializes storage and reports lightweight prerequisites without paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-setup-"));
    const previous = process.env.GATED_AGENT_BROWSER_HOME;
    process.env.GATED_AGENT_BROWSER_HOME = home;
    try {
      const result = await setup();
      assert.equal(result.ok, true);
      assert.equal(result.initialized, true);
      assert.equal(result.prerequisites.agentBrowserDependency.configured, true);
      assert.equal(result.prerequisites.agentBrowserDependency.expectedVersion, "0.27.0");
      assert.equal(result.prerequisites.browserRuntimeInstall.checked, false);
      assert.doesNotMatch(JSON.stringify(result), /gated-agent-browser-setup-|profiles\//);
    } finally {
      if (previous === undefined) {
        delete process.env.GATED_AGENT_BROWSER_HOME;
      } else {
        process.env.GATED_AGENT_BROWSER_HOME = previous;
      }
    }
  });
});
