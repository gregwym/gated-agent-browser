import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
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

describe("cli setup", () => {
  it("sets up storage and reports prerequisites without broker-owned paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-setup-"));
    const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "setup"], {
      env: {
        ...process.env,
        GATED_AGENT_BROWSER_HOME: home,
      },
    });

    const parsed = JSON.parse(stdout) as {
      ok: true;
      prerequisites: { agentBrowserDependency: { configured: boolean; expectedVersion: string } };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.prerequisites.agentBrowserDependency.configured, true);
    assert.equal(parsed.prerequisites.agentBrowserDependency.expectedVersion, "0.27.0");
    assert.doesNotMatch(stdout, /gated-agent-browser-cli-setup-|profiles\//);
  });
});

describe("cli teardown", () => {
  it("prints a non-destructive plan by default", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-teardown-"));
    await mkdir(join(home, "sessions"), { recursive: true });
    await writeFile(join(home, "sessions", "sess_test.json"), "{}\n");

    const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "teardown", "--sessions"], {
      env: {
        ...process.env,
        GATED_AGENT_BROWSER_HOME: home,
      },
    });

    const parsed = JSON.parse(stdout) as {
      ok: true;
      dryRun: boolean;
      selected: string[];
      categories: { sessions: { selected: boolean; removed: boolean; count: number } };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dryRun, true);
    assert.deepEqual(parsed.selected, ["sessions"]);
    assert.deepEqual(parsed.categories.sessions, { selected: true, removed: false, count: 1 });
    assert.deepEqual(await readdir(join(home, "sessions")), ["sess_test.json"]);
    assert.doesNotMatch(stdout, /gated-agent-browser-cli-teardown-|profiles\//);
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

describe("cli login", () => {
  it("prints an opaque session and policy draft without broker-owned paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-login-"));
    const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "login", "https://github.com/login"], {
      env: {
        ...process.env,
        GATED_AGENT_BROWSER_HOME: home,
      },
    });

    const parsed = JSON.parse(stdout) as {
      ok: true;
      siteId: string;
      session: { sessionId: string; profileId: string; login: { resetSiteDataRequested: boolean } };
      policy: { path: string };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.siteId, "github.com");
    assert.match(parsed.session.sessionId, /^sess_/);
    assert.match(parsed.session.profileId, /^prof_/);
    assert.equal(parsed.session.login.resetSiteDataRequested, true);
    assert.equal(parsed.policy.path, "github.com.yaml");
    assert.doesNotMatch(stdout, /gated-agent-browser-cli-login-|profiles\//);
    assert.deepEqual(await readdir(join(home, "policies")), ["github.com.yaml"]);
  });

  it("exits non-zero for invalid login urls", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-login-invalid-"));
    await assert.rejects(
      () =>
        execFileAsync(process.execPath, ["dist/cli.js", "login", "file:///tmp/profile"], {
          env: {
            ...process.env,
            GATED_AGENT_BROWSER_HOME: home,
          },
        }),
      /absolute http or https URL/,
    );
  });
});

describe("cli revoke", () => {
  it("revokes site sessions and policy without broker-owned paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-cli-revoke-"));
    const env = {
      ...process.env,
      GATED_AGENT_BROWSER_HOME: home,
    };
    const login = await execFileAsync(process.execPath, ["dist/cli.js", "login", "https://github.com/login"], { env });
    const sessionId = (JSON.parse(login.stdout) as { session: { sessionId: string } }).session.sessionId;
    const revoke = await execFileAsync(process.execPath, ["dist/cli.js", "revoke", "github.com"], { env });
    const parsed = JSON.parse(revoke.stdout) as {
      ok: true;
      revokedSessions: string[];
      policyArchived: boolean;
    };

    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.revokedSessions, [sessionId]);
    assert.equal(parsed.policyArchived, true);
    assert.doesNotMatch(revoke.stdout, /gated-agent-browser-cli-revoke-|profiles\//);
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
      async () =>
        execFileAsync(process.execPath, ["dist/cli.js", "browse", "batch", "--policy", policyPath, "--json", batchPath], {
          env: {
            ...process.env,
            GATED_AGENT_BROWSER_HOME: home,
          },
        }),
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
