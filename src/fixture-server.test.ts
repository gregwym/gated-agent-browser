import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startFixtureServer } from "./fixture-server.js";

describe("fixture server", () => {
  it("serves deterministic local runtime enforcement fixtures", async () => {
    const server = await startFixtureServer();
    try {
      assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);

      const allowed = await fetch(server.url("/allowed"));
      assert.equal(allowed.status, 200);
      assert.match(await allowed.text(), /Allowed fixture page/);

      const popup = await fetch(server.url("/popup"));
      assert.match(await popup.text(), /target="_blank"/);

      const iframe = await fetch(server.url("/iframe?src=https://example.com/frame"));
      assert.match(await iframe.text(), /https:\/\/example.com\/frame/);

      const download = await fetch(server.url("/download"));
      assert.equal(download.headers.get("content-disposition"), 'attachment; filename="fixture.txt"');

      const upload = await fetch(server.url("/upload"));
      assert.match(await upload.text(), /multipart\/form-data/);

      const destructive = await fetch(server.url("/destructive"));
      assert.match(await destructive.text(), /delete-repo/);

      const promptInjection = await fetch(server.url("/prompt-injection"));
      assert.match(await promptInjection.text(), /Ignore previous instructions/);
    } finally {
      await server.close();
    }
  });

  it("supports server redirect fixtures without following them in tests", async () => {
    const server = await startFixtureServer();
    try {
      const response = await fetch(server.url("/redirect/server?to=https://example.com/escaped"), {
        redirect: "manual",
      });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "https://example.com/escaped");
    } finally {
      await server.close();
    }
  });
});
