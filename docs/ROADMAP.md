# gated-agent-browser Roadmap

## Current Milestone

M1 — Policy-gated CLI MVP

## M1 — Policy-gated CLI MVP

Goal: an autonomous agent can use a narrow CLI surface that loads site policies,
allows safe browsing actions, and returns structured block reasons before any
real authenticated browser profile is exposed.

Initial issues:

1. Define broker request/response types and audit events.
2. Add filesystem layout and strict permission checks.
3. Implement policy list/show/edit commands.
4. Add `browse batch --json` validation with all-or-nothing rejection.
5. Add a fake browser adapter and fixture-style integration tests.
6. Add the `agent-browser` subprocess adapter behind the broker interface.

Exit criteria:

- `npm run verify` passes locally and in CI.
- Policy actions and URL checks are covered by tests.
- Blocked commands return structured reasons.
- No CLI output reveals profile paths, cookies, storage, or browser internals.

## M2 — Login And Brokered Sessions

Goal: a human can perform a headed login while the agent receives only an opaque
session id and policy-bounded headless access.

Expected scope:

- Headed `login <url>` flow.
- Broker-owned profile directories.
- Site data reset before login.
- Session metadata and revocation.
- Audit logging for login, policy changes, and blocked actions.

## M3 — Runtime Enforcement Fixtures

Goal: fixture tests prove that redirects, popups, iframes, downloads, uploads,
and destructive selectors are blocked or mediated by policy.

Expected scope:

- Local fixture server.
- Redirect and popup tests.
- Selector-scoped screenshot behavior.
- Download/upload denial tests.
- Prompt-injection fixture page.

