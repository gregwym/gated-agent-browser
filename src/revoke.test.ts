import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readAuditEvents } from "./audit.js";
import { startLogin } from "./login.js";
import { revokeSite } from "./revoke.js";
import { listSessions } from "./session-store.js";
import { storageLayout } from "./storage.js";

describe("revokeSite", () => {
  it("revokes active site sessions and archives the policy without leaking profile paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-revoke-"));
    const layout = storageLayout(home);
    const login = await startLogin("https://github.com/login", {
      layout,
      now: () => "2026-05-31T00:00:00.000Z",
    });

    const result = await revokeSite("github.com", {
      layout,
      now: () => "2026-05-31T01:00:00.000Z",
    });

    assert.deepEqual(result, {
      ok: true,
      site: "github.com",
      revokedSessions: [login.session.sessionId],
      policyArchived: true,
    });
    assert.doesNotMatch(JSON.stringify(result), /profiles|gated-agent-browser-revoke-/);
    assert.equal((await listSessions({ siteId: "github.com", layout }))[0].status, "revoked");
    assert.deepEqual(await readdir(layout.dirs.policies), ["revoked"]);
    assert.deepEqual(await readdir(join(layout.dirs.policies, "revoked")), [
      "github.com.2026-05-31T01-00-00-000Z.yaml",
    ]);
    assert.deepEqual(
      (await readAuditEvents(layout)).map((event) => event.type),
      ["login.start", "policy.created", "login.complete", "session.revoked", "policy.revoked"],
    );
  });

  it("is deterministic when site data is already missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-revoke-missing-"));
    const layout = storageLayout(home);

    assert.deepEqual(await revokeSite("github.com", { layout, now: () => "2026-05-31T01:00:00.000Z" }), {
      ok: true,
      site: "github.com",
      revokedSessions: [],
      policyArchived: false,
    });
  });
});
