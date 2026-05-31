import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_BROWSER_VERSION } from "./agent-browser-adapter.js";
import { initializeStorage } from "./storage.js";

export interface SetupResult {
  ok: true;
  initialized: true;
  directories: string[];
  prerequisites: {
    agentBrowserDependency: {
      configured: boolean;
      expectedVersion: string;
    };
    browserRuntimeInstall: {
      checked: false;
      reason: string;
    };
  };
}

export async function setup(): Promise<SetupResult> {
  const initialized = await initializeStorage();
  return {
    ...initialized,
    prerequisites: {
      agentBrowserDependency: {
        configured: await hasPinnedAgentBrowserDependency(),
        expectedVersion: AGENT_BROWSER_VERSION,
      },
      browserRuntimeInstall: {
        checked: false,
        reason: "setup does not run heavyweight browser installation automatically",
      },
    },
  };
}

async function hasPinnedAgentBrowserDependency(): Promise<boolean> {
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return packageJson.dependencies?.["agent-browser"] === AGENT_BROWSER_VERSION;
}
