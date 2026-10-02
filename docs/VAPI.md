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
| `POST /vapi/events` | `X-Vapi-Secret: <VAPI_WEBHOOK_SECRET>` | `status-update` creates the conversation; `speech-update` feeds silence detection; `end-of-call-report` sets `ended_at`, `end_reason`, the final status (`escalated` stays, otherwise per the table below) and Vapi's summary. The first recorded `end_reason` wins. Disabled when the secret is unset (silence detection then has no speech events) |
| `GET /health` | none | liveness |

Behavior:

- **Conversation id**: `metadata.conversation_id` (app-supplied, for the web UI) first, then Vapi's `call.id` as
  `vapi_<id>`, then an `X-Conversation-Id` header. Only `[A-Za-z0-9_.:-]` up to 64 characters is accepted. Confirmed
  against real Vapi traffic: requests contain `call.id`, `messages`, `stream: true`, and no app metadata by default.
- **Streaming**: SSE chunks in OpenAI format, ending with `[DONE]`; non-streaming JSON also works.
- **Slow replies**: if a turn takes longer than `ACK_AFTER_MS` (2.5 seconds) the caller hears a short acknowledgement
  that fits what the turn is doing ("I'll check that transaction for you.", "Let me check the payout status.", ...),
  rotating so it does not repeat back to back; "One moment while I check that." remains the fallback when the turn cannot
  be classified (`docs/PERFORMANCE.md`). It is transport only and is not stored as the answer. Turns take roughly 3 to 15
  seconds (the Agent SDK starts a subprocess per turn), so expect pauses on tool lookups; `npm run report` breaks the time
  down. The optional `AGENT_PREWARM=1` starts that subprocess ahead of time.
- **Failures**: any error becomes a short spoken "I'm having trouble right now..." with HTTP 200 so the call never
  goes silent; technical details go to the server log only.
- **Ordering**: turns of one call run one at a time, so a caller interrupting cannot interleave two turns.
- `AGENT_DEBUG=1` logs which fields Vapi sends (never their content).

## Session lifecycle (Build Plan V2, Iteration 1)

The Session Controller (`services/agent/src/session/`) sits on the path above. It is deterministic: no model call
decides when a session ends. State is in-process; the deadline is re-read from `conversations.started_at`.

| What | Behavior | Recorded as |
|---|---|---|
| Silence | `SILENCE_TIMEOUT_SECONDS` (15) of quiet, then a visible `SILENCE_COUNTDOWN_SECONDS` (10) countdown, then the call ends (+1 s grace on the server). Quiet is measured from the end of the assistant's speech or the customer's; not while the assistant is speaking, a turn is being processed, or the escalation contact form is open. The customer speaking cancels it | `end_reason = silence-timeout`, `final_status = abandoned`, events `silence_warning`, `session_ended` |
| Time limit | `SESSION_MAX_SECONDS` (360). Warning event and (if live control is available) a spoken warning at `SESSION_WARNING_SECONDS` (30) before; hard end at the limit. Turns after the deadline get a fixed "session has ended" reply and never reach the model | `end_reason = session-timeout`, `final_status = abandoned`, events `session_warning`, `session_ended` |
| "That's all" | Clear closers ("that's all", "I'm done", "thank you, goodbye", "I don't need anything else") get a fixed goodbye and the call ends once the goodbye has been spoken. Bare thanks ("okay, thanks") gets "anything else?"; a following "no" ends it, anything else carries on. These turns are stored but cost no model call | `end_reason = user-ended`, `final_status = resolved` (abandoned if no turns) |
| Vapi's own end | `end-of-call-report` `endedReason` is mapped: `exceeded-max-duration` → `session-timeout`, `silence-timed-out` → `silence-timeout`, `customer-ended-call` → `user-ended`, `assistant-ended-call*` → `agent-ended`, errors → `error`. An unmapped reason leaves `end_reason` null | |

`final_status` stays the coarse outcome; `end_reason` says why. An escalated conversation stays `escalated`.

Three independent layers enforce the time limit: the controller's timer, refusal of turns past the deadline, and
Vapi's own `maxDurationSeconds`, which `vapi:setup` sets to `SESSION_MAX_SECONDS + 10`. `vapi:setup` also subscribes to
`speech-update` and sets Vapi's `silenceTimeoutSeconds` high (600) so Vapi's default does not cut calls before the controller.
The browser also hangs up 3 s after the limit as a last resort; it never decides anything durable.

### Ending a call from the server (verified 2026-10-02)

Vapi documents live control through `call.monitor.controlUrl` (`{"type":"end-call"}`, `{"type":"say","content":...,
"endCallAfterSpoken":true}`). The controller uses `monitor.controlUrl` when a webhook carries one, and otherwise falls back
to a REST `DELETE /call/{id}` with `VAPI_API_KEY`.

**It works on live web calls.** Three silence timeouts and one 360-second session timeout were each followed by Vapi ending
the call within seconds, after the `session_ended` row was written, with `endedReason: assistant-ended-call-after-message-spoken`.
The same hang-up is used for the **human handoff** (`docs/HANDOFF.md`): after an escalation for a signed-in customer the
controller waits for the confirmation to finish playing, marks the conversation `support_mode = human`, and ends the call.
The end-of-call report that follows does not close the conversation, because `endConversation` skips human conversations.
Which of the two routes did it is not recorded. If a hang-up ever fails, the session is still marked ended in the database,
further turns are refused, and Vapi's `maxDurationSeconds` or the browser ends the call.

**Check after every `vapi:setup`:** run it again with `--dry-run` and confirm the printed `serverMessages` includes
`speech-update`. On 2026-10-02 the live assistant had the session limits from setup but *not* `speech-update`; the agent
service could then not see anyone speaking, its silence timer ran from the start of the call, and every call was cut at about
26 seconds unless the customer's first request arrived sooner.

## Interruptions (barge-in)

Build Plan V2, Iteration 4. A customer can talk over the assistant. In the browser nothing special is needed
(`voiceReducer` accepts the customer speaking from any live state); whether the assistant actually *stops*, and what
counts as the customer speaking, is decided by Vapi from the assistant's configuration. Until now this repo set none of it,
so the live assistant used whatever the dashboard has. `npm run vapi:setup -- --url ... --dry-run` now prints the current
`stopSpeakingPlan`, `startSpeakingPlan` and `backgroundSpeechDenoisingPlan` (empty means Vapi's defaults) and the backup
file saves them.

### The knobs (all optional: unset means the assistant is left exactly as it is)

Set in `.env.local`, then run `vapi:setup`. Only the variables you set are changed; the rest of each plan is kept.

| Variable | Vapi field | Range (Vapi default) | Effect |
|---|---|---|---|
| `INTERRUPT_NUM_WORDS` | `stopSpeakingPlan.numWords` | 0 to 10 (0) | Words the customer must say before the assistant stops. 0 reacts at once. Words like "stop", "wait", "no", "actually" always interrupt; "okay", "yeah", "right", "mm-hmm" never do |
| `INTERRUPT_VOICE_SECONDS` | `stopSpeakingPlan.voiceSeconds` | 0 to 0.5 (0.2) | Voice activity needed before the assistant stops (used when `numWords` is 0). Lower is more responsive and more easily set off by noise |
| `INTERRUPT_BACKOFF_SECONDS` | `stopSpeakingPlan.backoffSeconds` | 0 to 10 (1) | How long the assistant waits before speaking again after being interrupted |
| `START_WAIT_SECONDS` | `startSpeakingPlan.waitSeconds` | 0 to 5 (0.4) | How long it waits after the customer stops before answering. Higher cuts in less often |
| `SMART_DENOISING` | `backgroundSpeechDenoisingPlan.smartDenoisingPlan.enabled` | 0 or 1 | Krisp background-noise removal on Vapi's side (keyboard, traffic, a TV, other voices). The experimental Fourier denoiser is not touched |

Vapi has **no speech-confidence threshold** for interruption; the nearest levers are `numWords`, `voiceSeconds` and the
acknowledgement/interruption phrase lists. The browser SDK already turns on Krisp noise cancellation on the customer's
microphone, and does not set echo cancellation (browser/Daily defaults apply; whether that matters is for the noise test).

Reasonable things to *try* (not applied): `INTERRUPT_NUM_WORDS=2` so a stray "mm" or a cough does not cut the assistant
off, `INTERRUPT_VOICE_SECONDS=0.3`, `SMART_DENOISING=1`. Change one thing at a time and compare.

### Noise test (plan section 33)

On a real call, at the current settings and again after a change, each time while the assistant is speaking a long answer
(for example "How do international payouts work?"):

1. Do nothing (control).
2. TV or a second voice in the background.
3. Type on a keyboard near the microphone.
4. Say "mm-hmm" or "okay".
5. Cough or clear your throat.
6. Say "wait, actually..." (a real interruption).

For each: did the assistant stop? Then `npm run report -- --since 1h`: the **Voice** section shows how often the customer
talked over the assistant, how many of those were under half a second (a rough noise indicator), and replies that never
arrived. Record the settings and the outcome. Treat "stopped for 2 to 5" as too sensitive and "did not stop for 6" as not
sensitive enough.

### What the server does when a customer interrupts mid-turn

Whether Vapi closes the `/chat/completions` request when the customer barges in is **not yet confirmed**. If it does:

- the turn is **not cancelled**: it finishes and is saved exactly as before (including any ticket or escalation);
- the reply cannot be delivered, so the turn's `timings` record `delivered: false` and `client_closed_ms` (visible in
  `npm run trace` as "reply not delivered"), the controller is told so silence detection starts again, and no
  acknowledgement is spoken, counted or rotated for someone who has gone;
- the next request still waits behind the unfinished turn (serialisation is unchanged).

Also: a goodbye after "that's all" no longer hangs up when the customer carries on with a real request ("wait, one more
thing"); a repeated closer still ends the call, and noise alone changes nothing. Each call writes one `voice_stats` event
(interruptions, short ones, replies not delivered, silence countdowns). Interruptions are counted when the customer starts
speaking while the controller still believes the assistant is speaking; if Vapi sends "assistant stopped" before "customer
started", real interruptions would be missed, so a genuine interruption test that reports zero means this ordering needs
looking at. Durations come from webhook arrival times, so short-interruption counts are approximate.

### Known gaps and deferred

- The agent still "remembers" an answer the customer talked over: the full reply is saved and reloaded as history. Telling
  the agent that a reply was not heard changes what it sees, so it waits for live evidence from the report above.
- Cancelling an abandoned turn (never one that is creating a ticket or escalation) so the next request is not stuck behind
  it: same reason.
- Subscribing to Vapi's `user-interrupted` message (availability as a server message unconfirmed), and overriding echo
  cancellation on the Daily input (needs proof it does not switch off Krisp).

## Pointing your assistant at it

`scripts/vapi/setup.ts` **modifies the assistant in `VAPI_ASSISTANT_ID`**; it never creates one. It changes only the
model (custom LLM at your URL), the webhook (`server`, `serverMessages`), the session-limit backstops
(`maxDurationSeconds`, `silenceTimeoutSeconds`), any interruption and noise settings you set (see above) and attaches a credential; voice, transcriber,
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
