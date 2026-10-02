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
| `AGENT_INTERNAL_URL` | web server | no | Where the web server reaches the agent for readiness checks. Default `http://<AGENT_HOST>:<AGENT_PORT>`. The web server also reads `AGENT_API_TOKEN` for this |
| `AGENT_REQUIRE_LINK`, `LINK_GRACE_SECONDS` | agent | no | Signed-in callers only: a call not linked to a customer within `LINK_GRACE_SECONDS` (default 10, 1 to 120) is ended. `AGENT_REQUIRE_LINK` `1`/`0` overrides; blank = on only when `NODE_ENV=production` |
| `AGENT_MODEL` | agent | no | Optional; default `claude-sonnet-5-5` |
| `SESSION_MAX_SECONDS` | agent, web server | no | Absolute AI voice session limit. Default 360 (min 10) |
| `SESSION_WARNING_SECONDS` | agent, web server | no | "Ending soon" warning window before the limit. Default 30 |
| `SILENCE_TIMEOUT_SECONDS` | agent, web server | no | Quiet time before the countdown shows. Default 15 |
| `SILENCE_COUNTDOWN_SECONDS` | agent, web server | no | Visible countdown length; the call ends when it runs out. Default 10 |
| `HUMAN_HANDOFF` | agent | no | `1` moves a signed-in customer to a text chat with staff after an escalation (the call is hung up; `docs/HANDOFF.md`). **Default off** |
| `MAX_AGENT_CALLS`, `MAX_TOOL_CALLS`, `MAX_RETRIEVALS` | agent | no | Per-conversation budgets (defaults 30, 50, 30). 0 turns one off. See `docs/ABUSE.md` |
| `MAX_CONCURRENT_SESSIONS` | agent, web server | no | Active AI voice sessions per signed-in customer (default 1; 0 = off) |
| `SESSION_RATE_MAX`, `SESSION_RATE_WINDOW_SECONDS` | agent, web server | no | New conversations per signed-in customer per window (defaults 8 per 3600 s; 0 = off). Enforced only when `NODE_ENV=production` |
| `GLOBAL_SESSION_RATE_MAX`, `GLOBAL_SESSION_RATE_WINDOW_SECONDS` | agent | no | New conversations by anyone per window, a circuit breaker (defaults 60 per 600 s; 0 = off). Enforced only when `NODE_ENV=production` |
| `ACK_AFTER_MS` | agent | no | Milliseconds before a slow reply gets a spoken acknowledgement. Default 2500 (200 to 30000) |
| `AGENT_PREWARM` | agent | no | `1` keeps an agent process started per live call. **Default off**; compare first (`docs/PERFORMANCE.md`) |
| `PREWARM_MAX`, `PREWARM_TTL_SECONDS` | agent | no | Most warm processes at once (default 8) and how long an unused one lives (default 90) |
| `INTERRUPT_NUM_WORDS`, `INTERRUPT_VOICE_SECONDS`, `INTERRUPT_BACKOFF_SECONDS`, `START_WAIT_SECONDS` | vapi:setup | no | Optional interruption tuning (0 to 10, 0 to 0.5, 0 to 10, 0 to 5). Blank leaves the assistant as configured. See `docs/VAPI.md` |
| `SMART_DENOISING` | vapi:setup | no | `1` or `0`: Vapi's Krisp background-noise removal. Blank leaves it as configured |
| `VAPI_API_KEY` (agent) | agent | yes | Optional; lets the agent service hang up a live call. Same key as above |
| `ANTHROPIC_API_KEY` | web server, agent | yes | |
| `SUPABASE_URL` | web server, agent, mcp | no | URL |
| `SUPABASE_SERVICE_ROLE_KEY` | web server, agent, mcp | yes | Bypasses RLS; never in the browser |
| `SESSION_SECRET` | web server | yes | 32+ characters. Signs the sign-in cookie. No default: without it nobody can sign in. See `docs/AUTH.md` |
| `MCP_SERVER_URL` | web server, agent | no | URL |
| `MCP_PORT`, `MCP_HOST` | mcp | no | Optional; default 4000 and 127.0.0.1 |
| `MCP_SERVER_AUTH_TOKEN` | web server, agent, mcp | yes | Shared bearer token |
| `MCP_REQUIRE_IDENTITY` | mcp | no | `1`/`0`: account tools refuse a conversation not linked to a signed-in customer. Blank = on only when `NODE_ENV=production` |

Validation: `apps/web/lib/env.ts` (public and server schemas), `apps/web/lib/env.server.ts`
(`server-only`, lazy so builds work without secrets), `services/*/src/env.ts` (validated at process start).

## Database tooling only

Read by `scripts/db/*` (`npm run db:*`), not by the app or services.

| Variable | Secret | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | yes | Postgres connection string (Project Settings > Database); used by `db:migrate` and `db:seed` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Optional; lets `db:verify` check the anon key cannot read tables |
| `DEMO_USER_PASSWORD` | yes | 10+ characters; the shared password of the demo accounts created by `db:seed-users`. Stored only as a salted hash |

## Web preview

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_VOICE_MOCK` | `1` plays a scripted conversation instead of a real call (previews and demos) |
| `ENABLE_DEV_STATES` | `1` serves `/dev/states` and `/dev/voice-lab` in production (development only by default) |
| `NEXT_DIST_DIR` | Build directory for the web app (default `.next`); lets a second copy run beside a dev server |

Next reads `.env.local` once at startup: restart `npm run dev` after changing it.
