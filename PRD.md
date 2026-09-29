# Week 6 PRD: Production Customer Support Agent

## Introduction

RelayPay is a B2B SaaS company that provides cross-border payments and invoicing tools for African startups and SMEs.

Its customers use the product to send and receive international payments, issue invoices in multiple currencies, manage payouts to contractors, and reconcile transactions inside a single dashboard.

As RelayPay has grown, customer support has become harder to scale. The support team receives questions about onboarding, pricing and fees, payout timelines, failed or delayed transactions, invoicing, and compliance requirements.

Many of these questions are repetitive and documented. Others involve account-specific issues, payment status, compliance, disputes, or customer frustration, so the agent must handle them with care.

Your task is to build a production-style customer support agent that can handle first-line support, retrieve approved knowledge, use support tools through MCP, create tickets or escalations when needed, and log its work for review.

The voice experience should use **Vapi**. A web voice interface is required. A phone number is optional if your Vapi account supports it.

The backend support agent must use **Claude Agent SDK**. Vapi should handle the voice layer. The Agent SDK should handle the support agent logic.

You are required to build an **MCP server** for the support tools. Use [MCP tool requirements](assets/mcp-tool-requirements.md) as the spec, but implement the server, tool logic, and business data flow yourself.

Use **Supabase** for two types of data. First, load the provided seed records for customers, transactions, and payouts from `assets/seed-data/`. Second, store the records your system creates while it runs: support tickets, escalations, conversation logs, retrieval logs, tool-call logs, and evaluation results. Use [Supabase schema and seed-data guide](assets/supabase-schema-and-seed-data.md) as the table guide.

All answers should be grounded in the approved [RelayPay knowledge base](assets/relaypay-knowledge-base.md). The agent should answer directly when the information is available, ask clarifying questions when the request is unclear, escalate when human support is required, and decline when it cannot answer safely.

## Project Objective

Build a support system where a customer can speak to an AI support agent and receive a spoken response.

The system should:

- Use Vapi for the voice interface
- Use Claude Agent SDK for the backend agent
- Retrieve approved RelayPay support knowledge before answering product or policy questions
- Use a custom-built MCP server for customer lookup, transaction lookup, payout lookup, ticket creation, escalation, and logging
- Load the provided customer, transaction, and payout seed data into Supabase
- Store conversations, tool calls, retrieved knowledge, tickets, escalations, and evaluation results in Supabase
- Ask clarifying questions when the customer request is vague
- Escalate account-specific, compliance, dispute, refund, cancellation, or frustrated-customer cases
- Refuse or decline gracefully when the answer is not supported by approved knowledge
- Keep sensitive data out of spoken responses unless the user has provided enough context and the action is safe

## Supabase Records

Your Supabase database should make the agent's work visible enough to review, debug, and test.

At minimum, store:

- **Conversation records**: conversation ID, channel, caller or user identifier, start time, end time, final status, and summary
- **Turn records**: user transcript, assistant response, answer type, timestamp, and confidence or uncertainty note
- **Retrieval records**: query, knowledge chunks used, source title, and source summary
- **Tool-call records**: MCP tool name, purpose, input summary, result summary, status, error message if any, and timestamp
- **Ticket records**: category, priority, summary, related customer or transaction if any, status, and timestamp
- **Escalation records**: escalation reason, category, user contact details, appointment or callback request, status, and timestamp
- **Evaluation records**: test scenario, expected behavior, actual behavior, pass or fail, and notes

## Testing

Use the [test scenarios](assets/test-scenarios.md) to validate your build before submission.

Your testing should cover:

1. **Knowledge-Grounded Answer**: A general product or policy question should be answered using approved knowledge.

2. **Clarifying Question**: A vague payment or payout issue should trigger a clarifying question before the agent gives an answer.

3. **Customer Lookup**: An account-specific request should use the MCP customer lookup tool when enough safe information is provided.

4. **Transaction or Payout Lookup**: A transaction-specific request should use the relevant MCP lookup tool and avoid guessing.

5. **Ticket Creation**: A support issue should create a ticket through the MCP server and store it in Supabase.

6. **Human Escalation**: A compliance, dispute, account restriction, refund, cancellation, or frustrated-customer case should create an escalation record.

7. **Unsupported Question**: If the knowledge base does not support the answer, the agent should say it cannot confidently answer or escalate.

8. **Voice Flow**: The customer should be able to ask a question by voice and receive a spoken response.

9. **Logging**: Supabase should contain conversation, retrieval, MCP tool-call, ticket, escalation, and evaluation records that match the test run.

Submit the completed testing evidence table from the project page with your project.

## Deliverables

Submit the following:

- A working **voice interface link**
- An optional **phone number** if you chose to add phone calling
- Your **MCP server implementation**, submitted as a repository link, code folder, or deployed endpoint with setup instructions
- Completed **testing evidence**
- A short **Loom video** showing the support agent in action
- Answer the questions in your **reflection sheet** for this project
- A **one-page document** explaining how your system works and how to use it

## Resources

Use the local assets in this folder first:

- [RelayPay knowledge base](assets/relaypay-knowledge-base.md)
- [Brand direction](assets/brand-direction.md)
- [Support decision rules](assets/support-decision-rules.md)
- [Escalation rules](assets/escalation-rules.md)
- [MCP tool requirements](assets/mcp-tool-requirements.md)
- [Supabase schema and seed-data guide](assets/supabase-schema-and-seed-data.md)
- [Test scenarios](assets/test-scenarios.md)

Use the resources below while designing and building your system:

**Voice interface**

- [Vapi web calls](https://docs.vapi.ai/quickstart/web)
- [Vapi server URLs](https://docs.vapi.ai/server-url/)
- [Setting Vapi server URLs](https://docs.vapi.ai/server-url/setting-server-urls)
- [Vapi custom tools](https://docs.vapi.ai/tools/custom-tools)
- [Vapi debugging guide](https://docs.vapi.ai/debugging)
- [Vapi phone calling](https://docs.vapi.ai/phone-calling)

**Claude Agent SDK**

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)
- [Give Claude custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools)
- [Connect to external tools with MCP](https://code.claude.com/docs/en/agent-sdk/mcp)
- [Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)

**MCP server**

- [MCP documentation](https://modelcontextprotocol.io/docs)
- [MCP TypeScript SDK server docs](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/)
- [MCP TypeScript SDK GitHub repo](https://github.com/modelcontextprotocol/typescript-sdk)

**Supabase and retrieval**

- [Supabase database overview](https://supabase.com/docs/guides/database/overview)
- [Supabase JavaScript client](https://supabase.com/docs/reference/javascript/introduction)
- [Supabase AI and Vectors](https://supabase.com/docs/guides/ai)
- [Supabase vector columns](https://supabase.com/docs/guides/ai/vector-columns)
- [Securing your Supabase API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
