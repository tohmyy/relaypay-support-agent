# Environment configuration

Development values live in a git-ignored `.env.local` at the repo root (copy `.env.example`).
Production values are set only in the host's environment settings. Use separate credentials for each.
Missing or invalid variables are reported by name only, never by value.

| Variable | Used by | Secret | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | web | no | Optional; full URL of the app |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | web (browser) | no | Vapi public key only |
| `VAPI_API_KEY` | web server | yes | |
| `VAPI_ASSISTANT_ID` | web server | no | |
| `AGENT_API_TOKEN` | agent server, vapi:setup | yes | Bearer token Vapi sends to `/chat/completions` (min 16 chars) |
| `VAPI_WEBHOOK_SECRET` | agent server, vapi:setup | yes | Sent by Vapi as `X-Vapi-Secret` to `/vapi/events`; blank disables the route |
| `AGENT_PORT`, `AGENT_HOST` | agent server | no | Default 4100 and 127.0.0.1 |
| `AGENT_PUBLIC_URL` | vapi:setup | no | Public base URL (tunnel or host) Vapi should call |
| `AGENT_MODEL` | agent | no | Optional; default `claude-sonnet-5-5` |
| `ANTHROPIC_API_KEY` | web server, agent | yes | |
| `SUPABASE_URL` | web server, agent, mcp | no | URL |
| `SUPABASE_SERVICE_ROLE_KEY` | web server, agent, mcp | yes | Bypasses RLS; never in the browser |
| `MCP_SERVER_URL` | web server, agent | no | URL |
| `MCP_PORT`, `MCP_HOST` | mcp | no | Optional; default 4000 and 127.0.0.1 |
| `MCP_SERVER_AUTH_TOKEN` | web server, agent, mcp | yes | Shared bearer token |

Validation: `apps/web/lib/env.ts` (public and server schemas), `apps/web/lib/env.server.ts`
(`server-only`, lazy so builds work without secrets), `services/*/src/env.ts` (validated at process start).

## Database tooling only

Read by `scripts/db/*` (`npm run db:*`), not by the app or services.

| Variable | Secret | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | yes | Postgres connection string (Project Settings > Database); used by `db:migrate` and `db:seed` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Optional; lets `db:verify` check the anon key cannot read tables |

## Web preview

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_VOICE_MOCK` | `1` plays a scripted conversation instead of a real call (previews and demos) |
| `ENABLE_DEV_STATES` | `1` serves `/dev/states` in production (development only by default) |
| `NEXT_DIST_DIR` | Build directory for the web app (default `.next`); lets a second copy run beside a dev server |

Next reads `.env.local` once at startup: restart `npm run dev` after changing it.
