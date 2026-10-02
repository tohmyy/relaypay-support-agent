# RelayPay Voice Support Agent

Voice-first customer support agent for RelayPay: Next.js UI, Vapi voice layer, Claude Agent SDK agent,
custom MCP server and Supabase data. See `PRD.md` for the brief and `docs/` for the design.

## Structure

- `apps/web` - Next.js voice support console
- `services/agent` - Claude Agent SDK orchestration, prompts, retrieval
- `services/mcp` - MCP server exposing the six support tools
- `knowledge/` - approved knowledge base content
- `supabase/` - migrations and seed data
- `tests/` - agent, MCP, retrieval and evaluation tests
- `docs/` - `ONE-PAGER.md` (short overview), `TDD.md`, `UI-SPEC.md`, `BUILD-PLAN.md`
- `assets/` - course assets (KB, rules, seed CSVs, brand)

## Getting started

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # fill in values; see docs/ENVIRONMENT.md
npm run dev            # http://localhost:3000
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run format`.

## Database

`npm run db:migrate`, `npm run db:seed`, `npm run db:verify`. See `docs/DATABASE.md`.

## Knowledge base

`npm run kb:split`, `npm run kb:ingest`. See `docs/KNOWLEDGE-BASE.md`.

## MCP server

`npm run mcp:dev`, `npm run mcp:smoke`. See `docs/MCP.md`.

## Agent

`npm run agent:chat` (text harness). See `docs/AGENT.md`.

## Workflows

`docs/WORKFLOWS.md` maps support workflows A-H to the official test scenarios.

## Voice (Vapi)

`npm run agent:dev`, `npm run tunnel`, `npm run vapi:setup`. See `docs/VAPI.md`.

## Voice UI

`npm run dev`, then open `/`: it sends you to sign-in (`npm run db:seed-users` creates the demo accounts), and a customer calls from
`/support` (or `/support?mock=1` for a preview without a microphone). See `docs/UI.md`, `docs/AUTH.md` and `docs/HANDOFF.md`.

## Observability

`npm run trace -- <conversation_id>` and `npm run report`. See `docs/OBSERVABILITY.md`.
