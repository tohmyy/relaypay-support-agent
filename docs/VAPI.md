# Vapi voice integration

Vapi handles the voice (speech to text, text to speech, call lifecycle). The RelayPay agent keeps all support logic.
Vapi reaches the agent through a **custom LLM** endpoint and reports call events to a webhook.

```
Caller -> Vapi (speech to text) -> POST /chat/completions -> agent (retrieval, MCP tools, guard) -> reply
       <- Vapi (text to speech) <-----------------------------------------------------------------
Vapi -> POST /vapi/events (call started, end-of-call report) -> conversation row updated
```

## The agent server

`npm run agent:dev` starts `services/agent/src/main.ts` on `127.0.0.1:4100` (`AGENT_PORT`, `AGENT_HOST`).

| Route | Auth | Purpose |
|---|---|---|
| `POST /chat/completions` (also `/v1/...`) | `Authorization: Bearer <AGENT_API_TOKEN>` | Vapi custom-LLM endpoint. OpenAI-style request; the last user message is the customer's utterance; Vapi's own system prompt is ignored |
| `POST /vapi/events` | `X-Vapi-Secret: <VAPI_WEBHOOK_SECRET>` | `status-update` creates the conversation; `end-of-call-report` sets `ended_at`, the final status (`escalated` stays, otherwise `resolved` if there were turns, else `abandoned`) and Vapi's summary. Disabled when the secret is unset |
| `GET /health` | none | liveness |

Behavior:

- **Conversation id**: `metadata.conversation_id` (app-supplied, for the web UI) first, then Vapi's `call.id` as
  `vapi_<id>`, then an `X-Conversation-Id` header. Only `[A-Za-z0-9_.:-]` up to 64 characters is accepted. Confirmed
  against real Vapi traffic: requests contain `call.id`, `messages`, `stream: true`, and no app metadata by default.
- **Streaming**: SSE chunks in OpenAI format, ending with `[DONE]`; non-streaming JSON also works.
- **Slow replies**: if a turn takes longer than 2.5 seconds the caller hears "One moment while I check that." first.
  The filler is transport only and is not stored as the answer. Turns take roughly 3 to 15 seconds (the Agent SDK
  starts a subprocess per turn), so expect pauses on tool lookups.
- **Failures**: any error becomes a short spoken "I'm having trouble right now..." with HTTP 200 so the call never
  goes silent; technical details go to the server log only.
- **Ordering**: turns of one call run one at a time, so a caller interrupting cannot interleave two turns.
- `AGENT_DEBUG=1` logs which fields Vapi sends (never their content).

## Pointing your assistant at it

`scripts/vapi/setup.ts` **modifies the assistant in `VAPI_ASSISTANT_ID`**; it never creates one. It changes only the
model (custom LLM at your URL), the webhook (`server`, `serverMessages`) and attaches a credential; voice, transcriber,
name and greeting stay as you configured them. Before patching it saves the previous model and webhook settings to
`vapi-assistant-backup-<id>.json` (git-ignored) so the change can be undone by hand.

The credential is named `relaypay-agent-<first 8 characters of the assistant id>` and holds `AGENT_API_TOKEN`. The name
is specific to your assistant on purpose: the Vapi organization may be shared, and a generic name could match someone
else's credential.

```bash
# .env.local needs: VAPI_API_KEY, VAPI_ASSISTANT_ID, AGENT_API_TOKEN (16+ chars), VAPI_WEBHOOK_SECRET (8+ chars)
npm run mcp:dev                         # terminal 1 (MCP server, port 4000)
npm run agent:dev                       # terminal 2 (agent server, port 4100)
npm run tunnel                          # terminal 3 (cloudflared; prints https://<random>.trycloudflare.com)
npm run vapi:setup -- --url https://<random>.trycloudflare.com --dry-run   # preview, changes nothing
npm run vapi:setup -- --url https://<random>.trycloudflare.com             # apply
```

A quick tunnel gets a new URL every run, so run `vapi:setup` again each time. Use a stable host (Phase 16) to avoid that.
While the tunnel runs, only the token-protected agent endpoints are reachable from the internet; the MCP server
stays on localhost.

## Testing

- Text check through Vapi itself (no microphone): `POST https://api.vapi.ai/chat` with `assistantId` and `input`
  runs the assistant's LLM, which calls this endpoint.
- Voice check (Scenario 9): with everything above running, open the assistant in the Vapi dashboard and use
  "Talk to assistant", or use the web UI from Phase 9. Then look at `conversation_turns`, `retrieval_logs`,
  `tool_calls` and `conversations` for the call (conversation id `vapi_<call id>`).
- Automated: `tests/agent/server.test.ts`, `tests/agent/vapi.test.ts` and `tests/agent/vapi-setup.test.ts` (offline);
  `tests/agent/vapi.live.test.ts` drives the real endpoint with real Vapi-shaped requests, including the webhook.

## Notes

- Restart `npm run mcp:dev` after pulling new code. An older MCP process still works but does not attach the
  conversation id to `tool_calls` rows.
- Phone numbers are optional in the PRD and not configured here.
