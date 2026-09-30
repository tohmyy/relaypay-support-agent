# RelayPay Production Customer Support Agent

## Technical Design Document (TDD)

**Version:** 1.0
**Status:** Draft / Implementation Ready
**Project:** Week 6 Capstone
**Product:** RelayPay Customer Support Agent

---

## 1. Purpose

This document defines the technical architecture, system components, data model, agent behavior, tool interfaces, retrieval architecture, observability, security boundaries, and deployment design for the RelayPay Production Customer Support Agent.

The system provides a voice-first customer support experience for RelayPay customers.

It combines:

* **Vapi** for voice interaction
* **Claude Agent SDK** for agent reasoning and orchestration
* **Custom MCP server** for business-data access and support actions
* **Supabase/PostgreSQL** for application data, runtime records, and observability
* **Approved RelayPay Knowledge Base** for policy/product grounding

The system is designed around four possible response paths:

1. **Answer directly**
2. **Ask for clarification**
3. **Escalate to human support**
4. **Decline gracefully**

The agent must prioritize accuracy, safe handling of customer information, and explicit escalation over guessing.

---

# 2. System Goals

## 2.1 Primary Goals

The system must:

* Answer general RelayPay product and policy questions using approved knowledge.
* Retrieve relevant customer, transaction, and payout information when appropriate.
* Ask clarifying questions when the user's request is ambiguous.
* Create support tickets for actionable support issues.
* Escalate account-specific, compliance, dispute, and human-judgment cases.
* Provide safe spoken responses without exposing sensitive information.
* Log conversations, retrievals, tool calls, tickets, and escalations.
* Support voice conversations through Vapi.
* Provide enough observability to evaluate agent behavior.
* Support deterministic evaluation against the supplied test scenarios.

---

## 2.2 Non-Goals

The system will not:

* Make compliance decisions.
* Override compliance restrictions.
* Guarantee payment or payout timelines.
* Provide legal, tax, or financial advice.
* Process refunds directly.
* Cancel transactions directly.
* Resolve disputes autonomously.
* Expose internal risk rules or thresholds.
* Expose identity documents.
* Expose internal compliance assessments.
* Invent transaction statuses or timelines.
* Send outbound customer communications without an explicitly supported workflow.
* Access arbitrary customer data outside the defined MCP tools.

---

# 3. High-Level Architecture

```text
┌───────────────────────────────┐
│          Customer             │
│      Voice Web Interface      │
└───────────────┬───────────────┘
                │
                │ Speech
                ▼
┌───────────────────────────────┐
│             Vapi              │
│ Voice capture / transcription │
│ Speech synthesis / response   │
└───────────────┬───────────────┘
                │
                │ User transcript
                ▼
┌───────────────────────────────┐
│      Support Agent API        │
│       Claude Agent SDK        │
│                               │
│  • Conversation orchestration │
│  • Intent classification      │
│  • Policy enforcement         │
│  • Tool selection             │
│  • Response generation        │
└──────────┬────────────┬───────┘
           │            │
           │            │ MCP
           │            ▼
           │   ┌──────────────────────┐
           │   │    Custom MCP Server │
           │   │                      │
           │   │ • Customer lookup    │
           │   │ • Transaction lookup │
           │   │ • Payout lookup      │
           │   │ • Ticket creation    │
           │   │ • Escalation         │
           │   │ • Event logging      │
           │   └──────────┬───────────┘
           │              │
           │              ▼
           │     ┌──────────────────┐
           │     │     Supabase     │
           │     │   PostgreSQL     │
           │     └──────────────────┘
           │
           ▼
┌───────────────────────────────┐
│     RelayPay Knowledge Base   │
│                               │
│ • Product documentation       │
│ • FAQ                         │
│ • Compliance guidance         │
│ • Security/privacy            │
│ • Dispute guidance            │
│ • Release notes               │
└───────────────────────────────┘
```

---

# 4. Technology Stack

| Layer               | Technology                                |
| ------------------- | ----------------------------------------- |
| Frontend            | Next.js + TypeScript                      |
| UI                  | React                                     |
| Voice               | Vapi                                      |
| Agent               | Claude Agent SDK                          |
| Agent language      | TypeScript                                |
| Tool protocol       | MCP                                       |
| MCP server          | Custom TypeScript MCP server              |
| Database            | Supabase PostgreSQL                       |
| Authentication      | Application/session mechanism as required |
| Knowledge retrieval | Supabase-backed retrieval layer           |
| Deployment          | Vercel / suitable server runtime          |
| Version control     | Git/GitHub                                |

The exact hosting split between the Next.js application, agent runtime, and MCP server will be finalized during implementation based on runtime requirements of the Claude Agent SDK and MCP server.

---

# 5. Application Components

## 5.1 Voice Client

The voice client is the customer-facing interface.

Responsibilities:

* Start/end voice sessions.
* Connect to Vapi.
* Display conversation state.
* Show listening/processing/speaking states.
* Display non-sensitive conversation information.
* Provide connection/error feedback.
* Allow the customer to end the conversation.

The client must not directly access Supabase business data.

---

## 5.2 Vapi

Vapi provides the voice interaction layer.

Responsibilities:

* Capture customer speech.
* Convert speech to transcript.
* Send user input to the configured backend/assistant.
* Receive generated responses.
* Convert responses to speech.
* Manage voice-session lifecycle.

Vapi should not be responsible for business logic.

Business decisions remain in the support agent.

---

## 5.3 Support Agent

The support agent is the central orchestration component.

Responsibilities:

1. Receive the customer's request.
2. Determine the request type.
3. Determine whether clarification is required.
4. Determine whether approved knowledge is sufficient.
5. Retrieve relevant KB content when required.
6. Determine whether a business-data lookup is required.
7. Invoke MCP tools when necessary.
8. Apply escalation rules.
9. Generate a safe response.
10. Record relevant events.

The agent must not bypass the MCP boundary to directly query business tables.

---

## 5.4 Knowledge Retrieval Layer

The knowledge retrieval layer provides approved RelayPay information to the agent.

It should support:

```text
User question
      ↓
Query preparation
      ↓
Relevant KB retrieval
      ↓
Top matching chunks
      ↓
Grounded agent response
      ↓
Retrieval log
```

Only approved RelayPay documentation should be used for authoritative product/policy answers.

---

## 5.5 MCP Server

The MCP server provides the agent with controlled business operations.

The MCP server is the boundary between agent reasoning and application data/actions.

```text
Claude Agent
     │
     │ MCP
     ▼
MCP Server
     │
     ├── Customer lookup
     ├── Transaction lookup
     ├── Payout lookup
     ├── Ticket creation
     ├── Escalation creation
     └── Event logging
              │
              ▼
          Supabase
```

The agent decides **when** a tool is necessary.

The MCP server determines **how** the operation is performed.

---

# 6. Agent Decision Architecture

Every user request should be routed through the following decision model.

```text
                    User Request
                         │
                         ▼
                  Understand Intent
                         │
             ┌───────────┴───────────┐
             │                       │
        Ambiguous?                Clear?
             │                       │
            YES                      ▼
             │              Is it supported?
             ▼                       │
      Ask Clarifying        ┌────────┴────────┐
                            │                 │
                           YES                NO
                            │                 │
                            ▼                 ▼
                     Does it require      Decline /
                     business data?      Escalate
                            │
                     ┌──────┴──────┐
                     │             │
                    YES            NO
                     │             │
                     ▼             ▼
                  MCP lookup    KB answer
                     │
                     ▼
              Is escalation required?
                     │
                ┌────┴────┐
               YES        NO
                │          │
                ▼          ▼
           Escalate      Respond
```

---

# 7. Response Path Rules

## 7.1 Answer Directly

Use when:

* The question is general.
* The approved KB contains the answer.
* No account-specific information is required.
* No human judgment is required.

Examples:

* "What is RelayPay?"
* "How long do international payouts usually take?"
* "How are fees calculated?"

---

## 7.2 Ask Clarifying

Use when:

* The request has multiple possible meanings.
* A required identifier is missing.
* The system cannot safely determine which operation is needed.

Example:

> "My payment is stuck."

The agent should determine whether the user means:

* incoming transfer
* outgoing payout
* invoice payment

It should not guess.

---

## 7.3 Escalate Human

Escalation takes precedence when the request requires:

* Human judgment
* Account-level investigation
* Compliance handling
* Dispute handling
* Restriction review
* Refund/cancellation handling
* Information outside approved knowledge
* Sensitive support intervention

Once escalation is triggered, the agent must stop attempting to independently resolve the underlying issue.

---

## 7.4 Decline Gracefully

Use when:

* The information is outside approved RelayPay documentation.
* The agent cannot safely determine the answer.
* Answering would require speculation.
* The requested action is unsupported.

The response should explain what can be done instead.

---

# 8. Knowledge Retrieval Design

## 8.1 Source Documents

The approved knowledge base contains:

* Product documentation
* FAQ
* Compliance guidance
* Security/privacy guidance
* Dispute/refund/cancellation guidance
* Communications policy
* Release notes

---

## 8.2 Document Processing

Knowledge documents should be converted into retrieval-friendly chunks.

Each chunk should retain metadata:

```text
id
document_id
title
section
content
source_type
version
created_at
```

Recommended source types:

```text
product
faq
compliance
security
disputes
communications
release_notes
```

---

## 8.3 Retrieval Strategy

The retrieval process should:

1. Receive the user question.
2. Generate/search a retrieval query.
3. Retrieve relevant approved chunks.
4. Pass the retrieved content to Claude.
5. Require the answer to remain grounded in those chunks.
6. Log the retrieval.

If sufficient supporting information cannot be found, the agent must not fabricate an answer.

---

## 8.4 Retrieval Logging

Every meaningful retrieval should create a `retrieval_logs` record.

The log should capture:

* query
* retrieved chunk identifiers
* source titles
* source summaries
* timestamp
* conversation ID

---

# 9. MCP Tool Design

## 9.1 `lookup_customer`

### Purpose

Safely retrieve customer account information required for support.

### Input

```typescript
{
  customer_id?: string;
  email?: string;
  company_name?: string;
}
```

At least one identifying field should be supplied.

### Output

```typescript
{
  found: boolean;
  customer_id?: string;
  company_name?: string;
  plan?: string;
  account_status?: string;
  kyc_status?: string;
  support_notes?: string;
}
```

The tool should return only fields necessary for support.

Sensitive fields must not be exposed.

---

# 10. `lookup_transaction`

### Purpose

Retrieve the status and support information for a transaction.

### Input

```typescript
{
  transaction_id: string;
}
```

### Output

```typescript
{
  found: boolean;
  transaction_id?: string;
  customer_id?: string;
  type?: string;
  status?: string;
  amount?: number;
  currency?: string;
  estimated_arrival?: string;
  support_summary?: string;
}
```

The agent must translate the result into customer-safe language.

The raw database response should never simply be spoken to the customer.

---

# 11. `lookup_payout`

### Purpose

Retrieve payout status and support information.

### Input

```typescript
{
  payout_id?: string;
  transaction_id?: string;
}
```

At least one identifier should be provided.

### Output

```typescript
{
  found: boolean;
  payout_id?: string;
  status?: string;
  scheduled_for?: string;
  failure_reason?: string;
  support_summary?: string;
}
```

If the result indicates compliance review, escalation rules apply.

---

# 12. `create_support_ticket`

### Purpose

Create a support ticket for a customer issue requiring follow-up.

### Input

```typescript
{
  customer_id?: string;
  category: string;
  priority: string;
  summary: string;
  conversation_id: string;
}
```

### Output

```typescript
{
  ticket_id: string;
  status: "open";
}
```

The tool must persist the ticket in Supabase.

---

# 13. `create_escalation`

### Purpose

Create a human-support escalation.

### Input

```typescript
{
  ticket_id?: string;
  customer_id?: string;
  user_name: string;
  user_email: string;
  category: string;
  reason: string;
  preferred_time?: string;
}
```

### Output

```typescript
{
  escalation_id: string;
  status: "open";
  follow_up_summary: string;
}
```

The tool must persist the escalation in Supabase.

---

# 14. `log_conversation_event`

### Purpose

Record important runtime events.

### Input

```typescript
{
  conversation_id: string;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown>;
}
```

### Output

```typescript
{
  logged: boolean;
}
```

This tool provides a common event-logging mechanism for the agent/MCP workflow.

---

# 15. MCP Error Handling

MCP tools must fail safely.

Example:

```text
Tool called
   │
   ├── Success ───────► Return structured result
   │
   └── Failure
         │
         ├── Log technical error
         │
         └── Return safe user-facing result
```

A missing customer, transaction, or payout should return:

```typescript
{
  found: false
}
```

rather than throwing an unhandled application error.

Technical error details must be logged but not spoken to the customer.

---

# 16. Supabase Data Model

The database contains two broad categories of data:

### Seed/business data

* customers
* transactions
* payouts

### Runtime/support data

* conversations
* conversation_turns
* retrieval_logs
* tool_calls
* support_tickets
* escalations
* evaluations

---

# 17. Seed Tables

## 17.1 Customers

```sql
customers
---------
customer_id
company_name
contact_name
contact_email
plan
account_status
region
kyc_status
support_notes
```

---

## 17.2 Transactions

```sql
transactions
------------
transaction_id
customer_id
transaction_type
amount
currency
destination_country
status
created_at
estimated_arrival
support_summary
```

---

## 17.3 Payouts

```sql
payouts
-------
payout_id
transaction_id
customer_id
recipient_name
amount
currency
status
scheduled_for
failure_reason
```

---

# 18. Runtime Tables

## 18.1 Conversations

Recommended schema:

```sql
conversations
-------------
id uuid primary key
conversation_id text unique not null
channel text not null
caller_identifier text
started_at timestamptz not null
ended_at timestamptz
final_status text
summary text
created_at timestamptz default now()
```

Possible `final_status` values:

```text
resolved
clarification
escalated
declined
abandoned
error
```

---

## 18.2 Conversation Turns

```sql
conversation_turns
------------------
id uuid primary key
conversation_id text not null
turn_number integer
user_transcript text
assistant_response text
answer_type text
confidence_note text
created_at timestamptz default now()
```

`answer_type`:

```text
direct_answer
clarification
escalation
decline
tool_result
```

---

## 18.3 Retrieval Logs

```sql
retrieval_logs
--------------
id uuid primary key
conversation_id text
query text
kb_chunks jsonb
source_titles jsonb
source_summary text
created_at timestamptz default now()
```

---

## 18.4 Tool Calls

```sql
tool_calls
----------
id uuid primary key
conversation_id text
tool_name text
purpose text
input_summary text
result_summary text
status text
error text
created_at timestamptz default now()
```

`status`:

```text
success
failed
not_found
```

Sensitive raw input/output should not be stored unnecessarily.

---

## 18.5 Support Tickets

```sql
support_tickets
---------------
id uuid primary key
ticket_id text unique
conversation_id text
customer_id text
category text
priority text
summary text
status text
created_at timestamptz default now()
updated_at timestamptz default now()
```

Possible categories:

```text
payment
payout
invoice
account
compliance
technical
other
```

Possible priorities:

```text
low
normal
high
urgent
```

---

## 18.6 Escalations

```sql
escalations
-----------
id uuid primary key
escalation_id text unique
ticket_id text
customer_id text
user_name text
user_email text
category text
reason text
call_booked boolean default false
preferred_time text
status text
created_at timestamptz default now()
```

Possible categories:

```text
compliance
account
dispute
payment
other
```

Possible statuses:

```text
open
in_progress
closed
```

---

## 18.7 Evaluations

```sql
evaluations
-----------
id uuid primary key
test_scenario text
expected_behavior text
actual_behavior text
pass boolean
notes text
created_at timestamptz default now()
```

---

# 19. Relationships

```text
customers
   │
   ├─────────────── transactions
   │                    │
   │                    └──── payouts
   │
   ├─────────────── support_tickets
   │                    │
   │                    └──── escalations
   │
   └─────────────── escalations

conversations
   │
   ├──── conversation_turns
   ├──── retrieval_logs
   ├──── tool_calls
   └──── support_tickets
              │
              └──── escalations
```

The runtime records should preserve the conversation context necessary to reconstruct an interaction.

---

# 20. Conversation Lifecycle

```text
START
  │
  ▼
Create conversation
  │
  ▼
Receive user input
  │
  ▼
Create turn context
  │
  ▼
Agent reasoning
  │
  ├── KB retrieval
  │
  ├── MCP lookup
  │
  ├── Clarification
  │
  ├── Ticket creation
  │
  └── Escalation
  │
  ▼
Generate safe response
  │
  ▼
Persist turn/event
  │
  ▼
Vapi speaks response
  │
  ▼
Continue conversation
  │
  ▼
End conversation
  │
  ▼
Update final status
```

---

# 21. Escalation Architecture

Escalation is a controlled workflow rather than merely a response message.

```text
User issue
    │
    ▼
Escalation condition detected
    │
    ▼
Explain human support is required
    │
    ▼
Collect required contact information
    │
    ▼
Create/support ticket if required
    │
    ▼
Create escalation
    │
    ▼
Log escalation event
    │
    ▼
Confirm follow-up
    │
    ▼
STOP AUTOMATED RESOLUTION
```

The agent must not continue troubleshooting the issue after escalation has been triggered.

---

# 22. Escalation Categories

### Compliance

Examples:

* KYC/KYB concerns
* restricted account
* compliance review
* identity verification issues

### Account

Examples:

* account restriction
* account access issue
* account-specific investigation

### Dispute

Examples:

* transaction dispute
* refund
* cancellation

### Payment

Examples:

* failed payment requiring intervention
* transaction issue requiring support

### Other

Any issue requiring human handling that does not fit the above categories.

---

# 23. Sensitive Data Handling

The voice interface is treated as an untrusted/public interaction surface.

The agent must follow these rules:

* Do not expose identity documents.
* Do not expose internal risk assessments.
* Do not reveal internal compliance rules.
* Do not reveal confidential thresholds.
* Do not read unnecessary account details aloud.
* Do not expose information belonging to another customer.
* Do not infer sensitive information.
* Only use customer information necessary for the current support request.

For account-specific lookups, responses should be summarized.

Example:

Instead of:

> "Your account has KYC status `review_required` and internal support note `AML threshold exceeded`."

The agent should provide an appropriate customer-safe response such as:

> "Your account is currently under review. A support specialist will need to assist with the next steps."

---

# 24. Prompt Architecture

The agent should receive instructions in layers.

```text
System Instructions
        │
        ├── Agent role
        ├── Safety rules
        ├── Escalation rules
        ├── Communication rules
        └── Tool-use rules
                │
                ▼
Knowledge Context
        │
        └── Retrieved approved documentation
                │
                ▼
Conversation Context
        │
        └── Current + previous turns
                │
                ▼
Tool Results
        │
        └── Structured business information
```

The system prompt must explicitly state that:

* Approved KB content is authoritative for general product/policy questions.
* Tool results are authoritative for supported account/transaction records.
* The model must not invent missing information.
* Tool results must not automatically be repeated verbatim.
* Escalation overrides autonomous troubleshooting.
* Guarantees must never be made.

---

# 25. Tool Selection Policy

The agent should call a tool only when the operation requires business data or an application action.

### No MCP tool required

Example:

> "What currencies does RelayPay support?"

Use KB retrieval.

### MCP required

Example:

> "Can you check transaction TXN-9001?"

Use:

```text
lookup_transaction
```

### MCP + escalation

Example:

> "Why is my payout under compliance review?"

Use:

```text
lookup_payout
```

If compliance review is confirmed:

```text
create_escalation
```

---

# 26. Ticket vs Escalation

These concepts are intentionally separate.

### Ticket

Represents a customer support issue that requires tracking/follow-up.

### Escalation

Represents a case that must be handled by human support.

A ticket may exist without escalation.

An escalation may reference an existing ticket.

Example:

```text
Failed invoice payment
        │
        ▼
Create ticket
        │
        ▼
Does human intervention require escalation?
        │
        ├── No → Ticket remains open
        │
        └── Yes → Create escalation linked to ticket
```

---

# 27. Logging and Observability

The system should make every important agent action traceable.

A typical interaction should produce:

```text
conversation
    │
    ├── turn
    ├── retrieval
    ├── tool call
    ├── tool result
    ├── escalation/ticket
    └── final turn
```

This enables evaluation of:

* What the user asked
* What knowledge was retrieved
* Which tools were used
* What the tools returned
* Why escalation occurred
* What response was generated

---

# 28. Error Handling

Errors fall into four categories.

## 28.1 User Input Error

Example:

* Missing transaction ID

Response:

Ask for the required identifier.

---

## 28.2 Not Found

Example:

```text
TXN-9999
```

does not exist.

The agent should say it could not find the transaction and request confirmation.

It must not fabricate a status.

---

## 28.3 Tool/System Failure

The agent should:

1. Log the technical error.
2. Avoid exposing implementation details.
3. Inform the user that the information could not be retrieved.
4. Escalate when appropriate.

---

## 28.4 Knowledge Failure

If the approved KB does not contain sufficient information:

```text
Do not guess
      ↓
Explain limitation
      ↓
Offer human support when appropriate
```

---

# 29. Voice-Specific Behavior

Voice responses should be concise and conversational.

Avoid:

* Long policy explanations
* Large lists
* Database identifiers unless necessary
* Raw technical errors
* Internal terminology
* Excessive disclaimers

Prefer:

* Short sentences
* Clear next steps
* One clarification question at a time
* Customer-safe summaries

Example:

Instead of:

> "Your transaction record indicates a status of `review_required`."

Prefer:

> "That transaction is currently under review."

---

# 30. Concurrency and Session Isolation

Each voice conversation must have a unique:

```text
conversation_id
```

All runtime records generated during the conversation should reference that identifier.

The backend must never use mutable global state to store conversation-specific customer information.

This prevents one customer's context from leaking into another conversation.

---

# 31. Security Boundaries

```text
                 PUBLIC
                    │
                    ▼
              Voice Client
                    │
                    ▼
                  Vapi
                    │
                    ▼
              Agent Backend
                    │
             ┌──────┴──────┐
             │             │
            KB            MCP
             │             │
             │             ▼
             │         Supabase
             │
             ▼
       Approved Content
```

Only the backend/MCP layer should access protected business data.

The browser must not contain:

* Supabase service-role credentials
* MCP credentials
* Claude API secrets
* Vapi server credentials
* database credentials

---

# 32. Environment Configuration

Sensitive configuration must be supplied through environment variables.

Example:

```env
ANTHROPIC_API_KEY=
VAPI_API_KEY=
VAPI_ASSISTANT_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
MCP_SERVER_URL=
```

Frontend-exposed variables should use the appropriate public prefix and contain no secrets.

---

# 33. Database Security

Supabase access should follow least privilege.

Recommended separation:

### Client

Public/anonymous access only to data explicitly required by the UI.

### Backend

Privileged operations.

### MCP Server

Server-side database access for business operations.

The service-role key must never be exposed to the browser or voice client.

---

# 34. Knowledge Base Security

Only approved RelayPay documents may be indexed.

Knowledge content should have:

* source identifier
* version
* approval status
* document title
* section metadata

Unapproved or arbitrary web content must not become authoritative support knowledge.

---

# 35. Evaluation Architecture

The supplied nine scenarios become automated/manual acceptance tests.

Each evaluation should record:

```text
scenario
expected_behavior
actual_behavior
pass
notes
```

The evaluation should test both:

### Functional correctness

Did the system do the required thing?

### Safety correctness

Did the system avoid doing something it should not do?

---

# 36. Acceptance Test Mapping

| Scenario           | Expected Technical Behavior                           |
| ------------------ | ----------------------------------------------------- |
| Fees               | KB retrieval → grounded answer → no invented fee      |
| Stuck payment      | Clarification → no guessed status                     |
| Customer lookup    | `lookup_customer` → safe summary                      |
| Transaction lookup | `lookup_transaction` → safe status                    |
| Payout lookup      | `lookup_payout` → compliance escalation when required |
| Failed invoice     | Clarification/reference → ticket creation             |
| Restricted account | Escalation → collect details → escalation record      |
| Guaranteed payout  | Decline guarantee → approved timeline                 |
| Voice              | Vapi → backend → response → Vapi speech → logging     |

---

# 37. Example End-to-End Flow

## Transaction Lookup

User:

> "Can you check transaction TXN-9001?"

Flow:

```text
Vapi
  ↓
Transcript
  ↓
Claude Agent
  ↓
Recognize transaction lookup
  ↓
lookup_transaction(TXN-9001)
  ↓
MCP Server
  ↓
Supabase
  ↓
Transaction result
  ↓
Claude
  ↓
Safe customer-facing summary
  ↓
Log turn/tool call
  ↓
Vapi
  ↓
Spoken response
```

---

# 38. Example Escalation Flow

User:

> "My account was restricted and nobody is helping me."

Flow:

```text
Vapi
  ↓
Claude
  ↓
Account restriction detected
  ↓
Escalation required
  ↓
Collect name/email/callback preference
  ↓
create_escalation
  ↓
Supabase
  ↓
Log escalation
  ↓
Confirm specialist follow-up
  ↓
STOP AUTOMATED TROUBLESHOOTING
```

---

# 39. Deployment Architecture

Initial deployment:

```text
┌─────────────────────────────┐
│          Vercel             │
│                             │
│  Next.js Voice Application  │
│  Agent API / Server Routes  │
└──────────────┬──────────────┘
               │
               ├──────────────► Claude
               │
               ├──────────────► MCP Server
               │
               └──────────────► Vapi
                                     
┌─────────────────────────────┐
│          Supabase           │
│                             │
│ PostgreSQL + Runtime Data   │
└─────────────────────────────┘
```

The MCP server may be deployed separately if the chosen MCP runtime requires a persistent server process.

The final deployment topology should be validated against the Claude Agent SDK runtime requirements before production deployment.

---

# 40. Project Structure

Recommended monorepo structure:

```text
relaypay-support-agent/
│
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── ...
│
├── services/
│   ├── agent/
│   │   ├── prompts/
│   │   ├── retrieval/
│   │   ├── tools/
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
└── README.md
```

The exact repository structure can be adjusted during implementation if a different deployment architecture proves more practical.

---

# 41. Testing Strategy

Testing will occur at four levels.

## Unit Tests

Test:

* MCP input validation
* MCP outputs
* retrieval logic
* escalation classification
* data transformations

## Integration Tests

Test:

* MCP → Supabase
* Agent → MCP
* Agent → retrieval
* Vapi → backend

## Agent Behavior Tests

Test:

* grounded answers
* clarification behavior
* escalation behavior
* refusal behavior
* sensitive-data handling

## End-to-End Tests

Test the complete:

```text
Voice → Agent → Retrieval/MCP → Supabase → Voice
```

workflow.

---

# 42. Acceptance Criteria

The implementation is considered technically complete when:

### Agent

* [ ] Claude Agent SDK is integrated.
* [ ] System instructions enforce RelayPay support rules.
* [ ] Agent supports all four response paths.
* [ ] Agent does not fabricate unsupported information.
* [ ] Escalation terminates autonomous troubleshooting.

### Retrieval

* [ ] Approved KB is indexed.
* [ ] Relevant content can be retrieved.
* [ ] Retrieved sources are logged.
* [ ] Responses remain grounded.

### MCP

* [ ] All six required tools are implemented.
* [ ] Inputs are validated.
* [ ] Missing records are handled safely.
* [ ] Errors are logged.
* [ ] Write operations persist to Supabase.

### Database

* [ ] Seed tables exist.
* [ ] Runtime tables exist.
* [ ] Relationships are established.
* [ ] Required runtime information is logged.

### Voice

* [ ] Vapi receives user speech.
* [ ] Agent receives transcript.
* [ ] Agent response reaches Vapi.
* [ ] Response is spoken to user.

### Security

* [ ] Secrets are server-side only.
* [ ] Sensitive information is not unnecessarily spoken.
* [ ] Internal compliance information is protected.
* [ ] Customer sessions are isolated.

### Evaluation

* [ ] All nine supplied scenarios are tested.
* [ ] Results are recorded.
* [ ] Failures include notes.
* [ ] Evidence can be included in final submission.

---

# 43. Key Design Principles

The implementation should consistently follow these principles:

### 1. Never Guess

If the system does not know, it should clarify, decline, or escalate.

### 2. Ground General Answers

Product and policy answers should come from approved RelayPay documentation.

### 3. Use Tools for Business Data

Customer, transaction, and payout information must come through controlled MCP tools.

### 4. Protect Sensitive Information

The fact that information is available internally does not mean it should be spoken to the customer.

### 5. Escalate Early When Human Judgment Is Required

Human-required cases should not be forced through an automated resolution path.

### 6. Log Important Decisions

Retrievals, tool calls, tickets, escalations, and conversation turns should be observable.

### 7. Keep the Voice Experience Simple

Voice responses should be concise, clear, and actionable.

### 8. Separate Reasoning From Execution

Claude decides what should happen.

MCP performs controlled business operations.

Supabase persists the resulting state.

---

# 44. Architecture Summary

The final architecture can be summarized as:

```text
                     RELAYPAY CUSTOMER
                            │
                            ▼
                    ┌──────────────┐
                    │     Vapi     │
                    │ Voice Layer  │
                    └──────┬───────┘
                           │
                           ▼
                 ┌───────────────────┐
                 │   Claude Agent    │
                 │                   │
                 │ Reasoning         │
                 │ Policy            │
                 │ Routing           │
                 │ Response          │
                 └───────┬───────────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
        Retrieval       MCP        Conversation
            │            │          Logging
            │            │            │
            ▼            ▼            ▼
       Approved KB   MCP Server   Supabase
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
           Customer  Transaction  Payout
           Lookup      Lookup      Lookup
              │          │          │
              └──────────┼──────────┘
                         │
                         ▼
                  Support Actions
                         │
                  ┌──────┴──────┐
                  ▼             ▼
                Ticket       Escalation
```

This architecture keeps **voice interaction, agent reasoning, business operations, knowledge grounding, and persistence clearly separated**, while providing enough observability to evaluate the production support behavior.
