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
- `docs/` - `TDD.md`, `UI-SPEC.md`, `BUILD-PLAN.md`
- `assets/` - course assets (KB, rules, seed CSVs, brand)

## Getting started

Requires Node 20+.

```bash
npm install
cp .env.example .env   # fill in values (Phase 2)
npm run dev            # http://localhost:3000
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run format`.
