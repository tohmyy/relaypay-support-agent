# Voice UI

`apps/web` is a single-screen support console, not a chatbot: one primary action ("Start conversation"), a clear
voice state, a lightweight transcript, and an escalation panel when a person is needed. It follows `docs/UI-SPEC.md`
and `assets/brand-direction.md`.

## Run

```bash
npm run dev                     # http://localhost:3000 (restart it after changing .env.local)
```

- **Preview without a microphone**: open `http://localhost:3000/?mock=1` on the dev server. A scripted conversation
  plays (connecting, listening, speaking, answer). Production servers ignore the parameter unless
  `NEXT_PUBLIC_VOICE_MOCK=1` is set.
- **State gallery**: `http://localhost:3000/dev/states` shows every state side by side for visual review
  (development only; returns 404 in production unless `ENABLE_DEV_STATES=1`).
- **Real voice (Scenario 9)**: needs the whole chain running. See `docs/VAPI.md`: `npm run mcp:dev`,
  `npm run agent:dev`, `npm run tunnel`, `npm run vapi:setup -- --url <tunnel url>`, then use the page. Needs
  `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and `VAPI_ASSISTANT_ID` in `.env.local`. Without them the page loads and says voice
  support is not available.

## How it fits together

```
SupportPage (client)  --useVoiceSession-->  VoiceClient (Vapi web SDK, loaded only when a call starts)
      |                                         events: call start/end, speech, volume, transcript, errors
      |  polls every 3 s and after each assistant turn
      v
GET /api/conversations/<id>/state   (server only, service role)  ->  { answerType, ticketReference, escalation, ended }
```

- **Voice state** (`lib/voice/state.ts`) is one reducer: idle, connecting, listening, user-speaking, processing,
  assistant-speaking, ending, ended, error. **Support state** (`lib/support/derive.ts`) is derived separately from what
  the backend recorded: normal, clarifying, ticket-created, escalation-required, escalating, escalated, completed.
  Components only render the state they are given.
- **Conversation id** is `vapi_<call id>`, which is what the agent server derives from Vapi's requests. This replaces
  the build plan's app-generated `conv_` id because everything in the backend already keys on the call id.
- **The browser never reads Supabase.** The state route returns only four customer-safe fields (never names, emails,
  transcripts, notes or internal ids), the same neutral answer for unknown ids, and `Cache-Control: no-store`.
- **Escalation form.** Name and email are required, callback time is optional. Submitting types the details into the
  live call as a message, so the agent runs its normal escalation (right category, ticket, record, event log) and the
  typed email avoids speech-recognition mistakes. The panel shows progress, then the confirmation with the *requested*
  callback time (never "scheduled"). The form is hidden once the call has ended. The escalation record is tied to the
  call through `escalations.conversation_id`, set by the MCP server from the request's `X-Conversation-Id`.
- **Customer language.** Every customer-visible string lives in `lib/copy.ts`; a test fails if any contains MCP, RAG,
  retrieval, embedding, tool call, Claude, Supabase, SDK, Vapi, agent or raw status values.

## Where the spec was ambiguous (decisions)

| Topic | Decision |
|---|---|
| Desktop layout (single stack vs two columns) | Two columns on large screens (voice left, conversation right), one column below |
| Header label | "Customer Support", and "Support" on small screens |
| Completion screen | "Support session complete" when a ticket or escalation exists, otherwise "Conversation ended" |
| Landing copy | The section-46 wording ("...payments, payouts, invoices, fees, or account support.") |
| "Retry" vs "Try again" | "Try again" (and "Check microphone access" for microphone errors) |
| Listening vs user-speaking | Same visible text; the visualizer and a non-announcing label tell them apart, and the live region says "Listening" for both so speech does not chatter |
| Partial transcript | Partial text updates in place, then finalizes; no flicker, no typing indicator |
| Timestamps | Omitted ("if useful" in the spec) |
| Transcript after the call | Kept next to the completion screen |
| Mute control, phone number, rating | Not built (not in the spec / optional) |
| Colors | Primary `#0c3380` and accent `#0a7fa8` sampled from the logo; **provisional** until the approved brand values are available |

## Accessibility

Semantic landmarks and headings, visible focus ring, labelled form fields with inline errors, `role="alert"` for
errors, a polite status region ("Voice status: ..."), a keyboard-focusable labelled transcript that stops auto-scrolling
when the customer scrolls up, color never the only signal, icons always paired with text, and reduced motion
(`prefers-reduced-motion`) removes animation while the status text keeps the meaning. Focus is not taken during a call;
it moves to the confirmation only after the form is submitted. A full accessibility audit is Phase 15.

## Tests

- `tests/web/logic.test.ts`: voice reducer, support-state derivation, transcript merge, public-state mapping, contact
  validation, copy rules, error classification.
- `tests/web/components.test.tsx`: component behavior and copy (jsdom).
- `tests/web/session.test.tsx`: the session hook driven by a scripted client (full call, errors, escalation flow).
- `tests/web/route.test.ts` and `tests/web/state-route.live.test.ts`: the state route with a fake and with the real
  database.

## Known limits

- The live microphone path (real Vapi call from the browser) has not been exercised in automation; it needs a person.
- Agent replies take roughly 3 to 15 seconds, so "Thinking..." can be visible for a while.
- In development the page loads the voice SDK chunk with the page; the SDK only connects when a call starts. Bundle
  loading is reviewed in the testing phases.
- Run `npm run dev` from a fresh start after changing `.env.local` or `next.config.ts`; Next reads them at startup.
