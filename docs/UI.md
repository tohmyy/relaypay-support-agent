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
GET /api/conversations/<id>/state   (server only, service role)
   ->  { answerType, ticketReference, escalation, ended, endReason, startedAt, serverTime, limits }
```

- **Voice state** (`lib/voice/state.ts`) is one reducer: idle, connecting, listening, user-speaking, processing,
  assistant-speaking, ending, ended, error. **Support state** (`lib/support/derive.ts`) is derived separately from what
  the backend recorded: normal, clarifying, ticket-created, escalation-required, escalating, escalated, completed.
  Components only render the state they are given.
- **Conversation id** is `vapi_<call id>`, which is what the agent server derives from Vapi's requests. This replaces
  the build plan's app-generated `conv_` id because everything in the backend already keys on the call id.
- **The browser never reads Supabase.** The state route returns only whitelisted customer-safe fields (never names,
  emails, transcripts, notes or internal ids), the same neutral answer for unknown ids, and `Cache-Control: no-store`.
- **Session timing (V2 Iteration 1).** The agent service enforces silence and the 6-minute limit; the page only renders
  them. `useSessionClock` ticks once a second and derives a view (`lib/session/derive.ts`: silence countdown, seconds
  left, warning) from the voice state and the `limits` / `startedAt` / `serverTime` the state route returns (server
  clock, so a skewed browser clock does not matter). It is a derived view, not a third state machine. The silence
  countdown shows after `SILENCE_TIMEOUT_SECONDS` in `listening`, any other voice state cancels it, and it is held while
  the escalation form is open. The ticking number is hidden from assistive technology; one live-region sentence
  announces it. When the call drops, `endReason` selects the end screen (silence, time limit, or the normal one); a
  guess from the last visible countdown is shown until the recorded reason is read (the page looks a few more times
  after the call ends), and no guess is made when the customer pressed End. If the call is still up 3 s after the
  limit, the browser hangs up as a last resort.
- **Preview** (`/?mock=1`): short limits (6 s quiet, 5 s countdown, 120 s session), a stand-in state fetcher, and the
  scripted call goes quiet and ends, so the countdown and the end screen can be seen in about 25 seconds.
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
| Desktop layout (single stack vs two columns) | **One column at every width** (Build Plan V3, V3.11): voice and status on top, conversation below. Was two columns on large screens |
| Header label | "Customer Support", and "Support" on small screens |
| Completion screen | "Support session complete" when a ticket or escalation exists, otherwise "Conversation ended" |
| Landing copy | The section-46 wording ("...payments, payouts, invoices, fees, or account support.") |
| "Retry" vs "Try again" | "Try again" (and "Check microphone access" for microphone errors) |
| Listening vs user-speaking | Same visible text; the visualizer and a non-announcing label tell them apart, and the live region says "Listening" for both so speech does not chatter |
| Partial transcript | Partial text updates in place, then finalizes; no flicker, no typing indicator |
| Timestamps | Omitted ("if useful" in the spec) |
| Transcript after the call | Kept next to the completion screen |
| Mute control, phone number, rating | Not built (not in the spec / optional). Pause and mute were investigated rather than built: `docs/PAUSE-RESUME.md`, with a developer-only workbench at `/dev/voice-lab` (same 404-in-production rule as `/dev/states`; it uses the real assistant) |
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
- `tests/web/session-view.test.ts` and `tests/web/session-clock.test.tsx`: silence countdown, time-limit warning,
  server-clock handling and end-reason lookup (fake timers).
- `tests/web/route.test.ts` and `tests/web/state-route.live.test.ts`: the state route with a fake and with the real
  database.
- `tests/web/audio-resume.test.tsx`, `tests/web/auth/resume-route.test.ts`: the noise detector, mute notices, Vapi client mute/resume, the 30 second resume (fake clock) and its route.
- `tests/web/feedback-ui.test.tsx`, `tests/web/auth/feedback-route.test.ts`: the rating component, rules and route.
- `tests/web/staff-cost.test.ts`, `tests/web/staff-cost-ui.test.tsx`: the cost arithmetic, queries and queue display.
- `tests/web/console.test.tsx`: stacked layout, bubbles, auto-scroll, the ended-screen matrix, typed converse, Type instead.
- `tests/web/auth/text-turn.test.ts`: the typed-turn route.
- `tests/web/retry.test.ts`, `tests/web/preflight.test.tsx`, `tests/web/microphone.test.ts`,
  `tests/web/auth/support-api.test.ts`: the retry policy, the pre-call checks, the microphone check and the start/ready routes.

## Signed-in area (Iterations 6 and 7)

There is no public page: `/` redirects to `/login`, or to the signed-in person's own area. The RelayPay shell has its own routes:
customers use `/dashboard`, `/payments`, `/payouts`, `/invoices`, `/support`, `/settings`; staff use `/staff`.
This resolves the tension with `docs/UI-SPEC.md` section 6 (the support experience should not feel like a multi-page SaaS
dashboard): the voice console itself is not turned into a dashboard, and the dashboard pages only link into it.
`/support` renders the same voice experience inside the shell (without its own header) and ties each real call to the
signed-in customer. Customer wording lives in `lib/shell-copy.ts` (`SHELL_COPY`, held to the same vocabulary rule as
`COPY`); staff wording is kept in `STAFF_COPY` in the same file. See `docs/AUTH.md`.

### Text chat with a specialist

After a handoff the customer's `/support` page (and, on any later visit, `/support` or the dashboard banner) shows
`HumanSupport`: a structured transcript (not chat bubbles), the specialist's name and title, a polite typing line, and a
labelled message box (Enter sends, Shift+Enter makes a new line). It takes no focus and has no landmark of its own, so it
can sit in a page or a future widget. Staff use `StaffChat` on the conversation page. Customer wording is in `SHELL_COPY.human`,
staff wording in `STAFF_COPY.chat`. Details: `docs/HANDOFF.md`.

### Console layout, bubbles, scrolling and typing (Build Plan V3, W3)

- **Stacked.** `SupportWorkspace` is one column (`data-layout="stack"`, no `lg:grid-cols-2`) while a call is active and after it
  ends (the completion screen above the transcript). The transcript has its own scroll region (`max-h-[60vh]`).
- **Bubbles.** `ConversationTurn` is one bubble per turn: the customer's on the right (`bg-accent-soft`), support's on the
  left, each with a speaker label; a partial turn is the same bubble, softened, updated in place.
- **Auto-scroll.** `ConversationTranscript` sticks to the bottom as turns arrive and grow, pauses when the customer scrolls
  more than 24px up, and follows again when they return to the bottom (`tests/web/console.test.tsx`).
- **Type to converse.** While the call is live, `TypedComposer` (Enter sends, Shift+Enter makes a new line) sends the text into
  the same call (`VoiceClient.send`) and shows it as the customer's turn. It is hidden while connecting or ending.
- **Type instead.** On the microphone errors (permission refused, no microphone, unsupported browser) `ErrorState` offers
  **Type instead**: `TextConversation` carries the conversation by typing alone (`useTextSession` →
  `POST /api/support/text-turn` → the agent's `POST /text-turn`), tied to the signed-in customer, with the same assistant,
  history and limits. A closer ends it and shows the same ended screen.
- **Ended screen.** `ConversationComplete` has an explanation for every recorded end reason (`END_REASON_BODY` in `lib/copy.ts`;
  a calm default while the reason is still being read), **Start another conversation**, and **View transcript**
  (`/support/<id>`) only when the call is really saved to the customer's account.

### Mute, noise and resume (Build Plan V3, W5)

- **Muted / noisy notices.** `AudioNotices` is an `aria-live="polite"` region above the voice panel. It says the microphone is
  muted when the provider reported it, and gives a noise advisory (never an accusation, never blocking) when an ambient level
  sustained above the line; with no signal it is empty. The Vapi web SDK reports mute (polled once a second) but no ambient
  level, so the noise advisory has no live source yet.
- **Resume.** When a call ends the transcript stays and `ResumePrompt` offers **Resume conversation** / **No, thanks** for 30
  seconds, with a countdown. Resume keeps the transcript and the conversation id; after 30 seconds (or "No, thanks") only
  **Start another conversation** remains, which clears the transcript and starts a new conversation. A conversation that ended
  by the time limit, a budget, noise, a specialist closing it, or a hand-over cannot be resumed. The star rating is held back
  while the window is open. See `docs/VAPI.md`.

### Ratings, history and staff cost (Build Plan V3, W4)

- **Star ratings.** `SessionFeedback` (1 to 5 stars, optional comment, always skippable) sits on the ended screen beside
  **Start another conversation** / **View transcript** (stage `ai`, only for a conversation saved to the customer's account),
  and in the closed specialist chat (stage `human`). Each stage can be rated once; sending it again returns the first answer.
  It writes `conversation_feedback` and nothing else.
- **Past conversations.** `/support/history` lists every conversation, ten to a page (`?page=`, newest first), with the
  outcome; each row opens the saved transcript. The navigation has a **Conversations** item and the dashboard card a **View
  all** link. Legacy voice turns and specialist-chat messages are merged in `TranscriptView`.
- **Staff cost.** The staff queue shows **Est. cost** per conversation and **Estimated cost today** (conversations started
  since midnight UTC); the conversation page shows the same per-call estimate and the customer's ratings and comments. The
  estimate is the sum of the turns' `cost_usd` (model usage only, never the voice provider's call cost, not a bill).
  "Resolved" in the queue is the AI conversation's outcome, not a closed ticket.

### Before a call starts (Build Plan V3, W1)

Pressing **Start conversation** runs, in order, with nothing asked of the browser until the earlier steps pass:

1. `GET /api/support/ready`: is support available? If not, the page shows the "Voice support isn't available right now" screen
   (**Try again**, "please try again in a little while", and a link to the dashboard for urgent help). No call is started.
2. `POST /api/support/start`: may this customer begin another call (one active conversation, creation rate)? A refusal
   returns to the idle screen with the reason, without a call.
3. The microphone check (`lib/voice/microphone.ts`): permission **and** an input device. Denied gives "We can't access your
   microphone", no device gives "We couldn't find a microphone"; no call is created and nothing is retried automatically.
   The idle screen explains this up front ("Before you start").

Retry rule (one policy, `lib/retry.ts`): the first attempt plus at most **one** automatic retry (300 to 800 ms apart), only
for temporary failures (network errors, 408/429/502/503/504). 401/403/404/409, validation errors and microphone problems are
never retried. Applied to readiness, start, link and the state poll. **Try again** / **Start another conversation** start a
new attempt with a fresh budget. While live status updates keep failing the page keeps the last good status and shows a quiet
notice; it never names the failing part.

## Known limits

- The live microphone path (real Vapi call from the browser) has not been exercised in automation; it needs a person.
- Agent replies take roughly 3 to 15 seconds, so "Thinking..." can be visible for a while.
- In development the page loads the voice SDK chunk with the page; the SDK only connects when a call starts. Bundle
  loading is reviewed in the testing phases.
- Run `npm run dev` from a fresh start after changing `.env.local` or `next.config.ts`; Next reads them at startup.
