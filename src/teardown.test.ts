import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { teardown } from "./teardown.js";
import { storageLayout } from "./storage.js";

describe("teardown", () => {
  it("defaults to a non-destructive dry-run plan", async () => {
    const layout = await populatedLayout();
    const result = await teardown({ layout });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.selected, []);
    assert.equal(result.categories.policies.count, 1);
    assert.equal(result.categories.revokedPolicies.count, 1);
    assert.equal(result.categories.sessions.count, 1);
    assert.equal(result.categories.profiles.count, 1);
    assert.equal(result.categories.logs.count, 1);
    assert.deepEqual(await readdir(layout.dirs.sessions), ["sess_test.json"]);
    assert.doesNotMatch(JSON.stringify(result), /gated-agent-browser-teardown-|profiles\//);
  });

  it("removes only explicitly selected categories when confirmed", async () => {
    const layout = await populatedLayout();
    const result = await teardown({ layout, confirm: true, sessions: true, logs: true });

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.selected, ["sessions", "logs"]);
    assert.equal(result.categories.sessions.removed, true);
    assert.equal(result.categories.logs.removed, true);
    assert.deepEqual(await readdir(layout.dirs.sessions), []);
    assert.deepEqual(await readdir(layout.dirs.logs), []);
    assert.deepEqual(await readdir(layout.dirs.policies), ["github.com.yaml", "revoked"]);
    assert.deepEqual(await readdir(layout.dirs.profiles), ["prof_test"]);
  });
});

async function populatedLayout() {
  const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-teardown-"));
  const layout = storageLayout(home);
  await mkdir(layout.dirs.policies, { recursive: true });
  await mkdir(layout.dirs.sessions, { recursive: true });
  await mkdir(layout.dirs.profiles, { recursive: true });
  await mkdir(layout.dirs.logs, { recursive: true });
  await mkdir(join(layout.dirs.policies, "revoked"), { recursive: true });
  await writeFile(join(layout.dirs.policies, "github.com.yaml"), "site: github.com\n");
  await writeFile(join(layout.dirs.policies, "revoked", "github.com.revoked.yaml"), "site: github.com\n");
  await writeFile(join(layout.dirs.sessions, "sess_test.json"), "{}\n");
  await mkdir(join(layout.dirs.profiles, "prof_test"));
  await writeFile(join(layout.dirs.logs, "audit.jsonl"), "{}\n");
  return layout;
}
