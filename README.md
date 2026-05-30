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
- A first TypeScript scaffold for policy loading and policy decisions

## Development

Requirements:

- Node.js 24+
- npm

Install dependencies:

```sh
npm install
```

Run tests:

```sh
npm test
```

Try the current policy checker:

```sh
npm run build
node dist/cli.js policy-check \
  --policy examples/github.policy.yaml \
  --action navigate \
  --url https://github.com/gregwym/gated-agent-browser/issues
```
