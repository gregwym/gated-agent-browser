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

describe("cli browse batch", () => {
  it("returns a structured block and exit code 2 for denied batches", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-batch-"));
    const policyPath = join(home, "policy.yaml");
    const batchPath = join(home, "batch.json");
    await writeFile(
      policyPath,
      `version: 1
site: github.com
canonicalOrigin: https://github.com
origins:
  allow:
    - https://github.com/gregwym/gated-agent-browser/**
actions:
  navigate: allow
  fill: requireExplicitAllow
`,
    );
    await writeFile(
      batchPath,
      JSON.stringify({
        siteId: "github.com",
        commands: [
          {
            action: "navigate",
            target: { kind: "url", url: "https://github.com/gregwym/gated-agent-browser/issues" },
          },
          { action: "fill", target: { kind: "selector", selector: "input[name=q]" }, value: "text" },
        ],
      }),
    );

    await assert.rejects(
      async () => execFileAsync(process.execPath, ["dist/cli.js", "browse", "batch", "--policy", policyPath, "--json", batchPath]),
      (error: unknown) => {
        assert.equal((error as { code?: number }).code, 2);
        const stdout = (error as { stdout?: string }).stdout ?? "";
        const parsed = JSON.parse(stdout) as { blocked: { rule: string; commandIndex: number } };
        assert.equal(parsed.blocked.rule, "actions.fill");
        assert.equal(parsed.blocked.commandIndex, 1);
        return true;
      },
    );
  });
});
