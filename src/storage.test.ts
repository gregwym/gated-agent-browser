import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  STORAGE_DIR_NAMES,
  directoryMode,
  initializeStorage,
  resolveStorageHome,
  storageLayout,
} from "./storage.js";

describe("storage layout", () => {
  it("uses GATED_AGENT_BROWSER_HOME when provided", () => {
    assert.equal(
      resolveStorageHome({ GATED_AGENT_BROWSER_HOME: "/tmp/gated-agent-browser-test" }),
      "/tmp/gated-agent-browser-test",
    );
  });

  it("resolves the expected broker-owned directories", () => {
    const layout = storageLayout("/tmp/gated-agent-browser-test");

    assert.deepEqual(layout.dirs, {
      policies: "/tmp/gated-agent-browser-test/policies",
      sessions: "/tmp/gated-agent-browser-test/sessions",
      approvals: "/tmp/gated-agent-browser-test/approvals",
      logs: "/tmp/gated-agent-browser-test/logs",
      profiles: "/tmp/gated-agent-browser-test/profiles",
    });
  });
});

describe("initializeStorage", () => {
  it("creates restricted directories on POSIX platforms", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX directory modes are not stable on Windows");
      return;
    }

    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-"));
    const summary = await initializeStorage(home);
    const layout = storageLayout(home);

    assert.deepEqual(summary, {
      ok: true,
      initialized: true,
      directories: [...STORAGE_DIR_NAMES],
    });

    assert.equal(await directoryMode(layout.home), 0o700);
    for (const dirName of STORAGE_DIR_NAMES) {
      assert.equal(await directoryMode(layout.dirs[dirName]), 0o700);
    }
  });
});
