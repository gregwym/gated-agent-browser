import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createSession,
  listSessions,
  loadSession,
  profileDirectory,
  revokeSession,
  sessionFilePath,
} from "./session-store.js";
import { storageLayout } from "./storage.js";

describe("session store", () => {
  it("creates and loads opaque session metadata without public profile paths", async () => {
    const layout = await testLayout();
    const summary = await createSession({
      siteId: "github.com",
      sessionId: "sess_test",
      profileId: "prof_test",
      createdAt: "2026-05-31T00:00:00.000Z",
      expiresAt: "2026-06-07T00:00:00.000Z",
      layout,
    });

    assert.deepEqual(summary, {
      sessionId: "sess_test",
      siteId: "github.com",
      profileId: "prof_test",
      status: "active",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      expiresAt: "2026-06-07T00:00:00.000Z",
    });
    assert.doesNotMatch(JSON.stringify(summary), /profiles|gated-agent-browser-session-/);

    const stored = await loadSession("sess_test", layout);
    assert.equal(stored.profileId, "prof_test");
    assert.match(profileDirectory(stored.profileId, layout), /profiles\/prof_test$/);
  });

  it("lists sessions by site without leaking profile directories", async () => {
    const layout = await testLayout();
    await createSession({
      siteId: "github.com",
      sessionId: "sess_github",
      profileId: "prof_github",
      createdAt: "2026-05-31T00:00:00.000Z",
      layout,
    });
    await createSession({
      siteId: "example.com",
      sessionId: "sess_example",
      profileId: "prof_example",
      createdAt: "2026-05-31T00:01:00.000Z",
      layout,
    });

    assert.deepEqual((await listSessions({ siteId: "github.com", layout })).map((session) => session.sessionId), [
      "sess_github",
    ]);
    assert.doesNotMatch(JSON.stringify(await listSessions({ layout })), /profiles|gated-agent-browser-session-/);
  });

  it("revokes a session by metadata status instead of deleting the file", async () => {
    const layout = await testLayout();
    await createSession({
      siteId: "github.com",
      sessionId: "sess_test",
      profileId: "prof_test",
      createdAt: "2026-05-31T00:00:00.000Z",
      layout,
    });

    assert.deepEqual(await revokeSession("sess_test", { revokedAt: "2026-05-31T01:00:00.000Z", layout }), {
      ok: true,
      sessionId: "sess_test",
      siteId: "github.com",
      revoked: true,
    });
    assert.equal((await loadSession("sess_test", layout)).status, "revoked");
    assert.match(await readFile(sessionFilePath("sess_test", layout), "utf8"), /"revokedAt"/);
  });

  it("rejects unsafe ids before file access", async () => {
    const layout = await testLayout();
    assert.throws(() => sessionFilePath("../secret", layout), /safe id/);
    await assert.rejects(
      () => createSession({ siteId: "github.com", sessionId: "../secret", profileId: "prof_test", layout }),
      /safe id/,
    );
    await writeFile(
      sessionFilePath("sess_unsafe", layout),
      JSON.stringify({
        version: 1,
        sessionId: "../secret",
        siteId: "github.com",
        profileId: "prof_test",
        status: "active",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
      }),
    );
    await assert.rejects(() => loadSession("sess_unsafe", layout), /safe id/);
  });
});

async function testLayout() {
  const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-session-"));
  const layout = storageLayout(home);
  await mkdir(layout.dirs.sessions, { recursive: true });
  await mkdir(layout.dirs.profiles, { recursive: true });
  return layout;
}
