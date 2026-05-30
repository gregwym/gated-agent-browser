# gated-agent-browser

gated-agent-browser is a policy-gated wrapper around `agent-browser`.

The goal is to let an agent use authenticated browser sessions without giving it direct access to a human's full browser profile, cookies, or unconstrained navigation surface. The CLI should stay close to the `agent-browser` command interface, but only expose commands that can be safely mediated.

## Core Idea

gated-agent-browser splits browser use into two modes:

- `login <url>`: a human-only headed browser flow for creating an authenticated session for one site.
- headless browser commands: agent-facing commands that can only operate within the policy configured during login.

The wrapper should enforce policy at the command/action layer and at browser navigation boundaries. It should behave like a narrow broker, not a thin convenience alias.

## Current Status

This repository currently contains the initial requirements draft in [docs/requirements.md](docs/requirements.md).
