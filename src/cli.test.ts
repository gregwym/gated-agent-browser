import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";

const execFileAsync = promisify(execFile);

describe("cli init", () => {
  it("does not print broker-owned directory paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-"));
    const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "init"], {
      env: {
        ...process.env,
        GATED_AGENT_BROWSER_HOME: home,
      },
    });

    const parsed = JSON.parse(stdout) as unknown;
    assert.deepEqual(parsed, {
      ok: true,
      initialized: true,
      directories: ["policies", "sessions", "approvals", "logs", "profiles"],
    });
    assert.doesNotMatch(stdout, /gated-agent-browser-cli-/);
    assert.doesNotMatch(stdout, /profiles\//);
    assert.doesNotMatch(stdout, /sessions\//);
  });
});
