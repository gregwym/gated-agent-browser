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
      const postActionDecision = decideUrl(this.policy, adapterResult.finalUrl);
      if (!postActionDecision.ok) {
        return blockedResponse(request, {
          ok: false,
          blocked: {
            ...postActionDecision.blocked,
            reason: "Post-action URL is outside the allowed policy scope",
          },
        });
      }
    }

    return allowedResponse(request, adapterResult.result);
  }
}
