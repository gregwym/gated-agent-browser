import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { editPolicy, listPolicies, policyFilePath, showPolicy } from "./policy-store.js";
import { storageLayout } from "./storage.js";

const validPolicy = `version: 1
site: github.com
canonicalOrigin: https://github.com
origins:
  allow:
    - https://github.com/gregwym/gated-agent-browser/**
actions:
  navigate: allow
updatedAt: "2026-05-30T00:00:00Z"
`;

describe("policy store", () => {
  it("lists policy summaries from the storage policy directory", async () => {
    const layout = await testLayout();
    await writeFile(policyFilePath("github.com", layout), validPolicy);

    assert.deepEqual(await listPolicies(layout), [
      {
        site: "github.com",
        version: 1,
        canonicalOrigin: "https://github.com",
        path: "github.com.yaml",
        updatedAt: "2026-05-30T00:00:00Z",
      },
    ]);
  });

  it("shows and validates one policy by safe site id", async () => {
    const layout = await testLayout();
    await writeFile(policyFilePath("github.com", layout), validPolicy);

    assert.equal((await showPolicy("github.com", layout)).site, "github.com");
    assert.throws(() => policyFilePath("../secrets", layout), /safe site id/);
  });

  it("rejects edited policies that fail validation without replacing the original", async () => {
    const layout = await testLayout();
    const policyPath = policyFilePath("github.com", layout);
    await writeFile(policyPath, validPolicy);
    const editor = await editorScript("await writeFile(process.argv[2], 'version: nope\\n');");

    await assert.rejects(() => editPolicy("github.com", { editor, layout }), /version must be an integer/);
    assert.equal(await readFile(policyPath, "utf8"), validPolicy);
  });

  it("saves edited policies after validation succeeds", async () => {
    const layout = await testLayout();
    const policyPath = policyFilePath("github.com", layout);
    await writeFile(policyPath, validPolicy);
    const editor = await editorScript(
      "const raw = await readFile(process.argv[2], 'utf8'); await writeFile(process.argv[2], raw.replace('navigate: allow', 'navigate: deny'));",
    );

    assert.deepEqual(await editPolicy("github.com", { editor, layout }), {
      ok: true,
      site: "github.com",
      saved: true,
    });
    assert.match(await readFile(policyPath, "utf8"), /navigate: deny/);
  });
});

async function testLayout() {
  const home = await mkdtemp(join(tmpdir(), "gated-agent-browser-policy-"));
  const layout = storageLayout(home);
  await mkdir(layout.dirs.policies, { recursive: true });
  return layout;
}

async function editorScript(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gated-agent-browser-editor-"));
  const path = join(dir, "editor.mjs");
  await writeFile(path, `import { readFile, writeFile } from "node:fs/promises";\n${body}\n`);
  return `${process.execPath} ${path}`;
}
