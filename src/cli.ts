#!/usr/bin/env node
import { Command } from "commander";
import { AdapterBatchExecutor, loadBatchInput, runBatch } from "./batch.js";
import { FakeBrowserAdapter } from "./browser-adapter.js";
import { decideAction, decideUrl, loadPolicy } from "./policy.js";
import { editPolicy, listPolicies, showPolicy } from "./policy-store.js";
import { initializeStorage } from "./storage.js";

const program = new Command();

program
  .name("gated-agent-browser")
  .description("Policy-gated wrapper around agent-browser")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize gated-agent-browser local storage")
  .action(async () => {
    printDecision(await initializeStorage());
  });

const policy = program.command("policy").description("Inspect and edit site policies");

policy
  .command("list")
  .description("List configured site policies")
  .action(async () => {
    printDecision(await listPolicies());
  });

policy
  .command("show")
  .description("Show one site policy")
  .argument("<site>", "Site id")
  .action(async (site: string) => {
    printDecision(await showPolicy(site));
  });

policy
  .command("edit")
  .description("Edit one site policy with $EDITOR")
  .argument("<site>", "Site id")
  .action(async (site: string) => {
    printDecision(await editPolicy(site));
  });

const browse = program.command("browse").description("Run policy-gated browser commands");

browse
  .command("batch")
  .description("Validate and run a batch of browse commands")
  .requiredOption("--policy <path>", "Path to a site policy YAML file")
  .requiredOption("--json <path>", "Path to batch JSON, or - for stdin")
  .action(async (options: { policy: string; json: string }) => {
    const sitePolicy = await loadPolicy(options.policy);
    const input = await loadBatchInput(options.json);
    const result = await runBatch(sitePolicy, input, new AdapterBatchExecutor(sitePolicy, new FakeBrowserAdapter()));
    printDecision(result);
    if (!result.ok) {
      process.exitCode = 2;
    }
  });

program
  .command("policy-check")
  .description("Check whether a policy allows an action and optional URL")
  .requiredOption("--policy <path>", "Path to a site policy YAML file")
  .requiredOption("--action <name>", "Action name to check")
  .option("--url <url>", "URL to check against policy")
  .option("--auth", "Allow auth-origin patterns while checking URL")
  .action(async (options: { policy: string; action: string; url?: string; auth?: boolean }) => {
    const policy = await loadPolicy(options.policy);
    const actionDecision = decideAction(policy, options.action);
    if (!actionDecision.ok) {
      printDecision(actionDecision);
      process.exitCode = 2;
      return;
    }

    if (options.url) {
      const urlDecision = decideUrl(policy, options.url, { allowAuth: options.auth });
      printDecision(urlDecision);
      if (!urlDecision.ok) {
        process.exitCode = 2;
      }
      return;
    }

    printDecision(actionDecision);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

function printDecision(decision: unknown): void {
  console.log(JSON.stringify(decision, null, 2));
}
