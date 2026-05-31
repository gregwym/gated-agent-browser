import { allowedResponse, blockedResponse, type BrokerRequest, type BrokerResponse } from "./broker.js";
import type { BrowserAdapter } from "./browser-adapter.js";
import { decideAction, decideUrl, type SitePolicy } from "./policy.js";

export class PolicyBrokerExecutor {
  constructor(
    private readonly policy: SitePolicy,
    private readonly adapter: BrowserAdapter,
  ) {}

  async execute(request: BrokerRequest): Promise<BrokerResponse> {
    const actionDecision = decideAction(this.policy, request.action);
    if (!actionDecision.ok) {
      return blockedResponse(request, actionDecision);
    }

    if (request.target.kind === "url") {
      const urlDecision = decideUrl(this.policy, request.target.url);
      if (!urlDecision.ok) {
        return blockedResponse(request, urlDecision);
      }
    }

    const selectorDecision = decideSelector(this.policy, request);
    if (selectorDecision) {
      return selectorDecision;
    }

    let adapterResult;
    try {
      adapterResult = await this.adapter.perform(request);
    } catch {
      return blockedResponse(request, {
        ok: false,
        blocked: {
          rule: "adapter.browser",
          reason: "Browser adapter failed before completing the action",
          action: request.action,
        },
      });
    }

    if (adapterResult.finalUrl) {
      const blocked = blockUrl(request, this.policy, adapterResult.finalUrl, "Post-action URL is outside the allowed policy scope");
      if (blocked) {
        return blocked;
      }
    }

    for (const observedUrl of adapterResult.observedUrls ?? []) {
      const blocked = blockUrl(
        request,
        this.policy,
        observedUrl.url,
        `Observed ${observedUrl.kind} URL is outside the allowed policy scope`,
      );
      if (blocked) {
        return blocked;
      }
    }

    return allowedResponse(request, adapterResult.result);
  }
}

function decideSelector(policy: SitePolicy, request: BrokerRequest): BrokerResponse | null {
  if (request.target.kind !== "selector") {
    return null;
  }
  if (request.action === "click" && matchesSelectorPolicy(request.target.selector, policy.destructiveSelectors ?? [])) {
    return blockedResponse(request, {
      ok: false,
      blocked: {
        rule: "destructiveSelectors",
        reason: "Selector matches a destructive policy pattern",
        action: request.action,
      },
    });
  }
  if (
    request.action === "screenshotSelector" &&
    matchesSelectorPolicy(request.target.selector, policy.sensitiveSelectors ?? [])
  ) {
    return blockedResponse(request, {
      ok: false,
      blocked: {
        rule: "sensitiveSelectors",
        reason: "Selector matches a sensitive policy pattern",
        action: request.action,
      },
    });
  }
  return null;
}

function matchesSelectorPolicy(selector: string, patterns: string[]): boolean {
  return patterns.some((pattern) => selector === pattern || selector.toLowerCase().includes(selectorNeedle(pattern)));
}

function selectorNeedle(pattern: string): string {
  const dataTestIdContains = /\[data-testid\*="([^"]+)"/i.exec(pattern)?.[1];
  if (dataTestIdContains) {
    return dataTestIdContains.toLowerCase();
  }
  const textContains = /:has-text\("([^"]+)"\)/i.exec(pattern)?.[1];
  if (textContains) {
    return textContains.toLowerCase();
  }
  return pattern.toLowerCase();
}

function blockUrl(
  request: BrokerRequest,
  policy: SitePolicy,
  url: string,
  reason: string,
): BrokerResponse | null {
  const decision = decideUrl(policy, url);
  if (decision.ok) {
    return null;
  }
  return blockedResponse(request, {
    ok: false,
    blocked: {
      ...decision.blocked,
      reason,
    },
  });
}
