import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readAuditEvents } from "./audit.js";
import { startLogin, siteBoundaryFromUrl, type LoginAdapterStartOptions } from "./login.js";
import { loadPolicy } from "./policy.js";
import { policyFilePath } from "./policy-store.js";
import { loadSession } from "./session-store.js";
import { storageLayout } from "./storage.js";

describe("siteBoundaryFromUrl", () => {
  it("derives a safe site id and canonical origin from http urls", () => {
    assert.deepEqual(siteBoundaryFromUrl("https://GitHub.com/gregwym/gated-agent-browser#readme"), {
      siteId: "github.com",
      canonicalOrigin: "https://github.com",
      initialUrl: "https://github.com/gregwym/gated-agent-browser",
    });
  });

  it("rejects non-http login urls", () => {
    assert.throws(() => siteBoundaryFromUrl("file:///tmp/profile"), /absolute http or https URL/);
    assert.throws(() => siteBoundaryFromUrl("github.com/login"), /absolute http or https URL/);
  });
});

describe("startLogin", () => {
  it("creates a session and reviewable policy draft without exposing profile paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-login-"));
    const layout = storageLayout(home);
    const adapterCalls: LoginAdapterStartOptions[] = [];
    const result = await startLogin("https://github.com/login", {
      layout,
      now: () => "2026-05-31T00:00:00.000Z",
      adapter: {
        async start(options) {
          adapterCalls.push(options);
          return { finalUrl: options.initialUrl };
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.siteId, "github.com");
    assert.equal(result.canonicalOrigin, "https://github.com");
    assert.equal(result.policy.path, "github.com.yaml");
    assert.equal(result.resetSiteDataRequested, true);
    assert.equal(result.session.login?.resetSiteDataRequested, true);
    assert.doesNotMatch(JSON.stringify(result), /profiles|gated-agent-browser-login-/);
    assert.equal(adapterCalls.length, 1);
    assert.equal(adapterCalls[0].resetSiteData, true);
    assert.match(adapterCalls[0].profilePath, /profiles\/prof_/);

    const session = await loadSession(result.session.sessionId, layout);
    assert.equal(session.login?.initialUrl, "https://github.com/login");
    assert.equal(session.login?.resetSiteDataRequested, true);

    const policy = await loadPolicy(policyFilePath("github.com", layout));
    assert.equal(policy.actions.fill, "requireExplicitAllow");
    assert.equal(policy.actions.download, "deny");
    assert.deepEqual(policy.origins.allow, ["https://github.com/**"]);
    assert.match(await readFile(policyFilePath("github.com", layout), "utf8"), /destructiveSelectors/);
    assert.deepEqual(
      (await readAuditEvents(layout)).map((event) => event.type),
      ["login.start", "policy.created", "login.complete"],
    );
  });

  it("does not create session files for invalid urls", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-login-invalid-"));
    const layout = storageLayout(home);
    await assert.rejects(() => startLogin("javascript:alert(1)", { layout }), /absolute http or https URL/);
  });
});
