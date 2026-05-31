import type { BrokerRequest, BrokerResult } from "./broker.js";

export interface BrowserAdapter {
  perform(request: BrokerRequest): Promise<BrowserAdapterResult>;
}

export interface BrowserAdapterResult {
  finalUrl?: string;
  observedUrls?: ObservedBrowserUrl[];
  result?: BrokerResult;
}

export interface ObservedBrowserUrl {
  kind: "navigation" | "popup" | "iframe";
  url: string;
}

export class FakeBrowserAdapter implements BrowserAdapter {
  readonly requests: BrokerRequest[] = [];
  private currentUrl: string;
  private readonly redirects: Map<string, string>;
  private readonly textBySelector: Map<string, string>;
  private title: string;

  constructor(options: FakeBrowserAdapterOptions = {}) {
    this.currentUrl = options.initialUrl ?? "about:blank";
    this.redirects = new Map(Object.entries(options.redirects ?? {}));
    this.textBySelector = new Map(Object.entries(options.textBySelector ?? {}));
    this.title = options.title ?? "Fake Browser";
  }

  async perform(request: BrokerRequest): Promise<BrowserAdapterResult> {
    this.requests.push(request);

    if (request.action === "navigate") {
      const requestedUrl = request.target.kind === "url" ? request.target.url : this.currentUrl;
      this.currentUrl = this.redirects.get(requestedUrl) ?? requestedUrl;
      return { finalUrl: this.currentUrl, result: { kind: "url", url: this.currentUrl } };
    }

    if (request.action === "readText") {
      const selector = request.target.kind === "selector" ? request.target.selector : "";
      return {
        finalUrl: this.currentUrl,
        result: { kind: "text", text: this.textBySelector.get(selector) ?? "" },
      };
    }

    if (request.action === "getTitle") {
      return { finalUrl: this.currentUrl, result: { kind: "title", title: this.title } };
    }

    if (request.action === "getUrl") {
      return { finalUrl: this.currentUrl, result: { kind: "url", url: this.currentUrl } };
    }

    return { finalUrl: this.currentUrl, result: { kind: "empty" } };
  }
}

export interface FakeBrowserAdapterOptions {
  initialUrl?: string;
  redirects?: Record<string, string>;
  textBySelector?: Record<string, string>;
  title?: string;
}
