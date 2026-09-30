# Environment configuration

Development values live in a git-ignored `.env.local` at the repo root (copy `.env.example`).
Production values are set only in the host's environment settings. Use separate credentials for each.
Missing or invalid variables are reported by name only, never by value.

| Variable | Used by | Secret | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | web | no | Full URL of the app |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | web (browser) | no | Vapi public key only |
| `VAPI_API_KEY` | web server | yes | |
| `VAPI_ASSISTANT_ID` | web server | no | |
| `ANTHROPIC_API_KEY` | web server, agent | yes | |
| `SUPABASE_URL` | web server, mcp | no | URL |
| `SUPABASE_SERVICE_ROLE_KEY` | web server, mcp | yes | Bypasses RLS; never in the browser |
| `MCP_SERVER_URL` | web server, agent | no | URL |
| `MCP_SERVER_AUTH_TOKEN` | web server, agent, mcp | yes | Shared bearer token |

Validation: `apps/web/lib/env.ts` (public and server schemas), `apps/web/lib/env.server.ts`
(`server-only`, lazy so builds work without secrets), `services/*/src/env.ts` (validated at process start).

## Database tooling only

Read by `scripts/db/*` (`npm run db:*`), not by the app or services.

| Variable | Secret | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | yes | Postgres connection string (Project Settings > Database); used by `db:migrate` and `db:seed` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Optional; lets `db:verify` check the anon key cannot read tables |
