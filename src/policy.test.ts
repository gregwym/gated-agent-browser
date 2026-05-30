import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideAction, decideUrl, normalizePolicy, type SitePolicy } from "./policy.js";

const policy: SitePolicy = normalizePolicy({
  version: 1,
  site: "github.com",
  canonicalOrigin: "https://github.com",
  origins: {
    allow: ["https://github.com/gregwym/gated-agent-browser/**"],
    auth: ["https://github.com/login/**"],
    deny: ["https://github.com/gregwym/gated-agent-browser/settings/delete/**"],
  },
  actions: {
    navigate: "allow",
    click: "allow",
    fill: "requireExplicitAllow",
    press: "allow",
    screenshotSelector: "requireExplicitAllow",
    screenshotFullPage: "deny",
    evaluateScript: "deny",
  },
});

describe("decideUrl", () => {
  it("allows URLs matching allow patterns", () => {
    assert.deepEqual(decideUrl(policy, "https://github.com/gregwym/gated-agent-browser/issues"), { ok: true });
  });

  it("denies URLs outside the allow scope", () => {
    const decision = decideUrl(policy, "https://github.com/gregwym/other");
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.blocked.rule, "origins.allow");
    }
  });

  it("gives deny patterns precedence over allow patterns", () => {
    const decision = decideUrl(policy, "https://github.com/gregwym/gated-agent-browser/settings/delete/repo");
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.blocked.rule, "origins.deny");
    }
  });

  it("allows auth origins only when requested", () => {
    assert.equal(decideUrl(policy, "https://github.com/login/oauth").ok, false);
    assert.equal(decideUrl(policy, "https://github.com/login/oauth", { allowAuth: true }).ok, true);
  });

  it("rejects non-http URLs", () => {
    const decision = decideUrl(policy, "file:///Users/kurisu/.ssh/id_rsa");
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.blocked.rule, "url.parse");
    }
  });
});

describe("decideAction", () => {
  it("allows explicitly allowed actions", () => {
    assert.deepEqual(decideAction(policy, "click"), { ok: true });
    assert.deepEqual(decideAction(policy, "press"), { ok: true });
  });

  it("blocks actions that need explicit grants", () => {
    const decision = decideAction(policy, "fill");
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.blocked.rule, "actions.fill");
      assert.match(decision.blocked.reason, /explicit policy grant/);
    }
  });

  it("denies unknown actions by default", () => {
    const decision = decideAction(policy, "cookies");
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.blocked.rule, "actions.cookies");
    }
  });
});
