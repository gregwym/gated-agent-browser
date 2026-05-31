import { spawn } from "node:child_process";
import type { BrowserAdapter, BrowserAdapterResult } from "./browser-adapter.js";
import type { BrokerRequest, BrokerRequestTarget } from "./broker.js";

export const AGENT_BROWSER_VERSION = "0.27.0";

export interface SubprocessRunner {
  run(command: string, args: string[], options?: SubprocessRunOptions): Promise<SubprocessResult>;
}

export interface SubprocessRunOptions {
  env?: NodeJS.ProcessEnv;
}

export interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentBrowserAdapterOptions {
  binary?: string;
  runner?: SubprocessRunner;
  env?: NodeJS.ProcessEnv;
  sessionName?: string;
  profilePath?: string;
}

export class AgentBrowserAdapter implements BrowserAdapter {
  private readonly binary: string;
  private readonly runner: SubprocessRunner;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly sessionName?: string;
  private readonly profilePath?: string;

  constructor(options: AgentBrowserAdapterOptions = {}) {
    this.binary = options.binary ?? "agent-browser";
    this.runner = options.runner ?? new SpawnSubprocessRunner();
    this.env = options.env;
    this.sessionName = options.sessionName;
    this.profilePath = options.profilePath;
  }

  async perform(request: BrokerRequest): Promise<BrowserAdapterResult> {
    const args = agentBrowserArgs(request, {
      sessionName: this.sessionName ?? request.sessionId,
      profilePath: this.profilePath,
    });
    const result = await this.runner.run(this.binary, args, { env: this.env });
    if (result.exitCode !== 0) {
      throw new AgentBrowserAdapterError("agent-browser command failed", result.exitCode);
    }

    return parseAgentBrowserResult(request, result.stdout);
  }
}

export class AgentBrowserAdapterError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = "AgentBrowserAdapterError";
  }
}

export class SpawnSubprocessRunner implements SubprocessRunner {
  async run(command: string, args: string[], options: SubprocessRunOptions = {}): Promise<SubprocessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  }
}

export function agentBrowserArgs(
  request: BrokerRequest,
  options: { sessionName?: string; profilePath?: string } = {},
): string[] {
  const args = ["--json", "--max-output", "20000"];
  if (options.sessionName) {
    args.push("--session", options.sessionName);
  }
  if (options.profilePath) {
    args.push("--profile", options.profilePath);
  }

  return [...args, ...actionArgs(request)];
}

function actionArgs(request: BrokerRequest): string[] {
  switch (request.action) {
    case "navigate":
      return ["open", targetUrl(request.target)];
    case "click":
      return ["click", targetSelectorOrRef(request.target)];
    case "fill":
      return ["fill", targetSelectorOrRef(request.target), request.value ?? ""];
    case "type":
      return ["type", targetSelectorOrRef(request.target), request.value ?? ""];
    case "press":
      return ["press", targetKey(request.target)];
    case "readText":
      return request.target.kind === "selector" || request.target.kind === "ref"
        ? ["get", "text", targetSelectorOrRef(request.target)]
        : ["get", "text"];
    case "snapshot":
      return ["snapshot"];
    case "getTitle":
      return ["get", "title"];
    case "getUrl":
      return ["get", "url"];
    case "wait":
      return ["wait", targetWait(request.target, request.value)];
    case "scroll":
      return request.value ? ["scroll", targetScrollDirection(request.target), request.value] : ["scroll", targetScrollDirection(request.target)];
    case "screenshotSelector":
      return ["screenshot", "--selector", targetSelectorOrRef(request.target)];
    case "close":
      return ["close"];
  }
}

function parseAgentBrowserResult(request: BrokerRequest, stdout: string): BrowserAdapterResult {
  const trimmed = stdout.trim();
  if (request.action === "getUrl") {
    return { finalUrl: trimmed, result: { kind: "url", url: trimmed } };
  }
  if (request.action === "getTitle") {
    return { result: { kind: "title", title: trimmed } };
  }
  if (request.action === "readText" || request.action === "snapshot") {
    return request.action === "snapshot"
      ? { result: { kind: "snapshot", snapshot: safeJsonParse(trimmed) ?? trimmed } }
      : { result: { kind: "text", text: trimmed } };
  }
  if (request.action === "navigate" && request.target.kind === "url") {
    return { finalUrl: request.target.url, result: { kind: "url", url: request.target.url } };
  }
  return { result: { kind: "empty" } };
}

function targetUrl(target: BrokerRequestTarget): string {
  if (target.kind !== "url") {
    throw new AgentBrowserAdapterError("Action requires a URL target");
  }
  return target.url;
}

function targetSelectorOrRef(target: BrokerRequestTarget): string {
  if (target.kind === "selector") {
    return target.selector;
  }
  if (target.kind === "ref") {
    return target.ref;
  }
  throw new AgentBrowserAdapterError("Action requires a selector or ref target");
}

function targetKey(target: BrokerRequestTarget): string {
  if (target.kind !== "key") {
    throw new AgentBrowserAdapterError("Action requires a key target");
  }
  return target.key;
}

function targetWait(target: BrokerRequestTarget, value?: string): string {
  if (target.kind === "selector" || target.kind === "ref") {
    return targetSelectorOrRef(target);
  }
  if (value) {
    return value;
  }
  throw new AgentBrowserAdapterError("Wait requires a selector, ref, or millisecond value");
}

function targetScrollDirection(target: BrokerRequestTarget): string {
  if (target.kind === "none") {
    return "down";
  }
  if (target.kind === "key") {
    return target.key;
  }
  throw new AgentBrowserAdapterError("Scroll requires a direction target");
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
