# RelayPay Production Customer Support Agent

## Build Plan

**Version:** 1.0
**Status:** Implementation Ready
**Project:** Week 6 Capstone
**Primary Stack:** Next.js, TypeScript, Vapi, Claude Agent SDK, MCP, Supabase

---

# 1. Purpose

This document converts the RelayPay Technical Design Document and UI Specification into a concrete implementation plan.

The build should proceed from infrastructure and data foundations toward agent behavior, voice integration, UI, observability, evaluation, and deployment.

The implementation should prioritize getting a complete end-to-end support flow working early, then progressively hardening it.

---

# 2. Final System

The completed system should provide:

```text
Customer
   │
   ▼
RelayPay Voice UI
   │
   ▼
Vapi
   │
   ▼
Claude Agent
   │
   ├──────────────► Knowledge Retrieval
   │
   └──────────────► MCP Server
                         │
                         ▼
                      Supabase
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Customers  Transactions  Payouts
              │
              ├──────────────► Tickets
              │
              └──────────────► Escalations
```

The final implementation must support:

* General knowledge questions
* Clarifying questions
* Customer lookup
* Transaction lookup
* Payout lookup
* Support-ticket creation
* Human escalation
* Unsupported requests
* Voice interaction
* Conversation logging
* Retrieval logging
* MCP tool-call logging
* Evaluation recording

---

# 3. Implementation Strategy

The recommended implementation strategy is:

> **Build the smallest complete vertical slice first, then expand capability.**

The first working slice should be:

```text
Voice UI
   ↓
Vapi
   ↓
Agent
   ↓
KB
   ↓
Response
   ↓
Voice UI
```

Then introduce:

```text
Agent
   ↓
MCP
   ↓
Supabase
```

Then:

```text
Ticket / Escalation
   ↓
Observability
   ↓
Evaluation
```

This prevents spending too much time building isolated infrastructure before confirming that the core experience works.

---

# 4. Project Structure

Recommended repository:

```text
relaypay-support-agent/
│
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       ├── hooks/
│       ├── lib/
│       └── ...
│
├── services/
│   ├── agent/
│   │   ├── prompts/
│   │   ├── retrieval/
│   │   ├── orchestration/
│   │   └── ...
│   │
│   └── mcp/
│       ├── tools/
│       ├── db/
│       └── ...
│
├── knowledge/
│   ├── product/
│   ├── faq/
│   ├── compliance/
│   ├── security/
│   ├── disputes/
│   └── release-notes/
│
├── supabase/
│   ├── migrations/
│   └── seed/
│
├── tests/
│   ├── agent/
│   ├── mcp/
│   ├── retrieval/
│   └── evaluations/
│
├── docs/
│   ├── TDD.md
│   ├── UI-SPEC.md
│   └── BUILD-PLAN.md
│
├── .env.example
├── package.json
└── README.md
```

The exact monorepo tooling can be selected during project initialization.

---

# 5. Phase 1 — Project Initialization

## Objective

Create the application foundation and development environment.

### Tasks

* [ ] Create repository.
* [ ] Initialize package manager/workspace.
* [ ] Initialize Next.js application.
* [ ] Configure TypeScript.
* [ ] Configure ESLint.
* [ ] Configure formatting.
* [ ] Configure Tailwind.
* [ ] Install UI component dependencies.
* [ ] Create base folder structure.
* [ ] Create `.env.example`.
* [ ] Configure local development scripts.
* [ ] Add README.
* [ ] Add TDD/UI-SPEC/BUILD-PLAN documents.

### Initial dependencies

Frontend:

```text
next
react
typescript
tailwindcss
lucide-react
```

Backend/agent:

```text
@anthropic-ai/claude-agent-sdk
```

Voice:

```text
Vapi SDK/client package as required by implementation
```

Database:

```text
@supabase/supabase-js
```

MCP:

```text
MCP SDK/package required by selected implementation
```

Testing:

```text
vitest
playwright
```

Exact package versions should be pinned during implementation.

---

# 6. Phase 2 — Environment Configuration

Create environment configuration for:

```env
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_VAPI_PUBLIC_KEY=

VAPI_API_KEY=
VAPI_ASSISTANT_ID=

ANTHROPIC_API_KEY=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

MCP_SERVER_URL=
MCP_SERVER_AUTH_TOKEN=
```

## Rules

* Never expose server secrets to the browser.
* Never commit `.env`.
* Keep `.env.example` safe.
* Validate required environment variables during server startup.
* Separate development and production credentials.

---

# 7. Phase 3 — Supabase Foundation

## Objective

Create the database required by the agent and MCP server.

### Tasks

* [ ] Create Supabase project.
* [ ] Configure database.
* [ ] Create migration structure.
* [ ] Create seed tables.
* [ ] Create runtime tables.
* [ ] Add indexes.
* [ ] Add relationships.
* [ ] Configure database access.
* [ ] Import supplied seed records.
* [ ] Verify seed data.

---

# 8. Supabase Schema

Create:

```text
customers
transactions
payouts

conversations
conversation_turns
retrieval_logs
tool_calls
support_tickets
escalations
evaluations
```

### Important indexes

At minimum:

```text
customers.customer_id
customers.contact_email
customers.company_name

transactions.transaction_id
transactions.customer_id

payouts.payout_id
payouts.transaction_id
payouts.customer_id

conversations.conversation_id

support_tickets.ticket_id
escalations.escalation_id
```

---

# 9. Seed Data

Import:

```text
assets/seed-data/customers.csv
assets/seed-data/transactions.csv
assets/seed-data/payouts.csv
```

Verify:

* Customer lookup works.
* Transaction lookup works.
* Payout lookup works.
* Foreign-key relationships are correct.
* Required test records exist.

The supplied test scenarios should be checked against the seed data before agent implementation proceeds.

---

# 10. Phase 4 — Knowledge Base

## Objective

Turn the RelayPay documentation into an approved retrieval source.

### Tasks

* [ ] Collect approved KB content.
* [ ] Normalize documents.
* [ ] Assign document metadata.
* [ ] Split documents into chunks.
* [ ] Store chunks.
* [ ] Implement retrieval.
* [ ] Test retrieval against representative questions.
* [ ] Add retrieval logging.

---

# 11. Knowledge Categories

Organize content into:

```text
product
faq
compliance
security
disputes
communications
release_notes
```

Each chunk should retain:

```text
document_id
title
section
content
source_type
version
```

---

# 12. Retrieval Implementation

Implement:

```text
retrieveKnowledge(query)
```

Responsibilities:

1. Accept user query.
2. Search approved content.
3. Rank relevant chunks.
4. Return top relevant results.
5. Include metadata.
6. Log retrieval.

The implementation may use:

* PostgreSQL full-text search
* pgvector
* embedding-based retrieval
* hybrid retrieval

The exact retrieval mechanism should be selected based on implementation simplicity and evaluation quality.

For the capstone, avoid introducing unnecessary infrastructure if a simpler approach provides sufficient retrieval quality.

---

# 13. Retrieval Acceptance Test

Test queries such as:

```text
How much does RelayPay charge?

How long does an international payout take?

Why can a payout be delayed?

What happens if my account is restricted?

Can RelayPay guarantee my payout arrives tomorrow?
```

Verify that the expected KB sections are retrieved.

---

# 14. Phase 5 — MCP Server

## Objective

Build the controlled business-operation layer.

Implement:

```text
lookup_customer
lookup_transaction
lookup_payout
create_support_ticket
create_escalation
log_conversation_event
```

---

# 15. MCP Server Structure

Recommended:

```text
services/mcp/
│
├── server.ts
│
├── tools/
│   ├── lookup-customer.ts
│   ├── lookup-transaction.ts
│   ├── lookup-payout.ts
│   ├── create-support-ticket.ts
│   ├── create-escalation.ts
│   └── log-conversation-event.ts
│
├── db/
│   ├── client.ts
│   └── queries/
│
├── validation/
│   └── schemas.ts
│
└── utils/
    ├── logging.ts
    └── errors.ts
```

---

# 16. MCP Input Validation

Every tool must validate its input before database access.

Examples:

```text
transaction_id required
```

```text
lookup_customer requires at least one identifier
```

```text
create_escalation requires:
user_name
user_email
category
reason
```

Invalid input should produce a structured error.

---

# 17. MCP Read Tools

Implement and test:

### `lookup_customer`

Test:

* Customer ID
* Email
* Company name
* Missing customer
* Invalid input

### `lookup_transaction`

Test:

* Existing transaction
* Missing transaction
* Invalid ID

### `lookup_payout`

Test:

* Payout ID
* Transaction ID
* Missing payout
* Invalid input

---

# 18. MCP Write Tools

Implement:

### `create_support_ticket`

Verify:

* Record is inserted.
* Ticket ID is returned.
* Status is `open`.
* Conversation ID is stored.

### `create_escalation`

Verify:

* Record is inserted.
* Escalation ID is returned.
* Status is `open`.
* Ticket/customer relationship is preserved.

### `log_conversation_event`

Verify:

* Event is persisted.
* Metadata is stored safely.
* Sensitive information is not unnecessarily logged.

---

# 19. MCP Error Handling

Every tool should use a consistent pattern:

```text
validate
   ↓
execute
   ↓
normalize result
   ↓
log
   ↓
return
```

For example:

```text
Customer exists
→ found: true

Customer doesn't exist
→ found: false

Database failure
→ structured failure
→ technical error logged
```

The customer should never receive raw database or infrastructure errors.

---

# 20. Phase 6 — Agent Foundation

## Objective

Create the Claude Agent SDK support agent.

The agent should be able to:

* Receive a conversation turn.
* Access approved knowledge.
* Use MCP tools.
* Apply escalation rules.
* Generate customer-safe responses.
* Maintain conversation context.
* Record relevant events.

---

# 21. Agent System Prompt

Create:

```text
services/agent/prompts/system.md
```

The system prompt should define:

### Role

You are RelayPay Customer Support.

### Knowledge

Use approved RelayPay knowledge for general product/policy answers.

### Tools

Use MCP tools for supported business-data operations.

### Safety

Never:

* Guess
* Guarantee outcomes
* Reveal internal compliance logic
* Reveal sensitive information unnecessarily
* Provide unsupported advice

### Escalation

Escalate when required and stop autonomous troubleshooting afterward.

### Communication

Be concise, calm, and conversational.

---

# 22. Agent Context

Each request should provide:

```text
conversation_id
current_user_message
conversation_history
retrieved_knowledge
available_tools
```

The agent should not receive unnecessary database information.

---

# 23. Agent Tool Integration

Connect the Claude Agent SDK to the MCP server.

Expected flow:

```text
User
 ↓
Agent
 ↓
Determine tool required
 ↓
MCP
 ↓
Tool result
 ↓
Agent
 ↓
Customer-safe response
```

---

# 24. Agent Decision Tests

Before connecting Vapi, test the agent with text input.

### Test

> What are RelayPay's fees?

Expected:

```text
KB retrieval
→ grounded answer
→ no invented exact fee
```

### Test

> My payment is stuck.

Expected:

```text
Clarification
```

### Test

> Check TXN-9001.

Expected:

```text
lookup_transaction
→ safe response
```

### Test

> My account is restricted.

Expected:

```text
Escalation
```

---

# 25. Phase 7 — Support Workflows

Implement each supported workflow explicitly.

---

## Workflow A — General Knowledge

```text
Question
 ↓
Retrieve KB
 ↓
Generate grounded response
 ↓
Log retrieval
 ↓
Log turn
```

---

## Workflow B — Clarification

```text
Ambiguous request
 ↓
Ask one useful question
 ↓
Wait for user
 ↓
Continue workflow
```

Avoid asking multiple unnecessary questions at once.

---

## Workflow C — Customer Lookup

```text
Customer identifies themselves
 ↓
lookup_customer
 ↓
Evaluate result
 ↓
Safe summary
 ↓
Log tool call
```

---

## Workflow D — Transaction Lookup

```text
Transaction ID
 ↓
lookup_transaction
 ↓
Safe status
 ↓
No unsupported promise
```

---

## Workflow E — Payout Lookup

```text
Payout reference
 ↓
lookup_payout
 ↓
Normal status?
 ├── Yes → safe response
 └── Review/compliance → escalate
```

---

## Workflow F — Support Ticket

```text
Customer issue
 ↓
Determine required information
 ↓
Create ticket
 ↓
Confirm ticket
 ↓
Continue or escalate
```

---

## Workflow G — Human Escalation

```text
Escalation condition
 ↓
Explain human support is required
 ↓
Collect details
 ↓
Create escalation
 ↓
Confirm follow-up
 ↓
Stop automated troubleshooting
```

---

## Workflow H — Unsupported Request

```text
Unsupported question
 ↓
Determine safe response
 ↓
Decline
 ↓
Offer appropriate support path
```

---

# 26. Phase 8 — Vapi Integration

## Objective

Connect the agent to the voice layer.

### Tasks

* [ ] Create Vapi configuration.
* [ ] Configure voice assistant.
* [ ] Configure speech recognition.
* [ ] Configure response handling.
* [ ] Connect backend endpoint.
* [ ] Test microphone.
* [ ] Test speech output.
* [ ] Test conversation lifecycle.

---

# 27. Vapi Conversation Flow

```text
Customer speaks
      ↓
Vapi transcription
      ↓
Backend
      ↓
Claude Agent
      ↓
Response
      ↓
Vapi
      ↓
Speech
      ↓
Customer
```

---

# 28. Vapi Session Management

The application should create a unique conversation ID when a support session begins.

Example:

```text
conversation_id = conv_<unique-id>
```

That ID should be associated with:

* conversation record
* conversation turns
* retrieval logs
* tool calls
* tickets
* escalations

---

# 29. Phase 9 — Voice UI

## Objective

Implement the UI defined in `UI-SPEC.md`.

---

# 30. Core Components

Implement:

```text
SupportPage
Header
SupportWorkspace
VoicePanel
VoiceStatus
VoiceVisualizer
VoicePrompt
VoiceControl
ConversationPanel
ConversationTranscript
ConversationTurn
CapabilityHints
EscalationPanel
ContactForm
EscalationConfirmation
ErrorState
ConversationComplete
```

---

# 31. Frontend Voice State

Implement:

```typescript
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
```

Create a single source of truth for the state.

Avoid duplicating voice-state logic across components.

---

# 32. Frontend Support State

Implement:

```typescript
type SupportState =
  | "normal"
  | "clarifying"
  | "ticket-created"
  | "escalation-required"
  | "escalating"
  | "escalated"
  | "completed";
```

Voice state and support workflow state should remain independent.

---

# 33. Transcript Integration

Map agent/Vapi conversation events into:

```text
ConversationTurn
```

Each turn should contain:

```text
speaker
text
timestamp
```

The UI should never require raw backend logs to render the conversation.

---

# 34. Escalation UI

Implement:

```text
EscalationPanel
```

Fields:

```text
name
email
preferred_time
```

Validation:

* Name required
* Valid email required
* Preferred time optional

The backend remains responsible for creating the escalation.

---

# 35. Phase 10 — Observability

## Objective

Make the entire support interaction traceable.

Log:

* Conversation start
* Conversation end
* User turns
* Assistant turns
* Retrievals
* Tool calls
* Tickets
* Escalations
* Errors

---

# 36. Tool Call Logging

Every MCP call should create:

```text
tool_calls
```

Record:

```text
tool_name
purpose
input_summary
result_summary
status
error
timestamp
```

Do not store unnecessary sensitive raw values.

---

# 37. Conversation Logging

At minimum:

```text
conversation
conversation_turns
```

should allow the entire conversation to be reconstructed.

---

# 38. Phase 11 — Security Hardening

Review:

### Secrets

* [ ] No secrets in frontend.
* [ ] No API keys in source.
* [ ] `.env` ignored.

### Database

* [ ] Service role only server-side.
* [ ] Access restricted appropriately.

### MCP

* [ ] Inputs validated.
* [ ] Tools expose only required fields.
* [ ] Write operations protected.

### Agent

* [ ] System prompt contains safety rules.
* [ ] No unsupported guarantees.
* [ ] No internal compliance information.
* [ ] No sensitive information leakage.

### Session isolation

* [ ] Unique conversation IDs.
* [ ] No shared mutable customer state.

---

# 39. Phase 12 — Automated Testing

Implement unit and integration tests before final evaluation.

---

## MCP Unit Tests

Test:

```text
lookup_customer
lookup_transaction
lookup_payout
create_support_ticket
create_escalation
log_conversation_event
```

---

## Retrieval Tests

Test:

```text
fees
payout timelines
invoice behavior
compliance restrictions
security/privacy
disputes
```

---

## Agent Tests

Test:

```text
direct answer
clarification
lookup
ticket
escalation
decline
```

---

# 40. Phase 13 — End-to-End Testing

Run the complete voice flow.

Verify:

```text
Voice
 ↓
Vapi
 ↓
Agent
 ↓
KB/MCP
 ↓
Supabase
 ↓
Agent
 ↓
Vapi
 ↓
Voice
```

Check that the conversation remains coherent throughout.

---

# 41. Required Evaluation Scenarios

The nine supplied scenarios become the formal acceptance suite.

---

## Scenario 1 — Fees

Input:

> What are the fees for sending money internationally?

Verify:

* [ ] KB retrieval occurs.
* [ ] Fee policy is retrieved.
* [ ] Fees are described as variable.
* [ ] Corridor/payment-method factors are mentioned.
* [ ] No exact fee is invented.
* [ ] Fees shown before confirmation is mentioned.

---

## Scenario 2 — Ambiguous Payment

Input:

> My payment is stuck.

Verify:

* [ ] Agent does not guess.
* [ ] Agent asks what type of payment.
* [ ] Agent asks for reference if necessary.
* [ ] No fabricated status.

---

## Scenario 3 — Customer Lookup

Input:

> I am Amara from LagosLedger. Can you check my account?

Verify:

* [ ] Customer can be identified.
* [ ] `lookup_customer` is called.
* [ ] Safe account information is summarized.
* [ ] Sensitive information is not spoken.

---

## Scenario 4 — Transaction Lookup

Input:

> Can you check transaction TXN-9001?

Verify:

* [ ] `lookup_transaction` is called.
* [ ] Correct record is returned.
* [ ] Customer-safe status is communicated.
* [ ] No unsupported arrival guarantee.

---

## Scenario 5 — Payout Lookup

Input:

> What is happening with payout PAY-7002?

Verify:

* [ ] `lookup_payout` is called.
* [ ] Review status is identified.
* [ ] Compliance-related review triggers escalation.
* [ ] Internal compliance details are not disclosed.

---

## Scenario 6 — Ticket

Input:

> My invoice payment failed and I need someone to look at it.

Verify:

* [ ] Reference is requested if needed.
* [ ] Support ticket is created.
* [ ] Ticket is persisted.
* [ ] User receives confirmation.

---

## Scenario 7 — Human Escalation

Input:

> My account was restricted and nobody is helping me.

Verify:

* [ ] Escalation is triggered.
* [ ] Name/email/callback details are collected as needed.
* [ ] Escalation record is created.
* [ ] User receives follow-up confirmation.
* [ ] Agent stops trying to resolve internally.

---

## Scenario 8 — Unsupported Guarantee

Input:

> Can RelayPay guarantee my payout arrives by 9am tomorrow?

Verify:

* [ ] Guarantee is declined.
* [ ] Approved payout timeline is provided.
* [ ] No unsupported promise is made.

---

## Scenario 9 — Voice

Verify:

* [ ] Vapi captures speech.
* [ ] Backend receives transcript.
* [ ] Agent processes request.
* [ ] Response reaches Vapi.
* [ ] Response is spoken.
* [ ] Conversation is logged.

---

# 42. Evaluation Recording

Every scenario should be recorded in:

```text
evaluations
```

Example:

```text
scenario:
"Transaction lookup"

expected_behavior:
"Use lookup_transaction and provide safe status."

actual_behavior:
"Agent called lookup_transaction and reported processing status."

pass:
true

notes:
"Did not expose internal fields."
```

---

# 43. Phase 14 — UI Testing

Use browser testing to verify:

### Initial State

* [ ] Branding
* [ ] Start button
* [ ] Capability hints

### Active Session

* [ ] Voice state
* [ ] Visualizer
* [ ] Transcript
* [ ] End conversation

### Escalation

* [ ] Escalation message
* [ ] Contact form
* [ ] Validation
* [ ] Confirmation

### Error States

* [ ] Connection error
* [ ] Microphone error
* [ ] Retry

### Responsive

* [ ] Mobile
* [ ] Tablet
* [ ] Desktop

---

# 44. Phase 15 — Accessibility Testing

Verify:

* [ ] Keyboard navigation
* [ ] Focus states
* [ ] Screen-reader labels
* [ ] Form labels
* [ ] Error announcements
* [ ] Reduced motion
* [ ] Color contrast
* [ ] No color-only state communication

---

# 45. Phase 16 — Deployment

Deploy the application components.

Potential architecture:

```text
                Internet
                   │
          ┌────────┴────────┐
          ▼                 ▼
       Vercel            Vapi
          │
          ▼
    Agent Backend
          │
      ┌───┴────┐
      ▼        ▼
  Anthropic   MCP
                │
                ▼
            Supabase
```

The MCP server may require separate hosting depending on its runtime requirements.

---

# 46. Production Environment

Before deployment:

* [ ] Production Supabase project configured.
* [ ] Production environment variables configured.
* [ ] Vapi production configuration configured.
* [ ] Anthropic credentials configured.
* [ ] MCP endpoint configured.
* [ ] CORS configured.
* [ ] Allowed origins restricted.
* [ ] HTTPS enabled.
* [ ] Database migrations applied.
* [ ] Seed data loaded.

---

# 47. Deployment Verification

After deployment:

### Application

* [ ] Landing page loads.
* [ ] Branding is correct.
* [ ] No console errors.

### Voice

* [ ] Microphone works.
* [ ] Vapi connects.
* [ ] Speech recognition works.
* [ ] Agent responds.
* [ ] Speech synthesis works.

### Backend

* [ ] Agent endpoint works.
* [ ] MCP connection works.
* [ ] Supabase connection works.

### Data

* [ ] Customer lookup works.
* [ ] Transaction lookup works.
* [ ] Payout lookup works.
* [ ] Ticket creation works.
* [ ] Escalation creation works.
* [ ] Logs are persisted.

---

# 48. Phase 17 — Production Evaluation

Run all nine scenarios against the deployed system.

For each:

```text
Scenario
Input
Expected
Actual
Pass/Fail
Notes
Evidence
```

Capture evidence through:

* Screenshots
* Database records
* Browser recordings
* Voice recordings
* Loom walkthrough

---

# 49. Evidence Checklist

Collect evidence for:

### Knowledge

* Fees retrieval
* Payout timeline retrieval
* Compliance guidance

### MCP

* Customer lookup
* Transaction lookup
* Payout lookup
* Ticket creation
* Escalation creation

### Database

* Conversation
* Turn
* Retrieval
* Tool call
* Ticket
* Escalation
* Evaluation

### Voice

* User speaks
* Agent responds
* Voice response is played

---

# 50. Loom Demonstration

The final Loom should demonstrate the complete product rather than the implementation details.

Recommended sequence:

```text
1. Introduce RelayPay Support Agent
2. Show landing screen
3. Start voice conversation
4. Ask a knowledge question
5. Ask an ambiguous question
6. Perform transaction lookup
7. Demonstrate ticket creation
8. Demonstrate escalation
9. Show resulting records
10. Briefly explain architecture
```

Keep the walkthrough focused on the required capabilities.

---

# 51. README

The final README should contain:

## Product

What the RelayPay Support Agent does.

## Architecture

High-level system diagram.

## Stack

* Next.js
* TypeScript
* Vapi
* Claude Agent SDK
* MCP
* Supabase

## Setup

Local installation instructions.

## Environment

Required environment variables.

## Database

Migration and seed instructions.

## MCP

How to run the MCP server.

## Agent

How the Claude agent works.

## Voice

How Vapi is configured.

## Testing

How to run automated tests.

## Evaluation

How the supplied scenarios were tested.

## Deployment

Production deployment instructions.

---

# 52. One-Page System / User Guide

Create a concise document explaining:

### What it does

RelayPay voice support for product questions and customer support.

### What customers can ask

* Payments
* Payouts
* Invoices
* Fees
* Account support

### When it escalates

* Account restrictions
* Compliance
* Disputes
* Human judgment
* Unsupported issues

### What customers should provide

When relevant:

* Transaction reference
* Payout reference
* Name
* Email
* Callback preference

---

# 53. Reflection Sheet

The reflection should cover:

### Architecture

Why Vapi, Claude Agent SDK, MCP, and Supabase were selected.

### Agent Design

How the four response paths work.

### Safety

How the system avoids guessing and protects sensitive information.

### Retrieval

How the agent stays grounded in approved RelayPay knowledge.

### MCP

Why business operations are exposed through controlled tools.

### Evaluation

What the nine scenarios revealed.

### Improvements

What would be added in a production version.

---

# 54. Production Hardening Backlog

The capstone implementation should remain focused.

Potential future work:

* Authentication
* Customer dashboard integration
* Real appointment scheduling
* Agent analytics
* Support-team dashboard
* Advanced RAG evaluation
* Human-agent handoff
* CRM integration
* Ticket status updates
* Multi-language support
* Call recording management
* Advanced fraud/risk workflows
* Conversation sentiment analytics

These should not be allowed to distract from the required Week 6 deliverables.

---

# 55. Definition of Done

The project is complete when:

## Product

* [ ] Voice support interface works.
* [ ] RelayPay branding is applied.
* [ ] Customer can complete a support conversation.

## Agent

* [ ] General questions are grounded.
* [ ] Ambiguous requests are clarified.
* [ ] Business information is retrieved through MCP.
* [ ] Unsupported questions are declined safely.
* [ ] Human-required cases are escalated.

## MCP

* [ ] Six required tools work.
* [ ] Errors are handled.
* [ ] Write operations persist.

## Database

* [ ] Seed data exists.
* [ ] Runtime tables exist.
* [ ] Conversation activity is logged.

## Voice

* [ ] Vapi captures speech.
* [ ] Agent receives requests.
* [ ] Responses are spoken.

## UI

* [ ] Desktop works.
* [ ] Mobile works.
* [ ] Voice states are visible.
* [ ] Escalation UI works.
* [ ] Accessibility requirements are satisfied.

## Evaluation

* [ ] Nine scenarios tested.
* [ ] Results recorded.
* [ ] Evidence collected.

## Submission

* [ ] Voice interface link
* [ ] MCP repository/code
* [ ] MCP setup/deployment details
* [ ] Testing evidence
* [ ] Loom
* [ ] Reflection sheet
* [ ] One-page system/user guide

---

# 56. Recommended Build Order

The implementation sequence is:

```text
1. Project initialization
        ↓
2. Environment setup
        ↓
3. Supabase schema + seed
        ↓
4. Knowledge base + retrieval
        ↓
5. MCP server
        ↓
6. Agent foundation
        ↓
7. Agent + KB
        ↓
8. Agent + MCP
        ↓
9. Support workflows
        ↓
10. Vapi integration
        ↓
11. Voice UI
        ↓
12. Observability
        ↓
13. Security hardening
        ↓
14. Automated tests
        ↓
15. End-to-end tests
        ↓
16. Deployment
        ↓
17. Production evaluation
        ↓
18. Submission evidence
```

---

# 57. Milestone Gates

Each major section should have a working checkpoint.

### Gate 1 — Foundation

```text
Next.js
+
Supabase
+
Seed data
```

### Gate 2 — Knowledge

```text
Question
→ Retrieval
→ Grounded answer
```

### Gate 3 — MCP

```text
Agent
→ MCP
→ Supabase
→ Result
```

### Gate 4 — Agent

```text
Agent
→ KB
→ MCP
→ Correct decision
```

### Gate 5 — Voice

```text
Voice
→ Vapi
→ Agent
→ Voice
```

### Gate 6 — Production Support

```text
Voice
→ Agent
→ KB/MCP
→ Ticket/Escalation
→ Supabase
→ Response
```

### Gate 7 — Submission

```text
Deployed system
+
Evaluation evidence
+
Loom
+
Documentation
```

---

# 58. Final Architecture-to-Build Mapping

| Requirement             | Implementation                  |
| ----------------------- | ------------------------------- |
| Voice                   | Vapi                            |
| Agent reasoning         | Claude Agent SDK                |
| Product knowledge       | Approved RelayPay KB            |
| Retrieval               | Retrieval service               |
| Business operations     | Custom MCP server               |
| Customer lookup         | MCP                             |
| Transaction lookup      | MCP                             |
| Payout lookup           | MCP                             |
| Ticket creation         | MCP                             |
| Escalation              | MCP                             |
| Runtime persistence     | Supabase                        |
| Voice UI                | Next.js                         |
| Conversation transcript | React                           |
| Evaluation              | Supabase + test suite           |
| Deployment              | Vercel + MCP hosting + Supabase |
| Evidence                | Screenshots + recordings + Loom |

---

# 59. Final Implementation Principle

The build should always preserve this separation:

```text
┌──────────────────────────────┐
│          EXPERIENCE          │
│       Next.js + Vapi         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│           REASONING          │
│       Claude Agent SDK       │
└──────────────┬───────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌──────────────┐ ┌──────────────┐
│  KNOWLEDGE   │ │   ACTIONS    │
│     KB       │ │     MCP      │
└──────────────┘ └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   SUPABASE   │
                  │    DATA      │
                  └──────────────┘
```

The **UI should not contain agent logic**, the **agent should not directly manipulate business data**, and the **MCP server should not make conversational decisions**.

Each layer should have a clear responsibility.

That separation is the foundation for making the RelayPay Support Agent testable, observable, secure, and maintainable.
