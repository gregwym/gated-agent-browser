# gated-agent-browser

gated-agent-browser is a policy-gated wrapper around `agent-browser`.

The goal is to let an agent use authenticated browser sessions without giving it direct access to a human's full browser profile, cookies, or unconstrained navigation surface. The CLI should stay close to the `agent-browser` command interface, but only expose commands that can be safely mediated.

## Core Idea

gated-agent-browser splits browser use into two modes:

- `login <url>`: a human-only headed browser flow for creating an authenticated session for one site.
- headless browser commands: agent-facing commands that can only operate within the policy configured during login.

The wrapper should enforce policy at the command/action layer and at browser navigation boundaries. It should behave like a narrow broker, not a thin convenience alias.

## Current Status

This repository currently contains:

- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/ROADMAP.md)
- [Autonomous development instructions](AGENTS.md)
- A TypeScript CLI and broker contract for policy-gated browsing
- Restricted local storage for policies, sessions, logs, approvals, and profiles
- Opaque session metadata and policy draft creation through `login <url>`
- Policy list/show/edit, site revoke, setup, and teardown commands
- Batch browse validation with all-or-nothing rejection
- Fake and fixture browser adapters for deterministic enforcement tests
- JSONL audit logging for broker, login, policy, and revoke events

Current security boundary:

- The broker is still TypeScript and local-process based.
- Profile directories are created with strict local permissions and are not
  printed in normal CLI output.
- There is no separate OS user or launchd-owned broker yet.
- Real browser execution is behind the pinned `agent-browser@0.27.0` subprocess
  adapter, but most enforcement is currently verified through deterministic
  fake/fixture adapters.

## Development

Requirements:

- Node.js 24+
- npm
- `agent-browser@0.27.0` is pinned as an npm dependency for subprocess adapter
  development. Real browser execution also needs `agent-browser install`.

Install dependencies:

```sh
npm install
```

Run tests:

```sh
npm test
```

Run full verification:

```sh
npm run verify
```

Current verification covers policy decisions, batch pre-validation, session
metadata, login draft flow, revoke, audit logs, setup/teardown, runtime URL
escape fixtures, file transfer/form denial, selector enforcement, and
prompt-injection fixtures.

Try the current policy checker:

```sh
npm run build
node dist/cli.js policy-check \
  --policy examples/github.policy.yaml \
  --action navigate \
  --url https://github.com/gregwym/gated-agent-browser/issues
```

Initialize local storage:

```sh
GATED_AGENT_BROWSER_HOME=/tmp/gated-agent-browser-dev node dist/cli.js init
```

The `init` command creates broker-owned storage directories with restrictive
permissions and does not print profile or session directory paths.

Set up local storage and report lightweight prerequisites:

```sh
GATED_AGENT_BROWSER_HOME=/tmp/gated-agent-browser-dev node dist/cli.js setup
```

Inspect policies:

```sh
node dist/cli.js policy list
node dist/cli.js policy show github.com
EDITOR=vim node dist/cli.js policy edit github.com
```

Create a login draft and opaque session:

```sh
GATED_AGENT_BROWSER_HOME=/tmp/gated-agent-browser-dev \
  node dist/cli.js login https://github.com/login
```

Revoke a site:

```sh
GATED_AGENT_BROWSER_HOME=/tmp/gated-agent-browser-dev \
  node dist/cli.js revoke github.com
```

Plan teardown without deleting data:

```sh
GATED_AGENT_BROWSER_HOME=/tmp/gated-agent-browser-dev \
  node dist/cli.js teardown --sessions --profiles
```

Actually remove selected local data requires both category flags and `--confirm`:

```sh
GATED_AGENT_BROWSER_HOME=/tmp/gated-agent-browser-dev \
  node dist/cli.js teardown --sessions --logs --confirm
```
