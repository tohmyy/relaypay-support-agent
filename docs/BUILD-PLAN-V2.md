# RelayPay Production Customer Support Agent

## Build Plan V2 — Product Refinement & Production Hardening

**Project:** RelayPay Production Customer Support Agent  
**Version:** 2.0  
**Status:** Planned (delta from shipped V1)  
**Purpose:** Evolve the current voice-support implementation into a more complete, resilient customer-support product based on hands-on testing.

---

# 1. Purpose

The original `BUILD-PLAN.md` established the core RelayPay support agent:

- Vapi voice interface
- Claude Agent SDK
- RelayPay knowledge base
- MCP support tools
- Supabase persistence
- customer support workflows
- escalation
- voice UI
- observability
- testing and deployment

The current implementation has now been tested manually.

That testing identified several areas that need refinement before treating the application as a polished support product.

Build Plan V2 focuses on:

1. better conversation lifecycle management
2. safer voice-session behavior
3. lower latency
4. fewer unnecessary AI/agent calls
5. more natural conversation
6. human support handoff
7. authentication
8. a realistic RelayPay product shell
9. embedded support
10. phone support
11. abuse prevention and production hardening

This plan builds **on top of the original architecture** rather than replacing it.

Treat V2 as a **delta from the V1 baseline** below — not a second greenfield plan.

**PRD scope note:** Items 7–10 (auth, product shell, embedded widget, phone) and full staff realtime chat are **beyond the PRD minimum** (web voice + optional phone). They are product-hardening goals, not capstone completeness criteria.

---

# 1A. Current Baseline (post–V1)

V1 from `BUILD-PLAN.md` is largely **shipped**. V2 work must extend these surfaces, not reinvent them.

## Shipped stack

| Layer | Location | What exists today |
|-------|----------|-------------------|
| Agent HTTP + Vapi custom LLM | `services/agent/src/server.ts`, `vapi.ts`, `main.ts` | `POST /chat/completions`, optional `POST /vapi/events`, health |
| Agent turn pipeline | `services/agent/src/agent.ts`, `prompt.ts`, `guard.ts`, `schema.ts` | Claude Agent SDK; `maxTurns: 6`; tools allowlist; structured `answer_type` |
| Persistence | `services/agent/src/history.ts` | `conversations`, `conversation_turns`; marks `final_status: escalated` on successful escalation |
| Retrieval | `services/agent/retrieval/` | KB chunks + `retrieval_logs` |
| MCP tools | `services/mcp/src/tools/` | Six tools including `create_escalation`, `create_support_ticket` |
| Web voice UI | `apps/web/` | Single support page (`/`), mock mode, state gallery `/dev/states` |
| Voice session hook | `apps/web/hooks/useVoiceSession.ts` | Starts/ends Vapi call; polls state; contact form → typed user message |
| Voice FSM | `apps/web/lib/voice/state.ts` | `VoiceState`: idle → connecting → listening / speaking / processing → ending / ended / error |
| Support FSM | `apps/web/lib/support/derive.ts` | `SupportState`: normal → clarifying → ticket → escalation → completed |
| Public state API | `apps/web/app/api/conversations/[id]/state/route.ts`, `lib/conversation-state.ts` | Sanitized snapshot only (no transcripts/PII) |
| Schema | `supabase/migrations/20260929000002_runtime_tables.sql` (+ escalations, events, observability) | See enums below |
| Ops docs | `docs/VAPI.md`, `docs/UI.md`, `docs/AGENT.md`, `docs/OBSERVABILITY.md` | Runbooks for voice, UI, agent, traces |

## Shipped behaviors V2 must acknowledge

- **Slow-turn filler:** after 2.5s, SSE speaks `"One moment while I check that. "` (`SLOW_FILLER` in `vapi.ts`). Transport-only; not stored as the answer. V2 dynamic templates **replace/enhance** this, not invent acknowledgements from scratch.
- **Turn serialization:** overlapping Vapi requests for one conversation run one-at-a-time in `server.ts` so barge-in cannot interleave turns.
- **Agent loop cap:** SDK `maxTurns: 6` per turn in `agent.ts`. Conversation-level agent/tool caps are still V2 work.
- **Partial latency:** `conversation_turns.latency_ms` / `cost_usd`; `tool_calls.duration_ms`; `scripts/obs/trace.ts` + `report.ts`. Segmented pipeline metrics (`speech_to_agent_ms`, etc.) are still V2.
- **Escalation Mode A (current):** voice stays up; customer fills contact form; details are injected into the live call; agent runs `create_escalation`. No staff UI or realtime human chat yet.
- **Channel convention:** writers use `channel: 'voice'` (browser WebRTC). Phone is not configured (`docs/VAPI.md`).
- **Conversation ids:** web uses app-supplied id or `vapi_<callId>` (see `docs/VAPI.md`).

## Production schema enums (do not ignore)

| Field | Values in use |
|-------|----------------|
| `conversations.final_status` | `resolved`, `clarification`, `escalated`, `declined`, `abandoned`, `error` |
| `conversations.channel` (writers) | `voice` |
| `conversation_turns.answer_type` | `direct_answer`, `clarification`, `escalation`, `decline`, `tool_result` |
| `escalations.status` | `open`, `in_progress`, `closed` |

Canonical message store is **`conversation_turns`** (+ **`conversation_events`** for system events) — not a separate `messages` table.

## Explicitly not shipped (valid V2 gaps)

Session Controller; 6-minute / silence / gibberish limits; structured `end_reason`; dynamic ack templates; conversation context memory; staff workspace + realtime; customer/staff auth; dashboard + floating widget; phone channel; abuse rate limits; session feedback table; pause/resume.

---

# 2. Product Direction

The original implementation can be thought of as:

```text
AI Support Agent
```

Build Plan V2 evolves it into:

```text
RelayPay Support Platform
```

The target experience is:

```text
Customer
   │
   ▼
RelayPay Dashboard
   │
   ▼
Support
   │
   ▼
AI Voice Support
   │
   ├── Resolve
   │
   ├── Clarify
   │
   ├── Decline
   │
   └── Escalate
          │
          ▼
     Human Support
```

The conversation itself becomes the central persistent object.

A conversation may transition through:

```text
AI → Human → Resolved
```

without losing the existing transcript or context.

---

# 3. Decisions Confirmed for V2

The following decisions have been made.

## 3.1 AI voice session limit

The AI voice session has an absolute **6-minute maximum lifetime**.

The limit is enforced outside the AI agent.

The customer cannot extend the AI session simply by continuing to speak.

---

## 3.2 Voice interruption

The recommended behavior is:

> **The user can interrupt the AI while it is speaking.**

This creates a more natural voice experience.

Example:

```text
AI:
"Your payout is currently under review because—"

User:
"Okay, I understand."

AI stops speaking.

AI begins processing the new user input.
```

This should be implemented with safeguards against accidental background noise.

---

## 3.3 Gibberish / unintelligible input

The system should tolerate occasional unintelligible input but should not allow repeated gibberish to keep a session alive indefinitely.

Initial recommendation:

```text
Attempt 1
→ "Sorry, I didn't quite catch that. Could you repeat it?"

Attempt 2
→ "I'm still having trouble understanding. Please try again."

Attempt 3
→ End AI voice session.
```

After the session ends, the user can:

- resume/start another conversation where appropriate
- start a new support conversation
- use another support channel

---

## 3.4 Confidence handling

Confidence is treated as multiple independent concerns:

```text
Speech confidence
        ↓
Did we understand the speech?

Intent confidence
        ↓
Do we understand what the user wants?

Answer confidence
        ↓
Do we have enough reliable information to answer?
```

The system should not rely on one universal confidence number.

---

## 3.5 Dynamic response acknowledgements

**Baseline:** slow turns already speak a fixed filler after 2.5s:

> "One moment while I check that."

(`SLOW_FILLER` in `services/agent/src/vapi.ts`, SSE in `server.ts`.)

V2 **replaces/enhances** that single string with a large set of contextual templates.

Templates will be selected based on the workflow being performed. Do not invent a second acknowledgement path that bypasses the existing SSE filler mechanism.

---

## 3.6 Phone support

Phone support is an alternative entry point to the same support platform.

It will be implemented **last**.

Phone is **beyond the PRD minimum** (optional in the PRD; not configured today — see `docs/VAPI.md`).

The phone channel should reuse:

- the same agent
- the same knowledge base
- the same MCP tools
- the same customer identity
- the same conversation model
- the same escalation system
- the same observability

**Channel policy:** keep existing writer value `voice` for browser WebRTC. Add `phone` for PSTN. Do not rename `voice` → `web` without a migration of `history.ts` / MCP store writers and existing rows.
---

## 3.7 Deferred decisions

Two areas remain deliberately unresolved for now.

### Pause / resume

We will investigate the best approach before implementing it.

Questions to investigate:

- whether Vapi can suspend/reconnect cleanly
- whether the conversation can remain persistent without maintaining a live audio channel
- whether reconnecting creates a new voice session
- how session state should survive the pause
- how the 6-minute limit interacts with pause/resume
- whether paused time counts toward the AI session limit

No implementation assumption should be made yet.

---

### Duplicate-question optimization

We will investigate the best architecture before implementing aggressive caching or semantic deduplication.

The objective is:

```text
Avoid unnecessary agent/retrieval work
```

without causing:

```text
Incorrectly reused answers
```

The system must not assume that two similar questions necessarily have identical answers.

---

# 4. Architecture Change — Session Controller

A dedicated **Session Controller** should be introduced.

This is one of the most important architectural changes in V2.

**Integration point:** today Vapi calls `POST /chat/completions` on `services/agent/src/server.ts` directly. The Session Controller must sit on that path (in-process module or `services/session/`) **without breaking** the OpenAI-compatible custom-LLM contract or `POST /vapi/events` webhook behavior documented in `docs/VAPI.md`.

The AI agent should not be responsible for enforcing:

- six-minute limits
- silence timers
- abuse limits
- rate limits
- maximum failed-understanding attempts
- session termination driven by those controls
- voice connection lifecycle

These are deterministic application concerns.

The agent **does** continue to own turn reasoning, persistence of turns, output guard, and escalation marking (`final_status: escalated`) as it does today — V2 only moves **time/silence/abuse/session** controls out of the model.
---

## 4.1 Proposed Architecture

```text
                    ┌──────────────────────┐
                    │    Customer UI       │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    Vapi / Voice      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Session Controller │
                    │                      │
                    │ • 6-minute limit     │
                    │ • silence detection  │
                    │ • session lifecycle  │
                    │ • interruptions      │
                    │ • confidence limits  │
                    │ • gibberish limits   │
                    │ • rate limiting      │
                    │ • abuse protection   │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    Claude Agent      │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
              ┌───────────┐         ┌───────────┐
              │ Knowledge │         │    MCP    │
              │    Base   │         │  Server   │
              └───────────┘         └─────┬─────┘
                                          │
                                          ▼
                                   ┌────────────┐
                                   │ Supabase   │
                                   └────────────┘
```

---

# 5. Iteration 1 — Conversation Lifecycle & Session Control

## Objective

Make voice conversations start, continue and terminate intelligently.

---

## 5.1 Silence Detection

Implement configurable silence detection.

Example:

```env
SILENCE_TIMEOUT_SECONDS=15
```

The exact value should remain configurable during testing.

Flow:

```text
User stops speaking
        ↓
Silence timer starts
        ↓
Countdown displayed
        ↓
User speaks
        ↓
Countdown cancelled
```

---

## 5.2 Silence Countdown

Display:

```text
No activity detected

Ending conversation in 10 seconds...
```

Countdown:

```text
10
9
8
...
2
1
```

The user must be able to cancel the countdown simply by speaking.

---

## 5.3 Silence Termination

When the timer expires:

```text
Stop voice interaction
        ↓
Persist conversation
        ↓
Persist end reason
        ↓
Show notification
```

Notification:

```text
Session ended

The conversation ended because there was no activity.

You can start a new support conversation whenever you need help.
```

---

## 5.4 User-Requested Completion

Recognize phrases such as:

- "That's all."
- "I'm done."
- "That's everything."
- "Thank you, goodbye."
- "I don't need anything else."

Ambiguous completion should receive confirmation.

Example:

```text
User:
"Okay, thanks."

AI:
"You're welcome. Is there anything else I can help you with?"

User:
"No, that's all."

→ End conversation
```

---

# 6. 6-Minute Hard AI Session Limit

Every AI voice session receives an absolute lifetime limit.

```text
AI session starts
       │
       ├────────────── 5:30
       │                 │
       │                 ▼
       │          "You have about
       │           30 seconds left."
       │
       └────────────── 6:00
                         │
                         ▼
                  Session terminates
```

---

## 6.1 Important Rule

The 6-minute limit must be enforced server-side/session-controller-side.

It must not rely solely on:

- frontend JavaScript
- Vapi callbacks
- the Claude agent
- user behavior

---

## 6.2 Final Warning

At approximately 30 seconds remaining:

```text
This support session will end in about 30 seconds.
```

The exact wording can be varied.

---

## 6.3 Hard Termination

At six minutes:

1. stop AI voice interaction
2. stop listening
3. stop AI speech
4. persist conversation
5. persist end reason
6. display session-ended UI
7. offer another support option

End reason:

```ts
"session-timeout"
```

---

## 6.4 Human Handoff Exception

The six-minute limit applies to the **AI voice session**.

If the AI transfers the conversation to a human:

```text
AI voice session
      ↓
Human handoff
      ↓
AI voice ends
      ↓
Human conversation remains active
```

The customer conversation does not have to be destroyed simply because the AI session ended.

---

# 7. Voice Session State

Do **not** introduce a third client FSM that races `VoiceState` and `SupportState`.

### Already shipped (keep)

```ts
// apps/web/lib/voice/state.ts — call / audio transport
type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "processing"
  | "assistant-speaking"
  | "ending"
  | "ended"
  | "error";

// apps/web/lib/support/derive.ts — support workflow derived from public state API
type SupportState =
  | "normal"
  | "clarifying"
  | "ticket-created"
  | "escalation-required"
  | "escalating"
  | "escalated"
  | "completed";
```

### Session Controller (new, server-side)

Ephemeral session-control phase owned by the Session Controller (not a replacement for the UIs above):

```ts
type SessionControlPhase =
  | "active"
  | "awaiting-confirmation"
  | "silence-warning"
  | "ending"
  | "human-support"
  | "ended";
```

### Mapping

| Layer | Responsibility |
|-------|----------------|
| Vapi call phase | Transport: connected / speaking / ended |
| `VoiceState` | Customer UI for mic/call |
| `SupportState` | Customer UI for ticket/escalation workflow |
| `SessionControlPhase` | Server-side silence / 6-min / handoff control |
| DB `final_status` + `end_reason` | Durable outcome (see §8 / §75) |

---

# 8. Session End Reasons

Keep coarse **`conversations.final_status`** for outcome taxonomy (existing CHECK constraint).

Add a nullable **`end_reason`** for why the session stopped:

```ts
type ConversationEndReason =
  | "user-ended"
  | "silence-timeout"
  | "session-timeout"
  | "agent-ended"
  | "human-closed"
  | "low-confidence"
  | "error";
```

(`human-closed` is the canonical value when a staff member closes the thread. Early drafts used `human-handoff`; prefer `human-closed` for staff closure. Handoff itself sets `final_status: escalated` and `support_mode: human` while the conversation stays open.)

### Mapping to existing `final_status`

| Situation | `final_status` | `end_reason` (example) |
|-----------|----------------|------------------------|
| AI resolved | `resolved` | `user-ended` / `agent-ended` |
| Escalated to human | `escalated` | null until closed; then `human-closed` |
| Declined | `declined` | `agent-ended` |
| Silence / 6-min / gibberish cutoff | `abandoned` (or `error` if failure) | `silence-timeout` / `session-timeout` / `low-confidence` |
| Transport failure | `error` | `error` |

This allows analytics to distinguish:

```text
Why are conversations ending?
```

rather than treating every termination as the same.
---

# 9. Iteration 2 — Conversation Understanding & Quality

## Objective

Improve the quality and naturalness of the conversation.

This iteration includes:

- answer confirmation
- confidence handling
- gibberish protection
- conversational transcript
- AI avatar
- feedback
- natural completion

---

# 10. Answer Confirmation

The agent should recognize when a customer question has been addressed.

It should naturally check whether more assistance is needed.

Examples:

```text
"Does that answer your question?"
```

```text
"Is there anything else you'd like me to help with?"
```

```text
"Would you like me to check anything else?"
```

Do not append the same sentence to every answer.

The agent should use judgment based on the conversation.

---

# 11. Confidence Model

Implement three confidence layers.

## 11.1 Speech Recognition Confidence

Determines whether the audio was understood.

```text
High
→ process normally

Low
→ ask user to repeat
```

---

## 11.2 Intent Confidence

Determines whether the customer's request is understood.

```text
High
→ proceed

Medium
→ ask targeted clarification

Low
→ ask customer to restate
```

---

## 11.3 Answer Confidence

Determines whether the agent has enough reliable information.

```text
High
→ answer

Medium
→ clarify/retrieve

Low
→ do not guess
→ explain limitation
→ escalate where appropriate
```

---

# 12. Confidence Cutoff Investigation

Do not hardcode arbitrary thresholds such as:

```text
confidence > 0.7
```

until actual testing data exists.

Instead:

1. capture confidence metrics
2. run evaluation conversations
3. inspect successful/failed understanding
4. determine practical thresholds
5. configure thresholds centrally
6. retest

Example configuration:

```env
SPEECH_CONFIDENCE_THRESHOLD=
INTENT_CONFIDENCE_THRESHOLD=
ANSWER_CONFIDENCE_THRESHOLD=
```

---

# 13. Gibberish / Unintelligible Input Protection

The system should distinguish:

```text
Normal user speech
```

from:

```text
Unintelligible / low-confidence speech
```

---

## 13.1 Failed Understanding Counter

```ts
failedUnderstandingAttempts: number
```

Recommended initial behavior:

```text
0
→ normal

1
→ "Sorry, I didn't quite catch that."

2
→ "I'm still having trouble understanding. Please try again."

3
→ end AI session
```

---

## 13.2 Important

A failed-understanding attempt should not reset the overall six-minute session timer.

Otherwise a malicious or accidental stream of meaningless input could effectively extend the session indefinitely.

---

# 14. Post-Gibberish Options

After the session is terminated:

```text
We weren't able to understand the request.

You can:
[Start a new conversation]
[Try again]
[Contact support]
```

The customer should remain in control.

A previous failed session should not prevent a legitimate new conversation.

---

# 15. Conversational Transcript

**UI-SPEC alignment:** `docs/UI-SPEC.md` requires a fintech console look and explicitly says to **avoid traditional messaging-app styling with large speech bubbles**. V2 does **not** amend that into a chat-bubble product.

Restyle and extend the existing transcript in `apps/web/components/ConversationTurn.tsx` / `ConversationTranscript.tsx` (console rows), not a new message pipeline.

Use clear role labeling:

### Customer

Right-weighted or labeled customer row (console style — not a large bubble).

### AI

Left-weighted or labeled AI row with a clear "RelayPay Support (AI)" marker.

### Human (Mode B)

Left-weighted staff row with staff identity when human messaging ships.

### System

Small contextual event (can source from `conversation_events`).

Example (console layout, not chat bubbles):

```text
Customer  Can you check transaction TXN-9001?
AI        I found the transaction. It's currently being processed.
System    Conversation transferred to support.
```

---

# 16. AI Avatar

Introduce a generic RelayPay Support AI identity (compact marker, not a chatbot avatar stack that fights the console UI).

Requirements:

- clearly AI
- not represented as a fake employee
- consistent with RelayPay branding
- reusable throughout the application
- compatible with `docs/UI-SPEC.md` (no large speech-bubble chrome)

---

# 17. Session Feedback

Every completed customer session should provide optional feedback.

(`docs/UI-SPEC.md` notes ratings should not be forced unless they become a product requirement — keep feedback opt-in and lightweight.)

Initial interface:

```text
How was your support experience?

○ 1
○ 2
○ 3
○ 4
○ 5

Optional feedback

[ Tell us more... ]

[Submit feedback]
```

Store:

```text
conversation_id
rating
comment
created_at
```

---

# 18. Iteration 3 — Latency & Agent Call Optimization

## Objective

Make the support agent feel faster while reducing unnecessary AI and retrieval work.

This iteration is intentionally separate because performance should be measured rather than optimized blindly.

---

# 19. Latency Measurement

**Baseline already shipped:** per-turn `latency_ms` / `cost_usd` on `conversation_turns`; `duration_ms` on `tool_calls`; CLI `scripts/obs/trace.ts` and `report.ts` (`docs/OBSERVABILITY.md`).

V2 **extends** instrumentation with a fuller request lifecycle breakdown.

Instrument the full request lifecycle.

Measure:

```text
User finishes speaking
        ↓
Speech recognition
        ↓
Request received
        ↓
Agent starts
        ↓
Retrieval/tool call
        ↓
Model response
        ↓
Vapi begins speaking
```

Capture (in addition to existing turn-level `latency_ms`):

```text
speech_to_agent_ms
agent_reasoning_ms
retrieval_ms
mcp_ms
model_response_ms
time_to_first_audio_ms
total_turn_ms
```

---

# 20. Latency Budget

Establish target ranges after collecting baseline measurements.

For example:

```text
User stops speaking
        ↓
Target:
first meaningful response begins quickly
```

The exact numerical target should be established from the current application's measurements rather than guessed.

---

# 21. Identify Major Latency Sources

Measure separately:

- Vapi latency
- speech recognition
- Claude model response
- knowledge retrieval
- MCP calls
- Supabase queries
- unnecessary sequential operations
- frontend rendering
- network overhead

The objective is to identify the actual bottleneck before changing architecture.

---

# 22. Reduce Unnecessary Agent Calls

Investigate whether some requests can bypass a full agent cycle.

Potential categories:

### Deterministic UI/session operations

These should not invoke Claude.

Examples:

```text
End conversation
Pause UI
Resume UI
Submit feedback
Start new conversation
```

---

### Simple known state

Where safe, application state should answer the question without asking the agent to reason again.

---

### Repeated contextual information

Investigate retaining:

```text
customer context
conversation facts
previously retrieved data
previous tool results
already answered questions
```

---

# 23. Conversation Context Memory

Introduce a lightweight conversation context structure.

Example:

```ts
type ConversationContext = {
  knownCustomerId?: string;
  knownTransactionIds: string[];
  knownPayoutIds: string[];
  topicsDiscussed: string[];
  questionsAnswered: string[];
  clarificationsAsked: string[];
  relevantFacts: Record<string, string>;
};
```

This is **not a replacement for the transcript**.

It is a compact working-memory representation.

---

# 24. Duplicate Question Investigation

The system should eventually recognize when the user has already asked essentially the same question.

Example:

```text
User:
How long do international payouts take?

AI:
International payouts typically take 2–5 business days...

User:
So how long does an international payout take?
```

Instead of launching a completely new workflow, the agent can reference the existing context.

Possible response:

```text
"As mentioned, international payouts typically take 2–5 business days..."
```

However, semantic deduplication should be introduced carefully.

The system must not reuse an old answer when:

- the transaction is different
- the customer context changed
- the user is asking for a specific account
- policy information has changed
- the previous answer was uncertain
- new information is available

---

# 25. Retrieval Result Reuse

Investigate caching/reuse of safe retrieval results within a conversation.

Example:

```text
Question 1
→ Retrieve payout policy
→ Store result

Question 2
→ Same policy context
→ Reuse existing retrieval result where valid
```

This should have:

- conversation scope
- expiration rules
- invalidation rules
- source/version awareness

---

# 26. MCP Call Optimization

Do not call MCP tools unnecessarily.

Example:

```text
User:
What's the status of TXN-9001?

→ lookup_transaction(TXN-9001)
```

Follow-up:

```text
What currency is that in?
```

Should not necessarily require another lookup if the previous tool result already contains the currency.

---

# 27. Dynamic "One Moment" Responses

Create a contextual response-template library that **replaces** the fixed `SLOW_FILLER` string in `services/agent/src/vapi.ts`, still emitted via the existing SSE slow-turn path in `server.ts`.

The system should have many controlled alternatives.

---

## Customer Lookup

Examples:

- "Let me pull up your account details."
- "I'll check your account information."
- "Let me take a look at your account."
- "I'll verify those account details."
- "Let me check what I can see for your account."

---

## Transaction Lookup

Examples:

- "I'll check that transaction for you."
- "Let me pull up that transaction."
- "I'll take a look at the transaction status."
- "Let me check the latest details on that transaction."
- "I'll verify that transaction for you."

---

## Payout Lookup

Examples:

- "Let me check the payout status."
- "I'll pull up the payout details."
- "Let me take a look at that payout."
- "I'll check what the latest payout information shows."
- "Let me verify the payout status."

---

## Knowledge Base Lookup

Examples:

- "Let me check the relevant RelayPay information."
- "I'll check the current RelayPay guidance."
- "Let me verify that against our support information."
- "I'll check what our current policy says."
- "Let me look into that for you."

---

## Compliance

Examples:

- "Let me check the relevant support guidance."
- "I'll verify what I can safely tell you about that."
- "Let me check the current compliance guidance."
- "I'll review the information available to me."

---

## Ticket Creation

Examples:

- "I'll get that support request created for you."
- "Let me open a support request."
- "I'll create a support ticket so the team can review this."
- "Let me get that request logged."

---

## Escalation

Examples:

- "This needs a support specialist to take a closer look."
- "I'll connect this with our support team."
- "This is something a support specialist will need to review."
- "Let me get this escalated to the support team."
- "I'll arrange for a support specialist to continue with this."

---

# 28. Template Selection

Templates should be:

- contextual
- short
- natural
- deterministic
- non-repetitive

The system can rotate between appropriate templates.

Do not generate a completely new acknowledgement with Claude every time.

This saves:

- latency
- tokens
- unnecessary model calls

while keeping the interaction natural.

---

# 29. Iteration 4 — Voice Interaction Controls

## Objective

Improve user control over the voice session.

---

# 30. Pause / Resume — Investigation Phase

Pause/resume remains intentionally unresolved.

Before implementation, investigate:

### Option A — Vapi-level pause

Determine whether Vapi supports pausing audio interaction without maintaining a continuously active interaction channel.

### Option B — Client-side audio pause

Stop microphone capture while retaining application conversation state.

### Option C — End/reconnect

End the active voice connection and reconnect when the user chooses Resume.

### Option D — Conversation-level pause

Persist conversation state while the voice transport is closed.

---

# 31. Required Investigation Questions

Before implementation, determine:

1. Does Vapi provide a native pause/resume mechanism?
2. What happens to the underlying voice session?
3. Does reconnecting create a new call/session?
4. Can conversation state be restored?
5. Does paused time count toward six minutes?
6. What happens to unfinished agent/tool operations?
7. Can the customer resume without losing context?
8. Is reconnect latency acceptable?

Implementation should only begin after these questions are answered.

---

# 32. Voice Interruption / Barge-In

Use the recommended behavior:

> User speech interrupts AI speech.

**Baseline:** `apps/web/lib/voice/state.ts` already allows `USER_SPEECH_START` from live states including `assistant-speaking`. Agent turns are serialized per conversation in `server.ts` so overlapping requests cannot interleave. Actual audio barge-in depends on Vapi/assistant config — verify and harden in this iteration.

Flow:

```text
AI speaking
     ↓
User begins speaking
     ↓
AI speech stops
     ↓
Vapi captures user input
     ↓
Agent processes new input
```

---

# 33. Interruption Safeguards

Investigate how to avoid accidental interruption caused by:

- background TV
- keyboard noise
- nearby conversations
- microphone feedback
- echo
- false speech detection

Potential safeguards:

- minimum speech duration
- speech confidence threshold
- voice activity detection
- echo cancellation
- ignore extremely short noise events

These should be evaluated with real-world testing.

---

# 34. Iteration 5 — Human Handoff & Staff Support

## Objective

Turn escalation into a genuine customer-to-human support workflow.

---

# 35. Human Handoff

Escalation evolves in two modes. Do not assume Mode B is already how the product works.

### Mode A — shipped today (live-call escalation)

```text
Customer
    ↓
AI voice (stays up)
    ↓
Escalation decision → UI contact form
    ↓
Contact details typed into the live call (useVoiceSession)
    ↓
Agent runs create_escalation MCP tool
    ↓
final_status = escalated; conversation record kept
```

No staff inbox, no realtime human messaging. See `docs/UI.md`, `apps/web/components/ContactForm.tsx`, `services/mcp/src/tools/create-escalation.ts`.

### Mode B — V2 target (stop voice → human text)

```text
Customer
    ↓
AI voice
    ↓
Escalation decision
    ↓
AI voice stops (Vapi ended)
    ↓
Conversation remains open (support_mode = human)
    ↓
Staff queue + realtime messaging
```

Mode B requires auth, staff routes, extending the public state API, and Supabase realtime (or equivalent). Keep Mode A working until Mode B is ready.

---

# 36. AI Shutdown

When **Mode B** human handoff occurs:

- stop Vapi interaction
- stop AI speech
- stop AI listening
- preserve conversation
- preserve transcript (`conversation_turns` + events)
- update conversation mode
- extend `GET /api/conversations/[id]/state` so the customer UI can enter human-support without reading Supabase from the browser

```ts
type SupportMode =
  | "ai"
  | "human"
  | "ended";
```

Under **Mode A**, the voice call remains active through contact capture and MCP escalation; do not force-stop Vapi until Mode B is implemented.

---

# 37. Customer Handoff Message

Display:

```text
You're being connected to a support specialist.

The AI assistant has stepped out of the conversation.
A RelayPay support specialist will continue helping you here.
```

---

# 38. Staff Interface

Create a dedicated support workspace.

```text
RelayPay Support
────────────────────────────────────────

Open Conversations

Amara — LagosLedger
Invoice payment failed
Waiting for response

────────────────────────────────────────

Conversation

Customer:
My invoice payment failed...

AI:
I couldn't resolve this automatically...

System:
Conversation transferred to support.

Customer:
Hello?

Staff:
Hi Amara, I'm reviewing this for you now.

────────────────────────────────────────

Type a message...
                              [Send]
```

---

# 39. Staff Profile

Human messages should show:

```text
[Profile photo]

Sarah
Support Specialist
```

Staff data:

```text
staff_id
user_id
name
email
avatar_url
role
```

---

# 40. Staff Typing Indicator

Customer sees:

```text
Sarah is typing...
```

The staff UI can also eventually display customer activity.

---

# 41. Realtime Messaging

Use Supabase realtime or equivalent infrastructure.

```text
Staff sends message
       ↓
Persist message
       ↓
Realtime event
       ↓
Customer UI updates
```

No refresh should be required.

---

# 42. Conversation Closure

Staff can close the conversation.

```text
human-support
      ↓
resolved
      ↓
feedback
```

The AI should not automatically resume after human takeover.

---

# 43. Iteration 6 — Authentication & Authorization

## Objective

Introduce authenticated users and distinct customer/staff experiences.

**Scope:** beyond PRD minimum / capstone — product hardening for the support platform.

---

# 44. Roles

```ts
type UserRole =
  | "customer"
  | "support_agent"
  | "support_admin";
```

---

# 45. Authentication

Implement:

- login
- logout
- session persistence
- protected routes
- authorization
- customer identity association

---

# 46. Customer Routes

```text
/dashboard
/support
/support/[conversationId]
/settings
```

---

# 47. Staff Routes

```text
/staff
/staff/conversations
/staff/conversations/[conversationId]
```

---

# 48. Authorization

### Customer

Can access:

- own dashboard
- own conversations
- own support sessions

### Support Agent

Can access:

- support dashboard
- assigned/open conversations
- permitted customer information

### Support Admin

Can access:

- all support conversations
- support management
- broader operational information

---

# 49. Iteration 7 — Mock RelayPay Dashboard

## Objective

Make the application look and behave like part of an actual RelayPay product.

**Scope:** beyond PRD minimum — demo shell so support feels embedded in a product, not a standalone voice page.

---

# 50. Customer Dashboard

Example:

```text
RelayPay

Good afternoon, Amara

Payments       12
Payouts         5
Invoices        8

Recent activity

TXN-9001
International payout
Processing

TXN-9002
Invoice payment
Completed
```

---

# 51. Navigation

```text
Overview
Payments
Payouts
Invoices
Support
Settings
```

Only functionality necessary for the demonstration needs to be implemented.

---

# 52. Staff Dashboard

Example:

```text
Open conversations      12
Waiting for staff        4
Escalated                3
Resolved today          18
```

Conversation queue:

```text
Customer       Issue                 Status
Amara          Invoice failed        Waiting
David          Payout review         Assigned
Sarah          Account restriction   Escalated
```

---

# 53. Iteration 8 — Floating Support Widget

## Objective

Allow customers to access support from anywhere inside the RelayPay application.

**Scope:** beyond PRD minimum — depends on dashboard shell (Iteration 7).

---

# 54. Floating Button

Example:

```text
                                      ┌─────┐
                                      │  ?  │
                                      └─────┘
```

Expanded:

```text
┌───────────────────────────────┐
│ RelayPay Support              │
│                               │
│ Need help?                    │
│                               │
│ [Start support conversation]  │
└───────────────────────────────┘
```

---

# 55. Widget States

```ts
type SupportWidgetState =
  | "closed"
  | "open"
  | "starting"
  | "active"
  | "human-support"
  | "ended";
```

---

# 56. Widget During Human Handoff

The widget should transition from:

```text
AI voice
```

to:

```text
Human support text conversation
```

The customer should not have to navigate away from the current page.

---

# 57. Iteration 9 — Phone Support

## Objective

Add phone access as an alternative support channel.

This is intentionally the final major feature iteration.

---

# 58. Phone Architecture

```text
Customer phone
      ↓
Vapi phone number
      ↓
Same support agent
      ↓
Same knowledge base
      ↓
Same MCP
      ↓
Same Supabase
      ↓
Same escalation system
```

Do not create a separate phone-specific support agent unless technically required.

---

# 59. Phone Identity

Investigate:

- phone number recognition
- customer account association
- verification requirements
- fallback identity verification
- safe handling of account-specific information

The phone channel must respect the same sensitive-data rules as the web voice interface.

---

# 60. Phone Conversation Persistence

Phone conversations should use the same conversation model.

`conversations.channel` already exists. Writers today always set `'voice'`.

For phone, set:

```ts
type ConversationChannel =
  | "voice"   # browser WebRTC (current)
  | "phone";  # PSTN
```

See §79. Do not introduce `"web"` without migrating existing rows.

---

# 61. Iteration 10 — Abuse Prevention & Production Hardening

## Objective

Ensure the support agent cannot be cheaply or accidentally abused to consume excessive resources or maintain sessions indefinitely.

---

# 62. Threat Model

Consider:

### Session abuse

A user repeatedly starts conversations.

### Silence abuse

A user starts a session and leaves the microphone open.

### Gibberish abuse

A user continuously sends unintelligible audio.

### AI-call abuse

A user intentionally generates many expensive agent calls.

### Tool abuse

A user repeatedly invokes account/transaction lookups.

### Retrieval abuse

A user generates excessive KB retrieval requests.

### Concurrent-session abuse

A user starts multiple simultaneous conversations.

### Automated abuse

A bot repeatedly creates voice sessions.

---

# 63. Protection Layers

Implement multiple independent controls.

```text
Authentication
      ↓
Rate limiting
      ↓
Session creation limits
      ↓
6-minute hard limit
      ↓
Silence timeout
      ↓
Gibberish limit
      ↓
Tool-call limits
      ↓
Agent-call limits
      ↓
Concurrent-session limits
      ↓
Logging / monitoring
```

---

# 64. Session Creation Rate Limit

Example conceptual rule:

```text
User starts too many sessions
        ↓
temporary cooldown
```

The exact limits should be established after observing normal usage.

---

# 65. Concurrent Session Limit

Initially:

```text
1 active AI voice session per customer
```

If another session is attempted:

```text
You already have an active support conversation.
```

---

# 66. Tool-Call Limits

A conversation should have reasonable limits on expensive operations.

Example:

```text
Maximum MCP operations per conversation
```

The exact number should be configurable.

If exceeded:

```text
The request needs to be continued by a support specialist.
```

---

# 67. Agent-Call Limits

Investigate the number of Claude/agent calls generated by:

- one user turn
- one conversation
- one session

Track:

```text
agent_calls
tool_calls
retrieval_calls
tokens
latency
```

---

# 68. No Infinite Agent Loops

**Baseline already shipped:** Claude Agent SDK `maxTurns: 6` per turn in `services/agent/src/agent.ts` (`MAX_TURNS`), plus tool allowlisting. Turns for one conversation are serialized in `server.ts`.

V2 should still prevent unbounded work **across** a conversation/session:

```text
Agent
 ↓
Tool
 ↓
Agent
 ↓
Tool
 ↓
Agent
 ↓
Tool
...
```

Add configurable **conversation-level** agent-call / tool-call / retrieval budgets on top of the per-turn `maxTurns` cap.

If exceeded:

```text
Escalate or terminate safely.
```

---

# 69. Server-Side Enforcement

Important protections must not depend on frontend code.

The backend/session controller must enforce:

- session duration
- rate limits
- concurrent sessions
- tool limits
- agent limits
- failed-understanding limits

The frontend should only provide the user experience around those controls.

---

# 70. Abuse Monitoring

Log suspicious patterns such as:

```text
many sessions from same user
many sessions from same IP
many failed-understanding attempts
high MCP usage
high agent-call volume
high session frequency
```

This data can later support operational dashboards.

---

# 71. Iteration 11 — Pause / Resume Investigation

This remains an explicit investigation rather than an immediate implementation.

---

# 72. Pause / Resume Goals

The desired customer experience is:

```text
Active voice conversation

[Pause]

Voice channel released or safely suspended

Conversation remains available

[Resume]

Voice interaction reconnects
```

---

# 73. Investigation Areas

Research and test:

- Vapi session behavior
- WebRTC lifecycle
- microphone lifecycle
- reconnect behavior
- conversation restoration
- session billing/usage implications
- six-minute timer behavior
- unfinished tool calls
- unfinished AI responses
- mobile browser behavior

---

# 74. Recommended Decision Criteria

Choose the implementation that:

1. does not keep an unnecessary audio channel open
2. preserves conversation context
3. reconnects reliably
4. does not create duplicate conversations
5. does not lose transcript state
6. does not circumvent the six-minute AI limit
7. behaves predictably on mobile and desktop

---

# 75. Conversation Data Model Updates

The V2 architecture should **extend** the existing conversation model (`supabase/migrations/20260929000002_runtime_tables.sql` and follow-ons). This is a schema **delta**, not a parallel greenfield store.

## Conversations — already present (do not re-add)

```text
conversation_id
channel          # writers use 'voice' today
caller_identifier
started_at
ended_at
final_status     # resolved | clarification | escalated | declined | abandoned | error
summary
```

## Conversations — add

```text
support_mode         # ai | human | ended
end_reason           # see §8; nullable; distinct from final_status
assigned_staff_id
last_activity_at
```

Optional ephemeral/session fields (`silence-warning`, etc.) belong on the Session Controller, not necessarily as durable `status` replacing `final_status`.

### `final_status` vs `end_reason`

- Keep **`final_status`** as the coarse outcome enum (existing CHECK).
- Add nullable **`end_reason`** for why the session stopped (`session-timeout`, `silence-timeout`, `human-closed`, …).
- On Mode B handoff: set `final_status = escalated`, `support_mode = human`; set `end_reason = human-closed` only when staff closes.

Also log timeout/gibberish details in `conversation_events` metadata where useful.

---

## Conversation Context

Add a structured context object (new column or side table; not a transcript replacement):

```text
known_customer_id
known_transaction_ids
known_payout_ids
topics_discussed
questions_answered
clarifications_asked
relevant_facts
retrieved_sources
```

Today the agent only reloads the last **8** turns from `conversation_turns` (`HISTORY_LIMIT` in `history.ts`).

---

## Turns / events (not a new Messages table)

Canonical store remains:

- **`conversation_turns`** — customer + AI utterances (`user_transcript`, `assistant_response`, `answer_type`, `confidence_note`, `latency_ms`, `cost_usd`)
- **`conversation_events`** — system events (and MCP `log_conversation_event`)

For Mode B staff messaging, **extend** these tables (e.g. optional `sender` / staff rows, or staff messages as events) with an explicit migration + backfill plan.

Do **not** invent a parallel `messages` table without a cutover plan from `conversation_turns`.

If a sender discriminant is needed:

```ts
type MessageSender =
  | "customer"
  | "ai"
  | "staff"
  | "system";
```

---

## Feedback

New table:

```text
conversation_feedback
```

Fields:

```text
id
conversation_id
rating
comment
created_at
```

---

# 76. Updated Conversation State Model

Durable / workflow-oriented conversation status for Session Controller + DB (does **not** replace client `VoiceState` / `SupportState` — see §7):

```ts
type ConversationStatus =
  | "active"
  | "awaiting-confirmation"
  | "silence-warning"
  | "escalating"
  | "human-support"
  | "resolved"
  | "ended";
```

Map onto existing UI:

| `ConversationStatus` | Typical `VoiceState` | Typical `SupportState` |
|----------------------|----------------------|------------------------|
| `active` | listening / speaking / processing | normal / clarifying / ticket-* |
| `silence-warning` | listening / ending | normal |
| `escalating` | assistant-speaking / processing | escalation-required / escalating |
| `human-support` | ended (Mode B) | escalated |
| `resolved` / `ended` | ended | completed |

---

# 77. Updated Support Mode

```ts
type SupportMode =
  | "ai"
  | "human"
  | "ended";
```

(Same values as §36 — single definition.)

---

# 78. Updated Conversation End Reasons

Canonical list (unified; supersedes any earlier draft that used `human-handoff`):

```ts
type ConversationEndReason =
  | "user-ended"
  | "silence-timeout"
  | "session-timeout"
  | "agent-ended"
  | "human-closed"
  | "low-confidence"
  | "error";
```

See §8 for mapping onto `final_status`.

---

# 79. Updated Conversation Channel

```ts
type ConversationChannel =
  | "voice"   # browser WebRTC — current writers
  | "phone";  # PSTN — V2 Iteration 9
```

Do not introduce a separate `"web"` value unless migrating all existing `voice` rows and writers (`history.ts`, MCP store). If product language says "web", map it to stored `voice`.

---

# 80. End-to-End AI Conversation

Target flow:

```text
Customer logs in
        ↓
RelayPay dashboard
        ↓
Support widget
        ↓
Start voice
        ↓
Session Controller starts
        ↓
6-minute timer starts
        ↓
Customer speaks
        ↓
AI processes
        ↓
AI responds
        ↓
Customer can interrupt
        ↓
Conversation continues
        ↓
Question answered
        ↓
AI checks if more help is needed
        ↓
Customer says "That's all"
        ↓
AI confirms completion
        ↓
Session ends
        ↓
Feedback
```

---

# 81. Silence Flow

```text
Customer stops speaking
        ↓
Silence timer
        ↓
Countdown
        ↓
Customer speaks
        ↓
Timer cancelled
```

or:

```text
Silence timer
        ↓
Timeout
        ↓
AI voice stops
        ↓
Session persisted
        ↓
Silence-ended notification
        ↓
New conversation option
```

---

# 82. Gibberish Flow

```text
Unintelligible input
        ↓
Attempt 1
        ↓
User repeats
        ↓
Unintelligible input
        ↓
Attempt 2
        ↓
User repeats
        ↓
Unintelligible input
        ↓
Attempt 3
        ↓
AI voice ends
        ↓
User can retry/new conversation
```

---

# 83. Hard Session Timeout Flow

```text
Session starts
        ↓
0:00
        ↓
...
        ↓
5:30
        ↓
Final warning
        ↓
6:00
        ↓
Hard termination
        ↓
Conversation persisted
        ↓
Feedback / new conversation
```

---

# 84. Human Handoff Flow

### Mode A (shipped) — live-call escalation

```text
Customer
    ↓
AI voice (stays up)
    ↓
Escalation required → contact form
    ↓
Typed user message into live call
    ↓
create_escalation MCP tool
    ↓
final_status = escalated
    ↓
No staff realtime chat yet
```

### Mode B (V2 target) — stop voice → human text

```text
Customer
    ↓
AI
    ↓
Escalation required
    ↓
Create escalation
    ↓
AI voice stops
    ↓
Conversation remains active (support_mode = human)
    ↓
Staff receives conversation
    ↓
Staff joins
    ↓
Staff identity appears in console transcript
    ↓
Typing indicator
    ↓
Staff response
    ↓
Customer response
    ↓
Staff resolves (end_reason = human-closed)
    ↓
Optional feedback
```

---

# 85. Performance Metrics

V2 should extend measurable performance metrics beyond the V1 baseline (`conversation_turns.latency_ms`, `tool_calls.duration_ms`, `scripts/obs/*`).

## Voice

```text
time_to_first_audio
turn_latency
session_duration
silence_events
interruption_count
```

## AI

```text
agent_calls
agent_call_duration
model_tokens
retrieval_calls
retrieval_duration
```

## MCP

```text
tool_calls
tool_duration
tool_failures
```

## Conversation

```text
resolved_by_ai
escalated
silence_ended
timeout_ended
low_confidence_ended
human_resolved
```

---

# 86. Product Quality Metrics

Track:

```text
AI resolution rate
Human escalation rate
Low-confidence rate
Gibberish termination rate
Average conversation duration
Average AI turns
Average agent calls
Average MCP calls
Average response latency
Feedback rating
```

These should initially be treated as **observability metrics**, not optimization targets that the agent is allowed to manipulate.

---

# 87. Updated Build Order

The recommended implementation order is:

```text
0. Wire Session Controller into existing Vapi → agent path
   (services/agent/src/server.ts /chat/completions + /vapi/events;
    optional services/session/; do not break docs/VAPI.md contract)
        ↓
1. Conversation lifecycle (silence, 6-min, end_reason)
        ↓
2. Conversation understanding
        ↓
3. Latency + agent-call optimization
   (extend existing latency_ms / obs scripts; replace SLOW_FILLER)
        ↓
4. Voice interaction controls
        ↓
5. Human handoff Mode B (keep Mode A until ready)
        ↓
6. Authentication  [beyond PRD minimum]
        ↓
7. Dashboard  [beyond PRD minimum]
        ↓
8. Support widget  [beyond PRD minimum]
        ↓
9. Phone  [beyond PRD minimum; last major channel]
        ↓
10. Abuse hardening
        ↓
11. Pause/resume investigation + implementation
```

However, security controls that protect development/testing should be introduced incrementally rather than waiting until the final iteration.

File-level hooks for early iterations:

| Concern | Primary files |
|---------|----------------|
| Session Controller / limits | `services/agent/src/server.ts`, `vapi.ts`; new session module |
| Dynamic acks | `services/agent/src/vapi.ts` (`SLOW_FILLER`), `server.ts` SSE |
| Agent budgets | `services/agent/src/agent.ts` (`maxTurns`); conversation-level counters |
| Escalation Mode A | `history.ts`, MCP `create-escalation.ts`, `useVoiceSession.ts`, `ContactForm.tsx` |
| Public UI state | `apps/web/lib/conversation-state.ts`, `api/conversations/[id]/state` |
| Voice / support FSMs | `apps/web/lib/voice/state.ts`, `lib/support/derive.ts` |
| Schema delta | new migration under `supabase/migrations/` |
| Observability | `scripts/obs/*`, `docs/OBSERVABILITY.md` |

---

# 88. Definition of Done

Legend: `[x]` done in V1 baseline · `[~]` partial · `[ ]` still open for V2.

## Conversation Lifecycle

- [x] Silence timeout
- [x] Silence countdown
- [x] Silence-ended notification
- [x] Speaking cancels countdown
- [x] Natural completion detection
- [x] Completion confirmation
- [x] 6-minute hard limit
- [x] Final timeout warning
- [x] End reason persisted (`end_reason` column; distinct from `final_status`)

## Conversation Quality

- [x] Customer/AI transcript rows (console layout in `ConversationTurn` — not chat bubbles; align with `docs/UI-SPEC.md`)
- [ ] Compact AI identity marker (not large chatbot avatars)
- [ ] Human staff identity in transcript (Mode B)
- [~] System events (`conversation_events` exist; not all surfaced in UI)
- [ ] Answer confirmation
- [~] Confidence handling (`confidence_note` on turns only; no speech/intent cutoffs)
- [ ] Gibberish protection
- [ ] Three-attempt limit
- [ ] Optional feedback UI
- [ ] Feedback persistence (`conversation_feedback`)

## Voice Behavior

- [~] AI can be interrupted (UI reducer allows barge-in; Vapi/assistant config + safeguards still to verify)
- [~] User speech stops AI response (depends on Vapi; turn serialization prevents interleaved agent turns)
- [ ] Background-noise behavior tested
- [~] Voice lifecycle on client (`VoiceState`); Session Controller not yet central
- [ ] Pause/resume investigated
- [ ] Pause/resume implementation selected based on testing

## Performance

- [~] Latency instrumentation (per-turn `timings` segments plus Vapi-side averages once the report shape is confirmed live; time to first audio is a server-side proxy)
- [ ] Baseline latency measured (product targets from live data)
- [ ] Major latency sources identified
- [ ] Unnecessary agent calls reduced
- [ ] Context reuse investigated
- [ ] MCP result reuse implemented where safe
- [x] Dynamic acknowledgement templates (contextual, rotating, from a fixed library; `SLOW_FILLER` is the generic fallback)
- [~] Tool-call instrumentation (`tool_calls.duration_ms`; per-turn `mcp_ms` and `tools[]` as the agent sees them)
- [~] Agent-call instrumentation (per-turn latency; not conversation-level agent_calls counters)

## Human Support

- [x] Escalation records via MCP `create_escalation` (Mode A)
- [ ] AI stops after handoff (Mode B)
- [~] Conversation remains active as DB row (Mode A escalated; Mode B human thread not built)
- [ ] Staff workspace
- [ ] Staff messaging
- [ ] Realtime updates
- [ ] Staff profile/avatar
- [ ] Typing indicator
- [ ] Staff conversation closure

## Authentication — beyond PRD minimum

- [ ] Login
- [ ] Logout
- [ ] Session persistence
- [ ] Customer role
- [ ] Support agent role
- [ ] Admin role
- [ ] Route protection
- [ ] Authorization

## Product Shell — beyond PRD minimum

- [ ] Customer dashboard
- [ ] Staff dashboard
- [ ] Navigation
- [x] Support page (`/` Phase 9 voice UI)
- [ ] Floating support widget
- [ ] Widget states
- [ ] Human support inside widget

## Phone — beyond PRD minimum

- [ ] Phone number configured
- [ ] Phone conversation reaches same agent
- [ ] Customer identity handled safely
- [x] Same MCP tools (shared stack ready)
- [x] Same knowledge base (shared stack ready)
- [~] Same conversation persistence (channel writers still `voice` only)
- [ ] Phone escalation works

## Abuse Prevention

- [ ] Session rate limiting
- [ ] Concurrent-session limit
- [x] 6-minute hard limit
- [x] Silence limit
- [ ] Gibberish limit
- [ ] Agent-call limit (conversation-level; per-turn `maxTurns: 6` already shipped)
- [ ] MCP-call limit
- [x] Maximum execution depth per turn (`maxTurns: 6`)
- [ ] Suspicious usage logging
- [x] Server-side Session Controller enforcement (Iteration 1; server-initiated hang-up of a live web call still needs the live check in `docs/VAPI.md`)

---

# 89. Final V2 Architecture

```text
                         ┌───────────────────────┐
                         │   RelayPay Dashboard  │
                         └───────────┬───────────┘
                                     │
                           Support Widget/Page
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Voice / Text UI     │
                         └───────────┬───────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Session Controller │
                          │                     │
                          │ 6-min limit         │
                          │ silence             │
                          │ confidence          │
                          │ interruptions       │
                          │ abuse protection    │
                          │ lifecycle            │
                          └──────────┬──────────┘
                                     │
                         ┌───────────▼───────────┐
                         │     Claude Agent      │
                         │                       │
                         │ reasoning             │
                         │ clarification         │
                         │ escalation            │
                         │ completion            │
                         └───────┬───────┬───────┘
                                 │       │
                    ┌────────────┘       └────────────┐
                    ▼                                 ▼
             ┌─────────────┐                   ┌─────────────┐
             │ Knowledge   │                   │     MCP     │
             │ Base        │                   │   Server    │
             └─────────────┘                   └──────┬──────┘
                                                      │
                                                      ▼
                                               ┌─────────────┐
                                               │  Supabase   │
                                               │             │
                                               │ Customers   │
                                               │ Transactions│
                                               │ Payouts     │
                                               │ Conversations
                                               │ Turns/Events│
                                               │ Tickets     │
                                               │ Escalations │
                                               │ Feedback    │
                                               └──────┬──────┘
                                                      │
                                                      ▼
                                               ┌─────────────┐
                                               │ Staff UI    │
                                               │             │
                                               │ Queue       │
                                               │ Conversations
                                               │ Messaging   │
                                               │ Assignment  │
                                               └─────────────┘
```

---

# 90. Final Product Experience

The intended final experience is:

```text
                    RELAYPAY
                       │
                       ▼
              ┌─────────────────┐
              │ Customer Login   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Dashboard     │
              └────────┬────────┘
                       │
                  Support Widget
                       │
                       ▼
              ┌─────────────────┐
              │ AI Voice Support│
              └────────┬────────┘
                       │
             ┌─────────┼─────────┐
             │         │         │
             ▼         ▼         ▼
          Answer    Clarify   Escalate
             │         │         │
             │         │         ▼
             │         │    Human Support
             │         │         │
             └────┬────┘         │
                  │              │
                  ▼              ▼
              Conversation remains
                  active
                    │
                    ▼
                 Resolved
                    │
                    ▼
                 Feedback
```

---

# 91. Guiding Principles for V2

### 1. The agent should reason; the application should control.

Claude decides what the customer needs.

The application controls:

- session lifetime
- silence
- rate limits
- authentication
- permissions
- abuse prevention
- connection lifecycle

---

### 2. Voice should feel natural, not unrestricted.

The user can interrupt the AI, but:

- silence cannot hold a session forever
- gibberish cannot hold a session forever
- six minutes is the absolute AI limit
- repeated failures eventually end the session

---

### 3. Optimize measured problems.

Do not prematurely optimize the architecture.

Measure:

```text
latency
agent calls
tool calls
retrieval calls
token usage
session duration
```

Then optimize the actual bottlenecks.

---

### 4. Preserve context.

A conversation should survive:

```text
AI → Human
Voice → Text
Page navigation
Session ending
Feedback
```

---

### 5. Never optimize cost at the expense of correctness.

Reducing an agent call is only an improvement if the resulting behavior remains correct.

The system should prefer:

```text
Correct + slightly slower
```

over:

```text
Fast + incorrect
```

for account-specific, financial, compliance, and transaction-related questions.

---

### 6. Give the customer control.

The customer should always have a clear path to:

- continue
- retry
- start a new conversation
- reach human support
- end the conversation

---

# 92. V2 Completion Goal

When Build Plan V2 is complete, RelayPay should no longer feel like:

> "a voice agent connected to some tools."

It should feel like:

> **a customer support product where an AI voice assistant is the first line of support, with persistent conversations, intelligent session management, and seamless human escalation.**

The architecture should also be ready for future additions such as:

- support queues
- staff assignment
- SLA tracking
- notifications
- conversation analytics
- customer history
- knowledge-base administration
- support performance reporting
- additional communication channels

