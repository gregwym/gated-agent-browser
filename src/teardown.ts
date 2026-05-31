import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { storageLayout, type StorageLayout } from "./storage.js";

export interface TeardownOptions {
  layout?: StorageLayout;
  confirm?: boolean;
  policies?: boolean;
  sessions?: boolean;
  profiles?: boolean;
  logs?: boolean;
  revokedPolicies?: boolean;
}

export interface TeardownResult {
  ok: true;
  dryRun: boolean;
  selected: string[];
  categories: Record<TeardownCategory, TeardownCategorySummary>;
}

export interface TeardownCategorySummary {
  selected: boolean;
  removed: boolean;
  count: number;
}

type TeardownCategory = "policies" | "sessions" | "profiles" | "logs" | "revokedPolicies";

const CATEGORIES: TeardownCategory[] = ["policies", "sessions", "profiles", "logs", "revokedPolicies"];

export async function teardown(options: TeardownOptions = {}): Promise<TeardownResult> {
  const layout = options.layout ?? storageLayout();
  const dryRun = options.confirm !== true;
  const selections: Record<TeardownCategory, boolean> = {
    policies: options.policies === true,
    sessions: options.sessions === true,
    profiles: options.profiles === true,
    logs: options.logs === true,
    revokedPolicies: options.revokedPolicies === true,
  };
  const categories = Object.fromEntries(
    await Promise.all(
      CATEGORIES.map(async (category) => [
        category,
        await summarizeCategory(category, layout, selections[category], dryRun),
      ]),
    ),
  ) as Record<TeardownCategory, TeardownCategorySummary>;

  return {
    ok: true,
    dryRun,
    selected: CATEGORIES.filter((category) => selections[category]),
    categories,
  };
}

async function summarizeCategory(
  category: TeardownCategory,
  layout: StorageLayout,
  selected: boolean,
  dryRun: boolean,
): Promise<TeardownCategorySummary> {
  const paths = await categoryPaths(category, layout);
  if (selected && !dryRun) {
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
  }
  return {
    selected,
    removed: selected && !dryRun,
    count: paths.length,
  };
}

async function categoryPaths(category: TeardownCategory, layout: StorageLayout): Promise<string[]> {
  if (category === "policies") {
    return childPaths(layout.dirs.policies, (name) => (name.endsWith(".yaml") || name.endsWith(".yml")) && name !== "revoked");
  }
  if (category === "sessions") {
    return childPaths(layout.dirs.sessions, (name) => name.endsWith(".json"));
  }
  if (category === "profiles") {
    return childPaths(layout.dirs.profiles);
  }
  if (category === "logs") {
    return childPaths(layout.dirs.logs);
  }
  return childPaths(join(layout.dirs.policies, "revoked"));
}

async function childPaths(dir: string, filter: (name: string) => boolean = () => true): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  return entries.filter((entry) => filter(entry.name)).map((entry) => join(dir, entry.name));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
