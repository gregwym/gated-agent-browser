import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendAuditEvent, readAuditEvents } from "./audit.js";
import { auditEvent } from "./broker.js";
import { storageLayout } from "./storage.js";

describe("audit log", () => {
  it("appends JSONL events under the storage log directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-audit-"));
    const layout = storageLayout(home);
    await appendAuditEvent(
      {
        type: "login.start",
        timestamp: "2026-05-31T00:00:00.000Z",
        siteId: "github.com",
        url: "https://github.com/login",
        resetSiteDataRequested: true,
        outcome: "started",
      },
      layout,
    );
    await appendAuditEvent(
      {
        type: "policy.created",
        timestamp: "2026-05-31T00:00:00.000Z",
        siteId: "github.com",
        policyPath: "github.com.yaml",
        outcome: "allowed",
      },
      layout,
    );

    assert.deepEqual(
      (await readAuditEvents(layout)).map((event) => event.type),
      ["login.start", "policy.created"],
    );
  });

  it("redacts keypress values and rejects profile paths", async () => {
    const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-audit-redact-"));
    const layout = storageLayout(home);
    await appendAuditEvent(
      auditEvent(
        {
          requestId: "req_1",
          siteId: "github.com",
          action: "press",
          target: { kind: "key", key: "Enter" },
          createdAt: "2026-05-31T00:00:00.000Z",
        },
        {
          ok: true,
          requestId: "req_1",
          action: "press",
          result: { kind: "empty" },
        },
        "2026-05-31T00:00:00.000Z",
      ),
      layout,
    );
    assert.doesNotMatch(JSON.stringify(await readAuditEvents(layout)), /Enter/);
    await assert.rejects(
      () =>
        appendAuditEvent(
          {
            type: "policy.updated",
            timestamp: "2026-05-31T00:00:00.000Z",
            siteId: "github.com",
            policyPath: "/tmp/profiles/prof_secret/github.com.yaml",
            outcome: "allowed",
          },
          layout,
        ),
      /profile path/,
    );
  });
});
