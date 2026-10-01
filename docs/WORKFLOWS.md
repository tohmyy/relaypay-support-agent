# Support workflows

The agent chooses a workflow from the system prompt (`services/agent/prompts/system.md`); each one is verified by a
live test in `tests/agent/workflows.live.test.ts` against the official scenarios in `assets/test-scenarios.md`.

| | Workflow | Trigger | Steps | Tools | Records left behind | Scenario | Test |
|---|---|---|---|---|---|---|---|
| A | General knowledge | General product or policy question | retrieve KB, answer from it, no invented figures | none | `retrieval_logs`, `conversation_turns` | 1 | `A:` |
| B | Clarification | Vague request | ask one useful question, wait, continue | none until a reference exists | `conversation_turns` (answer type `clarification`) | 2 | `B:` |
| C | Customer lookup | Customer identifies themselves | look up, summarize only safe information | `lookup_customer` | `tool_calls` (with conversation id) | 3 | `C:` |
| D | Transaction lookup | Transaction reference given | look up, safe status, arrival only as an estimate | `lookup_transaction` | `tool_calls` | 4 | `D:` |
| E | Payout lookup | Payout reference given | look up; normal status answered, review or compliance escalates | `lookup_payout` (then escalation tools) | `tool_calls`, escalation records if escalated | 5 | `E:` |
| F | Support ticket | Issue needing follow-up | ask for a reference if missing, create ticket, give the ticket number, continue or escalate | `create_support_ticket` | `support_tickets` (status `open`, conversation id) | 6 | `F:` |
| G | Human escalation | Restriction, dispute, refund, compliance, frustration, uncovered account question | say a specialist is needed, collect name, email and time one at a time, create ticket, escalation and event, confirm follow-up, stop troubleshooting | `create_support_ticket`, `create_escalation`, `log_conversation_event` | `escalations` (name, email, preferred time, status `open`), `conversation_events`, `tool_calls`, conversation marked `escalated` | 7 | `G:` |
| H | Unsupported request | Guarantee or anything the KB and tools do not cover | decline, share the relevant general information, offer a specialist for account-specific help | none | `retrieval_logs`, `conversation_turns` | 8 | `H:` |

Scenario 9 (voice flow) belongs to the Vapi phase.

## How records are tied to a call

Every tool call carries the conversation id. The lookup tools and `create_escalation` have no conversation field in
their specified inputs, so the agent sends it as an `X-Conversation-Id` header on the MCP connection and the MCP
server writes it into `tool_calls.conversation_id` (an id inside the tool input takes priority; malformed headers are
ignored). Retrieval logs and turns are written by the agent with the same id.

## Known limitations

- **Fee wording.** Scenario 1 lists currency, recipient country and account setup as fee factors. The approved KB says
  only transaction type, corridor and payment method, and has no fee amounts, so the agent stays with the KB.
- **Escalation records** carry the conversation id (`escalations.conversation_id`, added in Phase 9), set by the MCP
  server from the request's `X-Conversation-Id`, in addition to the link through the ticket.
- **Escalation vs ticket.** An escalation is only "raised" once `create_escalation` succeeds; until then the agent
  keeps collecting details.
- **No caller verification** beyond what the customer says; lookups are support context, not proof of identity.
