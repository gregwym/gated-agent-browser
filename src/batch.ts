import { readFile } from "node:fs/promises";
import {
  auditEvent,
  blockedResponse,
  type BrokerAction,
  type BrokerAuditEvent,
  type BrokerRequest,
  type BrokerRequestTarget,
  type BrokerResponse,
} from "./broker.js";
import { PolicyBrokerExecutor } from "./broker-executor.js";
import type { BrowserAdapter } from "./browser-adapter.js";
import { decideAction, decideUrl, type SitePolicy } from "./policy.js";

export interface BrowseBatchInput {
  siteId: string;
  sessionId?: string;
  commands: BrowseBatchCommandInput[];
}

export interface BrowseBatchCommandInput {
  action: BrokerAction;
  target?: BrokerRequestTarget;
  value?: string;
}

export interface BrowseBatchAllowed {
  ok: true;
  responses: BrokerResponse[];
}

export interface BrowseBatchBlocked {
  ok: false;
  blocked: {
    rule: string;
    reason: string;
    commandIndex: number;
    requestId: string;
    action: BrokerAction;
    url?: string;
  };
}

export type BrowseBatchResult = BrowseBatchAllowed | BrowseBatchBlocked;

export interface BatchExecutor {
  execute(request: BrokerRequest): Promise<BrokerResponse>;
}

export async function loadBatchInput(path: string): Promise<BrowseBatchInput> {
  const raw = path === "-" ? await readStdin() : await readFile(path, "utf8");
  return normalizeBatchInput(JSON.parse(raw) as unknown);
}

export async function runBatch(
  policy: SitePolicy,
  input: BrowseBatchInput,
  executor: BatchExecutor,
  options: { now?: () => string; audit?: (event: BrokerAuditEvent) => Promise<void> } = {},
): Promise<BrowseBatchResult> {
  const requests = input.commands.map((command, index) =>
    commandToRequest(input, command, index, options.now ?? (() => new Date().toISOString())),
  );
  const block = firstBlocked(policy, requests);
  if (block) {
    if (options.audit) {
      await options.audit(block.auditEvent);
    }
    return block.result;
  }

  const responses: BrokerResponse[] = [];
  for (const request of requests) {
    const response = await executor.execute(request);
    responses.push(response);
    if (options.audit) {
      await options.audit(auditEvent(request, response));
    }
  }
  return { ok: true, responses };
}

export function normalizeBatchInput(value: unknown): BrowseBatchInput {
  if (!isRecord(value)) {
    throw new Error("Batch JSON must be an object");
  }
  const siteId = expectString(value.siteId, "siteId");
  const sessionId = optionalString(value.sessionId, "sessionId");
  const commandsValue = value.commands;
  if (!Array.isArray(commandsValue) || commandsValue.length === 0) {
    throw new Error("commands must be a non-empty array");
  }

  return {
    siteId,
    sessionId,
    commands: commandsValue.map((command, index) => normalizeCommand(command, `commands[${index}]`)),
  };
}

export class AdapterBatchExecutor extends PolicyBrokerExecutor {
  constructor(policy: SitePolicy, adapter: BrowserAdapter) {
    super(policy, adapter);
  }
}

function commandToRequest(
  input: BrowseBatchInput,
  command: BrowseBatchCommandInput,
  index: number,
  now: () => string,
): BrokerRequest {
  return {
    requestId: `batch_${index + 1}`,
    siteId: input.siteId,
    sessionId: input.sessionId,
    action: command.action,
    target: command.target ?? { kind: "none" },
    value: command.value,
    createdAt: now(),
  };
}

function firstBlocked(
  policy: SitePolicy,
  requests: BrokerRequest[],
): { result: BrowseBatchBlocked; auditEvent: BrokerAuditEvent } | null {
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const actionDecision = decideAction(policy, request.action);
    if (!actionDecision.ok) {
      return batchBlock(index, request, blockedResponse(request, actionDecision));
    }

    if (request.target.kind === "url") {
      const urlDecision = decideUrl(policy, request.target.url);
      if (!urlDecision.ok) {
        return batchBlock(index, request, blockedResponse(request, urlDecision));
      }
    }
  }
  return null;
}

function batchBlock(
  commandIndex: number,
  request: BrokerRequest,
  response: Extract<BrokerResponse, { ok: false }>,
): { result: BrowseBatchBlocked; auditEvent: BrokerAuditEvent } {
  return {
    result: {
      ok: false,
      blocked: {
        rule: response.blocked.rule,
        reason: response.blocked.reason,
        commandIndex,
        requestId: response.requestId,
        action: response.action,
        url: response.blocked.url,
      },
    },
    auditEvent: auditEvent(request, response),
  };
}

function normalizeCommand(value: unknown, path: string): BrowseBatchCommandInput {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  return {
    action: expectAction(value.action, `${path}.action`),
    target: optionalTarget(value.target, `${path}.target`),
    value: optionalString(value.value, `${path}.value`),
  };
}

function optionalTarget(value: unknown, path: string): BrokerRequestTarget | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  const kind = expectString(value.kind, `${path}.kind`);
  if (kind === "url") {
    return { kind, url: expectString(value.url, `${path}.url`) };
  }
  if (kind === "selector") {
    return { kind, selector: expectString(value.selector, `${path}.selector`) };
  }
  if (kind === "ref") {
    return { kind, ref: expectString(value.ref, `${path}.ref`) };
  }
  if (kind === "key") {
    return { kind, key: expectString(value.key, `${path}.key`) };
  }
  if (kind === "none") {
    return { kind };
  }
  throw new Error(`${path}.kind must be url, selector, ref, key, or none`);
}

function expectAction(value: unknown, path: string): BrokerAction {
  const action = expectString(value, path);
  if (!isBrokerAction(action)) {
    throw new Error(`${path} is not a supported broker action`);
  }
  return action;
}

function isBrokerAction(value: string): value is BrokerAction {
  return [
    "navigate",
    "click",
    "fill",
    "type",
    "press",
    "readText",
    "snapshot",
    "getTitle",
    "getUrl",
    "wait",
    "scroll",
    "screenshotSelector",
    "submitForm",
    "download",
    "upload",
    "close",
  ].includes(value);
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return expectString(value, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
