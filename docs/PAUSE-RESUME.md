# Pause and resume: investigation

Build Plan V2, sections 30, 31, 71 to 74. The plan says to investigate before implementing anything, and not to assume
an approach. This document is the investigation: what is already known from Vapi's documentation and the installed SDK,
what is not, how to find out, and what any option would have to change. **Full mid-call pause is not implemented.** Production mute (`VoiceClient.setMuted` on the voice panel) stops the microphone
only; it does not hold silence or the hard session deadline. The 30-second post-end resume grace is documented in
`docs/VAPI.md`.

Status: **first live run done (2026-10-02); some answers are in, some experiments must be repeated.** The experiments
are run from the developer-only lab page (`/dev/voice-lab`, 404 in production unless `ENABLE_DEV_STATES=1`) against a real
call, and checked against what the server recorded (`npm run trace`). The first run was affected by a live configuration
fault (see "What the first run showed"), so read the Results table for which experiments count.

## The options (plan section 30)

| | Option | What it is |
|---|---|---|
| A | Vapi-level pause | A Vapi feature that suspends the interaction without an active audio channel |
| B | Client-side audio pause | Stop sending the microphone; keep the call and application state |
| C | End and reconnect | End the voice connection; connect again on Resume |
| D | Conversation-level pause | Keep the conversation (state in the database) while the voice transport is closed |

## What is known

Sources: Vapi's documentation (Live Call Control, Web SDK), and the installed `@vapi-ai/web` 2.7.1 and
`@daily-co/daily-js` 0.87 typings.

- **There is no native pause or resume.** Vapi's live-call control messages are `say`, `add-message`, `control`
  (`mute-assistant`, `unmute-assistant`, `say-first-message`), `end-call`, `transfer` and `handoff`. The web SDK has
  `start`, `stop`, `end`, `reconnect`, `setMuted`, `isMuted`, `say`, `send`, `setVolume`.
- **`setMuted(true)` is Daily `setLocalAudio(false)`.** It stops sending the customer's microphone. The Daily
  connection, the Vapi call and the server's timers all keep running. It throws if there is no call.
- **`control: mute-assistant`**: Vapi's documentation does not say whether this only silences the assistant's speech or
  also stops it listening or responding, nor what it does to the call or to billing. Unknown until tested.
- **`stop()` and `end()` leave the call.** With the default `roomDeleteOnUserLeaveEnabled: true` the Vapi call is
  destroyed. The SDK documents that with `false` the call is kept alive and `reconnect(webCall)` can rejoin it.
  `reconnect` requires that the previous call was stopped, and a `WebCall` (`webCallUrl`, `transport.callToken`), which
  is what `start()` returns. **The customer app throws all of that away**: `vapi-client.ts` keeps only `call.id`.
- **A fresh `start()` is a new call**, with a new id, so a new conversation id (`vapi_<callId>`). The agent server
  honours `metadata.conversation_id` before the call id, so a conversation *could* be continued across calls, but the web
  client sends none today.
- **The agent rebuilds its context from the database**, not from Vapi: it ignores Vapi's message history and reloads the
  last 8 turns of the conversation id. So a continued conversation id keeps its context even on a brand-new call.
- **Server timers are wall-clock.** The 6-minute limit comes from `conversations.started_at` and is checked in four
  places: the controller's timers and `beforeTurn`, the browser's `deriveSessionView` (and its 3-second hang-up), and
  Vapi's own `maxDurationSeconds`. Paused time counts today, and so does a muted caller's silence: the agent service
  ends a quiet call at about 26 seconds.
- **There is no paused state anywhere**: not in `VoiceState`, `SupportState`, `SessionControlPhase`, nor the database
  (`final_status`, `end_reason`, no `paused_at`). An ended conversation is refused further turns.
- **An unfinished turn is not cancelled.** If a pause (or any disconnect) happens while the agent is working, the turn
  finishes and is saved; since Iteration 4 it is also marked "reply not delivered" in `conversation_turns.timings`.

## The eight questions (plan section 31)

| # | Question | Answer so far | Still to settle |
|---|---|---|---|
| 1 | Does Vapi provide a native pause/resume? | **No** native pause. The closest is the `mute-assistant` control: **observed** to take the assistant out of the conversation entirely (Vapi kept transcribing the customer, but no turn reached the agent and nothing was spoken; Experiment 3). The call stays open | What it does to billing; whether `unmute-assistant` restores normal turns (not yet exercised) |
| 2 | What happens to the underlying voice session? | Mute (microphone): the call stays live. Leave with `roomDeleteOnUserLeaveEnabled: false`: the call stays alive and rejoinable for at least the ~9 seconds tested; the server saw no end-of-call report on leaving (Experiment 4). The browser's own "ended" message on leaving is synthetic (see below) | How long a left call stays rejoinable (Experiment 5 was cut short by the silence timer); billing while the customer is away |
| 3 | Does reconnecting create a new call/session? | **No**: `reconnect(webCall)` rejoined the **same** call, and the server kept using the same conversation id (`vapi_<call id>`); Experiment 4 | Same on mobile |
| 4 | Can conversation state be restored? | **Yes for the same call**: after reconnecting, the customer's speech was transcribed and reached the agent as turns of the same conversation (3 turns in the trace). For a brand-new call it still needs `metadata.conversation_id` and handling of the ended state | **Whether the customer can hear the assistant after reconnecting**: the lab saw no assistant speech or transcript events after the reconnect at all (see below). Your report of "Meeting has ended" after reconnecting matches the 98 s attempt (which logged that error twice); the 9 s reconnect logged no error, but whether you could hear the assistant on that one is still unanswered |
| 5 | Does paused time count toward six minutes? | Today, yes (wall clock, four places). A product decision, not a technical limit. Seen: a call kept open 6 minutes was ended at exactly `session-timeout` (360 s) | Decide the rule |
| 6 | What happens to unfinished agent/tool operations? | They finish and are saved. Seen in Experiment 4: while the agent was slow, the customer kept talking and each new request **queued behind the unfinished one** (31 s, then 56 s), so the answers piled up | Whether those late replies reached the customer (needs Iteration 4's `delivered` flag, not yet deployed) |
| 7 | Can the customer resume without losing context? | Same call: the agent rebuilds context from the database, so yes. See 4 for the audio caveat | As 4 |
| 8 | Is reconnect latency acceptable? | **About 1.0 s** from clicking Reconnect to `call-start` (one desktop sample) | Repeat several times and on a phone |

Also to find out (plan section 73): microphone lifecycle on mobile browsers (does the tab backgrounding stop the mic or
the call?), unfinished AI responses, and the effect on usage and billing.

## Options against the decision criteria (plan section 74)

Based on what is known; "?" marks what the experiments must settle.

| Criterion | B mute | C end and reconnect | D conversation-level pause |
|---|---|---|---|
| 1. No unnecessary audio channel open | No: the channel stays up | Yes if the call is destroyed; **?** if it is kept alive (`false`) | Yes |
| 2. Preserves context | Yes | Only if the conversation id is reused | Yes by design |
| 3. Reconnects reliably | Not applicable | **?** (Experiments 4, 5; mobile) | **?** |
| 4. No duplicate conversations | Yes | No unless the id is reused | Yes by design |
| 5. No transcript loss | Yes | Yes if the id is reused | Yes |
| 6. Does not circumvent the six-minute limit | Wall-clock keeps running, so yes, but a muted caller is ended by silence | Needs a rule: reconnecting must not reset `started_at` | Needs a rule and server-side accounting |
| 7. Predictable on mobile and desktop | **?** | **?** | **?** |

**After the first run** (still not a decision): reconnecting to the same call took about a second and kept the conversation, which
supports building on option C using `reconnect()`, subject to the open question of whether the assistant is audible after
rejoining. `mute-assistant` stops turns reaching the agent but leaves the call billed and the silence timer running, so it is
not a substitute for the server knowing about the pause. The silence timer ending an absent customer after ~26 seconds was
confirmed on two calls, so any pause longer than that needs a paused state on the server.

**Working hypothesis, to be confirmed or discarded by the results (not a decision):** option D built on C, because it is
the only one that releases the audio channel while keeping the conversation and the time limit under the server's
control. A plain mute (B) would be at most a convenience, and only with a server signal, otherwise silence detection
ends the call. If the experiments show `reconnect` is fast and reliable, C can use it; if not, C starts a new call that
continues the same conversation id.

## What any option has to change

Whatever is chosen, these are the places that assume a call never pauses:

1. `SessionControlPhase` gains a paused state; `canMeasureSilence` must be false while paused, and a paused call must have
   its own (long) expiry so it cannot be held forever (abuse hardening, Iteration 10).
2. The session limit needs a rule for paused time, applied consistently in: the controller timers and `beforeTurn`
   (`scheduleLimits`), `deriveSessionView` and `useSessionClock` in the browser, and Vapi's `maxDurationSeconds`.
3. `ensure()`/`endConversation` and the ended-conversation refusal: a paused conversation is not ended.
4. The public state API needs a paused flag; `VoiceState` should not gain a third parallel machine (Build Plan V2
   section 7), so a pause is either one more `VoiceState` or a flag on the existing state.
5. The browser client must keep what `start()` returns (for `reconnect`) or send `metadata.conversation_id`; and the
   `VoiceClient` interface and `MockVoiceClient` need the new methods.
6. Persistence and metrics: when it was paused, for how long, and how often.

## Experiments (run with `/dev/voice-lab`)

Set `ENABLE_DEV_STATES=1` if running a production build; otherwise `npm run dev` and open `/dev/voice-lab`. It uses the
real assistant (conversations are created, the model runs, calls are billed). Keep calls short.

**Before you start (the first run was ruined by skipping these):**

1. `npm run vapi:setup -- --url <your agent URL> --dry-run` and check `serverMessages` includes **`speech-update`**. If it
   does not, run it without `--dry-run`, then dry-run again to confirm it stuck. Without it the agent service cannot see
   anyone speaking and ends every call about 26 seconds after it starts, whatever is said. (Done 2026-10-02: the dry run
   now lists `speech-update`.)
2. The agent service ends a quiet call after `SILENCE_TIMEOUT_SECONDS` + `SILENCE_COUNTDOWN_SECONDS` (10 + 10 + 1 s). Any
   experiment that waits longer than that (a long mute, a long absence) needs `SILENCE_TIMEOUT_SECONDS=120` on the agent
   service, restarted. Put it back afterwards. (That an absent customer is hung up after ~26 s is itself a finding: a pause
   of any length needs the server to know about it.)

Experiments:

1. **Mute the microphone and speak; unmute and speak.** Is anything transcribed while muted? Does the assistant respond
   after unmuting? Read the "SDK says muted=" lines: the lab now reports the SDK's state both straight away and 0.5 s later.
2. **Mute the assistant (control message) and ask a question; then unmute and ask again.** Is anything spoken? Does a turn
   reach the agent (`npm run trace`)? Does unmuting restore normal turns?
3. **Start with "keep the call alive when I leave", then Leave and Reconnect within 10 seconds.** Same call id? **Can you hear
   the assistant after reconnecting?** Does it continue the conversation?
4. **Leave and wait 60 seconds (silence timer raised), then Reconnect.** Still works? What does the end-of-call report say?
5. Repeat 1 and 3 on a phone browser (screen lock, switching tabs).
6. **Afterwards**, in the Vapi dashboard check the call durations and usage for these test calls, which settles billing
   while muted or left.

Paste the lab's "Copy log" output into the table below with the date. The log shows the shape of events and messages only,
never what anyone said. Identical messages in a row (the stream of partial transcripts) are folded into one line.

## Results

First run: 2026-10-02, desktop browser, current assistant. "Server" means what `npm run trace` showed for that call.

| Experiment (original numbering) | Call id | Observation | Counts? |
|---|---|---|---|
| Mute the microphone, stay silent | `01a0fcd4-8727-7cc9-be6c-fcc8c8cafe67` | Mic muted at +6.0 s while the assistant was talking; no user speech events afterwards. Call dropped at +31 s. **Server: `silence-timeout`, silence countdown started 15.3 s after the call began, call ended at 26-27 s.** The first mute click logged `muted: false`: the SDK had not applied it yet when asked (the second click logged `true`) | Partly. Confirms a muted call is ended by the silence timer; the timer was running from the start of the call, not from the end of the greeting, because `speech-update` was not subscribed |
| Mute the microphone and speak | (your note: "2. No") | "No": nothing was transcribed or heard while muted (confirmed by you; Experiment 1's log agrees: no user events after the mute). Whether the assistant responded after unmuting was not covered | Yes for "a muted microphone sends nothing" |
| Mute the assistant, then ask a question | `01a0fcd6-8dc1-7000-923b-91d3bae2f0f0` | After the control message: Vapi kept transcribing the customer (partial and final transcripts, conversation updates) but there was **no assistant speech, no assistant transcript, and no model output**. **Server: no turns at all**: Vapi never called the agent while the assistant was muted. A `hang` message appeared 5 s after the customer finished. Ended at +31 s by the silence timer (same fault as above) | Yes for "what does mute-assistant do". Unmute not exercised |
| Leave and reconnect within 10 s | `01a0fcd7-834c-7000-8293-9cb0293903dd` | Left at +9.2 s; the browser immediately logged a `status-update ended endedReason=customer-ended-call` (**synthetic, produced by the SDK on leaving; the server received no end-of-call report**). Reconnect at +18.4 s: `call-start` 1.0 s later. The customer then spoke and was transcribed. **Server: three turns of the same conversation id**, silence countdown cancelled by the first turn, call ran to `session-timeout` at 360 s (`duration 369.6 s`, cost $0.341). **After reconnecting the lab saw no assistant speech or transcript events at all**, only `model-output`/`voice-input` messages | Yes. Reconnect works and keeps the conversation. **Whether the assistant was audible after reconnecting is unknown**: did you hear it? |
| Leave, wait, reconnect | `01a0fcd8-b382-722a-8f23-00817b5ef9c0` | Left at +8.4 s; reconnect at +106 s failed with "Meeting has ended" (twice). **Server: ended by `silence-timeout` at 27 s**, so the call was already over before the reconnect | **No.** Our own silence timer ended the call; this says nothing about how long Vapi keeps a left call. Repeat with the silence timer raised |

## What the first run showed (beyond pause/resume)

1. **The live assistant is not subscribed to `speech-update`.** `vapi:setup --dry-run` showed
   `serverMessages: [status-update, end-of-call-report]`, although the session limits from the same setup run
   (`maxDurationSeconds 370`, `silenceTimeoutSeconds 600`) were present. Effect: the agent service never learned who was
   speaking, so its silence timer ran from the start of the call and cut calls at about 26 seconds regardless (a call only
   survives if the customer's first request arrives before then). Fix: re-run `vapi:setup` and confirm with `--dry-run`.
   If `speech-update` does not stay, Vapi is rejecting it for this assistant and the dashboard must be checked.
2. **Server-initiated hang-up works on web calls.** Three silence timeouts and one 360 s session timeout were each followed
   by Vapi ending the call within seconds, reported as `endedReason: assistant-ended-call-after-message-spoken`. This closes
   the open question from Iteration 1 (which route the controller used is not recorded).
3. **`mute-assistant` is not just "quiet"**: it stops Vapi calling the agent. That makes it the nearest thing to a native
   pause, but the call stays open and billed and the server's silence timer keeps running.
4. **`isMuted()` can lag behind `setMuted()`**, so the lab's first reading was wrong. The lab now reads it straight away and
   0.5 s later. Errors that printed as `[object Object]` now show their reason, and repeated messages are folded.
5. **Vapi's own latency averages do arrive** in the end-of-call report under the names the agent expects (10 calls averaged
   turn 818 ms, model 265 ms, voice 503 ms, transcriber 49 ms). Calls with no real exchange report zeros, and so did the
   reconnect call even though it had three turns, so treat a zero as "not measured".
6. **The agent itself was slow** in these calls: see the first measurements in `docs/PERFORMANCE.md`.

## What Build Plan V3 shipped from this (and what it did not)

The full question (hold the silence timer while the customer is paused, mid-call) is **still open**. Build Plan V3 took two
narrow pieces that do not need that decision:

- **Mute status and a noise advisory (concern 28).** The page says when the microphone is muted
  (`VoiceClient.onMuteChange`; the Vapi web SDK has `isMuted()` but no mute event, so the client reads it once a second and
  reports a change) and, if a provider can give an ambient level, when the room looks noisy (`lib/voice/noise.ts`: loud for
  4 s to show, quiet for 6 s to hide, so it never flickers). Both are `aria-live="polite"`, advisory only, never block the
  call, and show nothing when there is no signal. **The Vapi web SDK gives no ambient level, so the noise advisory is built
  and tested but has no live source (`[—]`).** There is no mute *button* and no silence hold: that needs this decision.
- **A 30 second resume after the call ends (concern 16).** Not a mid-call pause: after the call has ended the customer can pick
  the same conversation back up for 30 seconds, transcript kept. See `docs/VAPI.md`, "Resuming a conversation".

## Decision

Not made. Once the table is filled in: choose A, B, C or D against the criteria above, decide the rule for paused time,
and record both here. Implementation is scheduled for the later "Pause / resume" iteration (Build Plan V2, build order
step 11).
