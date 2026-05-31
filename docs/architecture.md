# gated-agent-browser Architecture

## Decision Summary

The first version should be a local brokered wrapper around `agent-browser`, not a
direct shell alias.

The agent-facing CLI will accept a deliberately small command subset, translate
it into structured requests, and send those requests to a broker that owns the
browser profile, policy evaluation, and `agent-browser` execution. The agent will
receive page snapshots, allowed text, allowed screenshots, and structured block
reasons, but it will not receive raw cookies, profile paths, CDP endpoints, saved
auth state, HAR files, clipboard contents, or unconstrained browser control.

The implementation should use a two-layer model:

- TypeScript CLI and policy layer first, for fast iteration on command parsing,
  policy schema, tests, and fixture coverage.
- A later Rust broker for the privileged runtime boundary once the request
  protocol and enforcement semantics are stable.

## Evidence

Verified facts:

- `agent-browser` is a Rust-native browser automation CLI with a persistent
  client-daemon architecture.
  Source: https://github.com/vercel-labs/agent-browser
- The current npm package version checked on 2026-05-30 is `0.27.0`, with the
  `agent-browser` binary exposed through `bin/agent-browser.js`.
  Source: `npm view agent-browser version dist-tags bin --json`
- `agent-browser` exposes broad browser control, including navigation,
  screenshots, JavaScript evaluation, CDP connection discovery, cookies,
  storage, network capture, tabs/windows, file upload, HAR, saved state,
  clipboard, dashboard, and AI chat commands.
  Source: https://agent-browser.dev/commands
- The upstream README documents persistent profiles that store cookies,
  localStorage, IndexedDB, service workers, cache, and login sessions.
  Source: https://github.com/vercel-labs/agent-browser

Inferences:

- A thin wrapper that only validates the initial command is insufficient because
  `agent-browser` can change browser state through redirects, JavaScript, tabs,
  frames, downloads, storage, and network tooling after the first command.
- Any command that reveals browser internals, auth state, local files, raw
  storage, CDP endpoints, or full network captures must be denied by default.
- The safest initial integration is to treat upstream `agent-browser` as a
  subprocess implementation detail hidden behind a local broker API.

Current local status:

- This repo currently has requirements, this architecture document, and a small
  TypeScript scaffold for policy loading, policy decisions, and a `policy-check`
  CLI.
- `agent-browser` is not installed on this machine, so design claims about exact
  runtime behavior should be re-verified after the implementation pins and
  installs a specific version.

## Goals

- Preserve a familiar CLI shape for routine agent browsing tasks.
- Make policy enforcement the default path for every browser action.
- Keep authenticated browser state outside the agent-readable filesystem.
- Make blocked actions explainable and auditable.
- Keep the first implementation small enough to test against local fixture sites.

## Non-Goals

- Do not expose the full `agent-browser` command surface.
- Do not implement a general remote desktop or dashboard for agents.
- Do not expose raw cookies, storage, auth state, HAR, CDP URLs, or browser
  profile directories.
- Do not rely on prompts, model instructions, or page text filtering as the
  security boundary.
- Do not support arbitrary JavaScript evaluation in the first version.

## Architecture

```text
agent process
    |
    | gated-agent-browser CLI
    | - parses safe command subset
    | - resolves site/session
    | - never receives profile paths or cookies
    v
local broker
    | - owns policies, sessions, profile directories, logs
    | - runs pre-action policy checks
    | - invokes agent-browser subprocesses
    | - runs post-action URL/origin checks
    | - redacts or blocks unsafe outputs
    v
agent-browser daemon / Chromium
    |
    v
authenticated site
```

The broker can start as a supervised local subprocess rather than a long-lived
daemon, as long as it remains the only component that knows profile paths and
session metadata. A daemon can be added later for performance and approval flows.

## Data Layout

Default root:

```text
~/.local/share/gated-agent-browser/
  profiles/
    <site-id>/
  policies/
    <site-id>.yaml
  sessions/
    <session-id>.json
  approvals/
    <approval-id>.json
  logs/
    audit.jsonl
```

The first implementation should support an override such as
`GATED_AGENT_BROWSER_HOME` for tests and development.

Profile directories must not be printed in normal CLI output. On systems that
support it, profile ownership or permissions should prevent the agent user from
reading them directly.

## Policy Schema

Initial policy fields:

```yaml
version: 1
site: github.com
canonicalOrigin: https://github.com
origins:
  allow:
    - https://github.com/gregwym/gated-agent-browser/**
  auth:
    - https://github.com/login/**
  deny: []
actions:
  navigate: allow
  click: allow
  fill: requireExplicitAllow
  type: requireExplicitAllow
  press: allow
  readText: allow
  snapshot: allow
  screenshotSelector: requireExplicitAllow
  screenshotFullPage: deny
  submitForm: requireExplicitAllow
  download: deny
  upload: deny
  evaluateScript: deny
  cookies: deny
  storage: deny
sensitiveSelectors: []
destructiveSelectors:
  - '[data-testid*="delete" i]'
  - 'button:has-text("Delete")'
ttl: 7d
createdAt: "2026-05-30T00:00:00Z"
updatedAt: "2026-05-30T00:00:00Z"
```

Policy URL matching should use parsed URLs and a glob matcher. It should not use
substring checks.

## MVP Command Surface

Agent-facing commands to support first:

- `browse open <url>`
- `browse snapshot [--interactive]`
- `browse get text [selector]`
- `browse get title`
- `browse get url`
- `browse click <selector-or-ref>`
- `browse fill <selector-or-ref> <text>`
- `browse press <key>`
- `browse wait <selector|ms|--url|--load>`
- `browse scroll <direction> [px]`
- `browse screenshot <selector>`
- `browse close`
- `browse batch --json`

Policy/admin commands to support first:

- `login <url>`
- `policy list`
- `policy show <site>`
- `policy edit <site>`
- `revoke <site>`

Commands denied in the first version:

- `eval`, `connect`, `get cdp-url`
- `cookies`, `storage`, `state`
- `network request`, `network har`
- `clipboard`
- `upload`, `download`, `pdf`
- `stream`, `dashboard`, `inspect`
- `chat`
- raw `mouse`, `keyboard`, `drag`, `window`, unrestricted `tab`
- `trace`, `profiler`, full console dump unless explicitly added later

Selector-scoped screenshots may be enabled per policy. Full-page screenshots
should remain denied in the first version because they can capture secrets
outside the intended selector/text surface.

`press` may be allowed by default on permitted pages. `fill` should require an
additional policy grant because it can disclose user-provided text into a page,
trigger autocomplete, or prepare a form submission.

## Request Flow

For each headless action:

1. CLI parses the requested command into a typed request.
2. CLI sends the request to the broker with the opaque session id or site id.
3. Broker loads the policy and session metadata.
4. Broker validates the requested action and target URL or selector.
5. Broker invokes `agent-browser` with the broker-owned profile.
6. Broker checks the resulting page URL, origin, tab list, and observable frame
   URLs where feasible.
7. Broker returns an allowed result or a structured block:

```json
{
  "ok": false,
  "blocked": {
    "rule": "origins.allow",
    "reason": "Navigation left allowed URL scope",
    "url": "https://example.net/"
  }
}
```

If a post-action check fails, the broker should close the offending tab or
session before returning the block.

## Broker Contract

The agent-facing CLI translates supported commands into typed broker requests.
The broker contract is intentionally narrower than the upstream `agent-browser`
command set:

```ts
type BrokerAction =
  | "navigate"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "readText"
  | "snapshot"
  | "getTitle"
  | "getUrl"
  | "wait"
  | "scroll"
  | "screenshotSelector"
  | "close";

interface BrokerRequest {
  requestId: string;
  siteId: string;
  sessionId?: string;
  action: BrokerAction;
  target:
    | { kind: "url"; url: string }
    | { kind: "selector"; selector: string }
    | { kind: "ref"; ref: string }
    | { kind: "key"; key: string }
    | { kind: "none" };
  value?: string;
  createdAt: string;
}
```

Allowed responses include the original request id, action, and a typed result.
Blocked responses include the original request id, action, site/session context,
and the responsible policy rule:

```json
{
  "ok": false,
  "requestId": "req_123",
  "action": "navigate",
  "siteId": "github.com",
  "sessionId": "sess_123",
  "blocked": {
    "rule": "origins.allow",
    "reason": "Navigation left allowed URL scope",
    "url": "https://example.net/"
  }
}
```

Every broker response should be convertible to an audit event with this stable
shape:

```json
{
  "type": "broker.request",
  "timestamp": "2026-05-30T00:00:01.000Z",
  "requestId": "req_123",
  "siteId": "github.com",
  "sessionId": "sess_123",
  "action": "navigate",
  "target": {
    "kind": "url",
    "url": "https://github.com/gregwym/gated-agent-browser/issues"
  },
  "outcome": "blocked",
  "policyRule": "origins.allow",
  "reason": "Navigation left allowed URL scope"
}
```

Audit targets should avoid storing sensitive values. For example, keypress audit
events record `{ "kind": "key" }` rather than the exact key value.

### Batch JSON

`browse batch --json` accepts a single JSON object with site/session context and
an ordered command list:

```json
{
  "siteId": "github.com",
  "sessionId": "sess_123",
  "commands": [
    {
      "action": "navigate",
      "target": {
        "kind": "url",
        "url": "https://github.com/gregwym/gated-agent-browser/issues"
      }
    },
    {
      "action": "readText",
      "target": {
        "kind": "selector",
        "selector": "main"
      }
    }
  ]
}
```

The broker must validate every command before execution. If any action or target
URL is denied, the entire batch is rejected and no command executes:

```json
{
  "ok": false,
  "blocked": {
    "rule": "actions.fill",
    "reason": "Action requires an explicit policy grant",
    "commandIndex": 1,
    "requestId": "batch_2",
    "action": "fill"
  }
}
```

## Browser Adapter Interface

Runtime browser integrations sit behind a narrow adapter:

```ts
interface BrowserAdapter {
  perform(request: BrokerRequest): Promise<{
    finalUrl?: string;
    result?: BrokerResult;
  }>;
}
```

The policy broker executor performs pre-action policy checks, calls the adapter
only for allowed requests, then validates the adapter-reported `finalUrl`.
Fixture tests use an in-memory fake adapter that simulates navigation and
redirects without network access or real browser binaries. The future
`agent-browser` subprocess adapter should implement the same interface.

## Login Flow

`login <url>` is human-facing:

1. Parse the initial URL and derive a proposed site id.
2. Clear existing local site data by default unless the user explicitly opts
   into reusing it.
3. Launch a headed browser with a broker-owned profile.
4. Restrict navigation to the initial origin plus configured auth origins.
5. Let the human authenticate.
6. Generate or update a policy draft from the observed final origin and user
   input.
7. Save the policy only after human confirmation.
8. Log the login start, completion, policy id, and profile id.

The login command must not open an already authenticated profile for casual
inspection. Re-authentication should be the default posture.

## Enforcement Boundaries

Pre-action checks:

- command allow/deny;
- URL allow/deny;
- selector sensitivity and destructive selector checks;
- upload/download/form permissions;
- batch command validation before execution.

Runtime checks:

- launch with a broker-owned profile;
- prefer no exposed debug ports;
- disable or hide upstream dashboard/streaming surfaces from agents;
- capture post-action URL and tab state after every action.

Post-action checks:

- current URL remains allowed;
- unexpected new tabs/windows are closed or blocked unless policy permits them;
- output is redacted or denied if it includes forbidden internals;
- audit event is written.

## macOS Isolation

Initial macOS implementation should use strict per-directory permissions for the
broker-owned profile and session directories, with the TypeScript CLI never
printing profile paths or browser internals.

This is the smallest useful boundary for local development. It is not as strong
as running the broker as a separate OS user, but it avoids making the first
installer depend on user creation, launchd service management, and uninstall
cleanup before the policy model is proven.

The three isolation levels differ like this:

- Strict per-directory permissions: easiest to ship; protects against accidental
  reads by normal tooling, but shares the same user account and is weaker against
  a malicious local process running as that user.
- launchd service ownership: broker lifecycle is managed by launchd and can own
  the profile directory more cleanly; better operational boundary, more installer
  complexity.
- Separate local user: strongest local OS boundary for profile files and broker
  execution; highest setup, permission, UI login, and teardown complexity.

The design should keep the broker API compatible with a later launchd or
separate-user runtime. In other words, the CLI must already treat the broker as
the only holder of profile paths, even while the first broker is still
implemented in TypeScript.

## Audit Events

Use JSON Lines:

```json
{
  "time": "2026-05-30T16:30:00Z",
  "actor": "agent",
  "site": "github.com",
  "session": "sess_...",
  "command": "browse.open",
  "decision": "blocked",
  "rule": "origins.allow",
  "target": "https://example.net/",
  "reason": "Navigation left allowed URL scope"
}
```

Do not log full page text, raw form values, cookies, storage, or screenshots by
default.

## Implementation Plan

1. Scaffold a small CLI package with typed command parsing, policy loading, and
   a test-only fake browser adapter.
2. Implement policy URL matching and action decisions with unit tests.
3. Implement broker request/response types and audit logging.
4. Add `agent-browser` subprocess adapter behind an interface.
5. Implement `login` as a headed flow after profile storage and policy writes
   are tested.
6. Add local fixture sites for redirects, popups, iframes, downloads, upload
   attempts, destructive buttons, and prompt-injection text.
7. Add install/uninstall after the storage layout and OS isolation choice are
   proven.

## Test Plan

Unit tests:

- policy URL matching for exact origins, registrable domains, subdomains, auth
  origins, and deny precedence;
- command allow/deny decisions;
- selector sensitivity and destructive selector matching;
- audit event generation without sensitive fields;
- batch validation rejects the whole batch before execution if any command is
  denied.

Integration tests with fixture server:

- same-site navigation allowed;
- cross-site link blocked;
- server redirect blocked;
- JavaScript redirect blocked by post-action check;
- popup/new tab blocked;
- iframe navigation observed and logged;
- download/upload denied;
- form submit denied unless policy explicitly allows it;
- full-page screenshot denied by default;
- selector-scoped screenshot allowed only with explicit policy;
- broker crash leaves no profile path in agent output.

Manual tests:

- `login` to a low-risk test account;
- policy edit and immediate enforcement;
- revoke clears the session and prevents reuse.

## Rollout

Start with local-only, single-user operation:

- no remote login;
- no daemon exposed on TCP;
- no dashboard;
- file-based policies and JSONL audit logs;
- conservative deny-by-default policy.

Only after the local broker passes the fixture suite should the project add
remote headed login, one-time approvals, built-in templates, and OS-specific
installers.

## Closed Decisions

- Implementation language: use a two-layer model. Start with TypeScript for the
  CLI, policy layer, fake browser adapter, and fixture tests; add a Rust broker
  after the broker protocol stabilizes.
- macOS isolation: start with strict per-directory permissions, while keeping
  the broker API compatible with later launchd service ownership or separate OS
  user isolation.
- Keyboard/input policy: allow `press` by default on permitted pages; require an
  additional explicit policy grant for `fill`.
- Screenshots: support selector-scoped screenshots before full-page screenshots.
  Full-page screenshots remain denied by default.

## Remaining Open Questions

- How much iframe visibility can be obtained through upstream `agent-browser`
  without depending on private internals?
