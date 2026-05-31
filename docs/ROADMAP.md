# gated-agent-browser Roadmap

## Current Milestone

M4 — Setup Teardown And Release Hygiene

## M1 — Policy-gated CLI MVP

Status: complete. Implemented through issues #1-#7 and #8-#13.

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

Status: complete for the local TypeScript broker contract. Implemented through
issues #14-#17.

Goal: a human can perform a login flow while the agent receives only an opaque
session id and policy-bounded headless access.

Expected scope:

- Headed `login <url>` flow.
- Broker-owned profile directories.
- Site data reset before login.
- Session metadata and revocation.
- Audit logging for login, policy changes, and blocked actions.

## M3 — Runtime Enforcement Fixtures

Status: complete for deterministic local fixture coverage. Implemented through
issues #22-#26.

Goal: fixture tests prove that redirects, popups, iframes, downloads, uploads,
and destructive selectors are blocked or mediated by policy.

Expected scope:

- Local fixture server.
- Redirect and popup tests.
- Selector-scoped screenshot behavior.
- Download/upload denial tests.
- Prompt-injection fixture page.

## M4 — Setup Teardown And Release Hygiene

Status: in progress.

Goal: setup and teardown commands are explicit, redacted, and safe by default,
and the docs match the implemented security boundary.

Expected scope:

- `setup` command for storage initialization and lightweight prerequisite
  reporting.
- `teardown` command with non-destructive default planning and explicit category
  flags for removal.
- README and roadmap alignment with shipped behavior.

Exit criteria:

- `npm run verify` passes locally and in CI.
- Setup and teardown output does not reveal broker-owned paths.
- Teardown does not remove data unless `--confirm` and category flags are both
  present.
- Docs clearly state current limits: TypeScript broker, strict directories, no
  OS user or launchd isolation yet.

## Later Milestones

Planned but not yet claimed as implemented:

- Real headed browser login wiring for manual low-risk account tests.
- OS-specific installer/uninstaller for launchd or separate-user isolation.
- One-time approval flow with expiry.
- Remote headed login pairing.
- Audit retention/rotation.
