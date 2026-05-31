import type { BrowserAdapter, BrowserAdapterResult, ObservedBrowserUrl } from "./browser-adapter.js";
import type { BrokerRequest } from "./broker.js";

export class FixtureBrowserAdapter implements BrowserAdapter {
  private currentUrl = "about:blank";
  private currentHtml = "";

  async perform(request: BrokerRequest): Promise<BrowserAdapterResult> {
    if (request.action === "navigate" && request.target.kind === "url") {
      return this.navigate(request.target.url);
    }

    if (request.action === "click" && (request.target.kind === "selector" || request.target.kind === "ref")) {
      return this.click(request.target.kind === "selector" ? request.target.selector : request.target.ref);
    }

    if (request.action === "readText") {
      return { finalUrl: this.currentUrl, result: { kind: "text", text: textContent(this.currentHtml) } };
    }

    if (request.action === "getUrl") {
      return { finalUrl: this.currentUrl, result: { kind: "url", url: this.currentUrl } };
    }

    if (request.action === "screenshotSelector") {
      return { finalUrl: this.currentUrl, result: { kind: "screenshot", mimeType: "image/png", data: "fixture" } };
    }

    return { finalUrl: this.currentUrl, result: { kind: "empty" } };
  }

  private async navigate(url: string): Promise<BrowserAdapterResult> {
    const response = await fetch(url, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        this.currentUrl = new URL(location, url).toString();
        this.currentHtml = "";
        return { finalUrl: this.currentUrl, result: { kind: "url", url: this.currentUrl } };
      }
    }

    this.currentUrl = response.url;
    this.currentHtml = await response.text();
    const jsRedirect = firstMatch(this.currentHtml, /location\.href\s*=\s*"([^"]+)"/);
    if (jsRedirect) {
      this.currentUrl = new URL(jsRedirect, this.currentUrl).toString();
      return { finalUrl: this.currentUrl, result: { kind: "url", url: this.currentUrl } };
    }

    return {
      finalUrl: this.currentUrl,
      observedUrls: observedUrls(this.currentHtml, this.currentUrl),
      result: { kind: "url", url: this.currentUrl },
    };
  }

  private click(selector: string): BrowserAdapterResult {
    if (selector !== "#popup") {
      return { finalUrl: this.currentUrl, result: { kind: "empty" } };
    }
    const href = firstMatch(this.currentHtml, /<a[^>]+id="popup"[^>]+href="([^"]+)"/);
    return {
      finalUrl: this.currentUrl,
      observedUrls: href ? [{ kind: "popup", url: new URL(href, this.currentUrl).toString() }] : [],
      result: { kind: "empty" },
    };
  }
}

function observedUrls(html: string, baseUrl: string): ObservedBrowserUrl[] {
  const iframe = firstMatch(html, /<iframe[^>]+src="([^"]+)"/);
  return iframe ? [{ kind: "iframe", url: new URL(unescapeHtml(iframe), baseUrl).toString() }] : [];
}

function firstMatch(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.[1] ?? null;
}

function textContent(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function unescapeHtml(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
