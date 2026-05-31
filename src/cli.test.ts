import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

describe("cli policy", () => {
  it("lists and shows policies from GATED_AGENT_BROWSER_HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-policy-"));
    await mkdir(join(home, "policies"), { recursive: true });
    await writeFile(
      join(home, "policies", "github.com.yaml"),
      `version: 1
site: github.com
canonicalOrigin: https://github.com
origins:
  allow:
    - https://github.com/gregwym/gated-agent-browser/**
actions:
  navigate: allow
`,
    );

    const env = { ...process.env, GATED_AGENT_BROWSER_HOME: home };
    const list = await execFileAsync(process.execPath, ["dist/cli.js", "policy", "list"], { env });
    assert.deepEqual(JSON.parse(list.stdout), [
      {
        site: "github.com",
        version: 1,
        canonicalOrigin: "https://github.com",
        path: "github.com.yaml",
      },
    ]);

    const show = await execFileAsync(process.execPath, ["dist/cli.js", "policy", "show", "github.com"], { env });
    assert.equal(JSON.parse(show.stdout).site, "github.com");
  });
});
