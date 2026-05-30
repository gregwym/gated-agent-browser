# GateLens Requirements

## Summary

GateLens is a secure wrapper for `agent-browser`. It keeps the user-facing command style close to `agent-browser`, but exposes only the minimum command set and applies policy checks or behavior changes before browser actions reach the underlying browser runtime.

The main security boundary is between:

- human login capability in a headed browser;
- agent automation capability in a headless browser.

The agent should never receive direct access to the human's headed browser profile, raw cookies, or unconstrained authenticated browsing surface.

## Goals

- Wrap `agent-browser` while preserving a familiar command interface where practical.
- Expose only necessary browser commands to agents.
- Filter, reject, or rewrite commands at the wrapper layer.
- Provide one-command install and uninstall.
- Create an isolated local user or equivalent OS boundary for browser/profile storage.
- Support `login <url>` for human-controlled headed login.
- Reset site-local data before each login by default.
- Generate and maintain per-site browsing policies after login.
- Enforce those policies during all headless browser usage.
- Provide auditability for login, policy, and headless browsing activity.

## Non-Goals

- Do not provide a general-purpose remote desktop browser for agents.
- Do not let agents browse arbitrary authenticated websites after a user logs in.
- Do not make `login` a way to reopen previously authenticated headed sessions.
- Do not silently perform external or destructive account actions without policy and user authorization.
- Do not rely on prompt instructions as the security boundary.

## Installation And Setup

GateLens should provide one-command setup and teardown.

Setup should install:

- the `gatelens` CLI;
- required browser/runtime dependencies;
- an isolated OS user or equivalent sandbox boundary;
- directories for profiles, policies, logs, and templates;
- optional background service components if a broker/daemon architecture is used.

Uninstall should support separate levels:

- remove CLI and service only;
- remove the isolated user;
- remove policies;
- remove browser profiles and session data;
- remove audit logs.

Destructive uninstall modes must be explicit.

## Command Surface

GateLens should keep the command shape close to `agent-browser`, but expose only commands that can be mediated safely.

Initial command groups:

- `gatelens login <url>`: start a human headed login flow.
- `gatelens policy list`: list configured site policies.
- `gatelens policy show <site>`: inspect one policy.
- `gatelens policy edit <site>`: manually edit a policy.
- `gatelens revoke <site>`: revoke a site's session and policy.
- `gatelens browse ...`: run allowed headless browsing commands.

High-risk commands should be omitted or disabled by default:

- arbitrary JavaScript evaluation;
- unrestricted download;
- unrestricted upload;
- arbitrary cross-domain navigation;
- raw cookie or storage export;
- unrestricted screenshot capture;
- unrestricted form submission.

## Login Flow

`gatelens login <url>` starts a headed browser for a human to authenticate.

Required behavior:

- Determine the initial site boundary from the URL.
- Reset local site data by default before opening the browser.
- Start a fresh headed browser context.
- Restrict browsing to the configured site boundary.
- Allow explicitly configured authentication domains when needed, such as OAuth or SSO providers.
- Prevent navigation to unrelated domains.
- Prevent agents or other users from using `login` to inspect an already authenticated session.
- Store the headed login profile where the agent cannot read it directly.
- Finish by generating or updating a policy for the authenticated site.

Default local data reset should cover:

- cookies;
- localStorage;
- sessionStorage;
- IndexedDB;
- HTTP cache;
- service workers;
- browser permissions where practical.

The default posture is that each `login` requires fresh human authentication.

## Site Boundary Rules

The project needs a precise definition of "same domain".

The policy model should distinguish:

- exact host, such as `app.example.com`;
- registrable domain, such as `example.com`;
- allowed subdomains;
- static asset domains;
- API domains;
- OAuth/SSO domains;
- blocked external domains.

Rules must handle redirects, links, popups, iframes, downloads, and JavaScript-triggered navigation.

## Policy Configuration

After login, GateLens should configure what the agent may access.

Policy sources:

- built-in templates for common websites;
- generated policies from site scanning and the user's stated task;
- manual user edits.

Policy should be declarative and auditable. A policy should include:

- site id and canonical origin;
- allowed URL patterns;
- denied URL patterns;
- allowed external authentication origins;
- allowed browser actions;
- form submission rules;
- download rules;
- upload rules;
- screenshot rules;
- page text extraction rules;
- sensitive selectors;
- destructive action selectors;
- session lifetime;
- policy version;
- creation and modification metadata.

Example shape:

```yaml
site: github.com
origins:
  allow:
    - https://github.com/gregwym/gated-agent-browser/**
  auth:
    - https://github.com/login/**
actions:
  navigate: allow
  click: allow
  readText: allow
  screenshot: requirePolicy
  submitForm: requireExplicitAllow
  download: deny
  upload: deny
  evaluateScript: deny
sensitiveSelectors: []
destructiveSelectors:
  - '[data-testid*="delete"]'
  - 'button:has-text("Delete")'
ttl: 7d
```

## Headless Browsing Enforcement

Headless commands must be evaluated against policy before and after browser actions.

Required checks:

- validate initial target URL;
- validate each navigation request;
- validate redirects;
- validate popups and new tabs;
- validate iframe navigations where observable;
- validate downloads before allowing file access;
- validate uploads before exposing local files;
- validate form submissions;
- validate post-action URL and origin.

Command entry checks are not enough. The browser runtime can change location through redirects, JavaScript, service workers, links, target tabs, and embedded frames.

Rejected actions should return a clear reason and the policy rule that blocked them.

## Session And Profile Isolation

The agent must not be able to read headed login profile data directly.

Preferred architecture: broker-held sessions.

In this model:

- the privileged browser broker owns profiles, cookies, and authenticated browser contexts;
- the agent-facing CLI sends structured browser requests to the broker;
- the broker enforces policy and performs browser actions;
- the agent receives only allowed results.

The agent should receive an opaque session id, not raw cookies or profile files.

## Threat Model

GateLens should defend against:

- agent attempts to browse outside the intended site;
- prompt injection from webpage content;
- webpage JavaScript triggering unauthorized navigation or downloads;
- accidental exposure of cookies, tokens, or profile files;
- other local users or processes reusing a headed login session;
- policy bypass through redirects, popups, iframes, downloads, uploads, or service workers.

GateLens does not by itself defend against:

- a fully compromised host OS;
- a malicious browser binary;
- user-approved policies that intentionally grant broad access.

## Prompt Injection Handling

Webpage content is untrusted input.

The browser policy layer must remain the final authority. A page that tells the agent to visit another URL, download a file, reveal credentials, or submit a form must not be able to override policy.

## Remote Headed Login

If remote headed login is supported, it must include:

- encrypted transport;
- short-lived pairing tokens;
- explicit session ownership;
- no exposed unauthenticated browser debug ports;
- automatic expiry;
- audit logs for connection and disconnect events.

## Audit Logs

GateLens should record:

- login start and completion;
- user/account that initiated login;
- target site;
- policy creation and edits;
- session revocation;
- headless URLs visited;
- actions allowed or blocked;
- downloads/uploads/form submissions if allowed;
- policy rule responsible for each block.

Logs should avoid storing sensitive full page contents by default.

## User Approval Flow

When a headless command is blocked, GateLens should support:

- deny and return the reason;
- request one-time user approval;
- request a policy update;
- ask the user to rerun `login` or review the site in headed mode.

One-time approvals should be logged and expire.

## Data Retention

GateLens should define defaults for:

- session expiration;
- profile cleanup;
- policy expiration or review interval;
- audit log retention;
- per-site revocation;
- revoke-all behavior.

## Testing Requirements

The test suite should include:

- same-site navigation allowed;
- cross-site navigation blocked;
- JavaScript redirect blocked;
- server redirect blocked;
- popup/new tab blocked unless allowed;
- iframe navigation behavior;
- OAuth/SSO allowed only through configured auth domains;
- local storage reset before login;
- cookie/session isolation from the agent;
- service worker reset;
- download blocked by default;
- upload blocked by default;
- form submit blocked unless allowed;
- destructive selector detection;
- prompt injection fixture page;
- policy changes taking effect immediately;
- broker crash without profile leakage.

## Open Questions

- What exact `agent-browser` commands should be exposed in the first version?
- Which sites deserve built-in templates first?
- Should the first implementation use a broker daemon, subprocess wrapper, or both?
- What OS-level isolation should be required on macOS, Linux, and remote hosts?
- Should screenshots be allowed by default for permitted pages, or require explicit policy?
- How should generated policies be reviewed before first headless use?
