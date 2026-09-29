# MCP Tool Requirements

Students must build the MCP server for this project. This document defines the required tool behavior. It is not an implementation.

The MCP server should connect the Claude Agent SDK support agent to the RelayPay seed data and support tables in Supabase.

## Required Tools

### `lookup_customer`

Use this tool when the user provides enough safe identifying information to find a customer record.

Input:

```json
{
  "customer_id": "optional",
  "email": "optional",
  "company_name": "optional"
}
```

Output:

```json
{
  "found": true,
  "customer_id": "",
  "company_name": "",
  "plan": "",
  "account_status": "",
  "kyc_status": "",
  "support_notes": ""
}
```

### `lookup_transaction`

Use this tool when the user asks about a transaction and provides a transaction reference.

Input:

```json
{
  "transaction_id": ""
}
```

Output:

```json
{
  "found": true,
  "transaction_id": "",
  "customer_id": "",
  "type": "",
  "status": "",
  "amount": "",
  "currency": "",
  "estimated_arrival": "",
  "support_summary": ""
}
```

### `lookup_payout`

Use this tool when the user asks about a contractor payout or payout schedule.

Input:

```json
{
  "payout_id": "optional",
  "transaction_id": "optional"
}
```

Output:

```json
{
  "found": true,
  "payout_id": "",
  "status": "",
  "scheduled_for": "",
  "failure_reason": "",
  "support_summary": ""
}
```

### `create_support_ticket`

Use this tool when the agent needs to log an issue for support follow-up.

Input:

```json
{
  "customer_id": "optional",
  "category": "",
  "priority": "",
  "summary": "",
  "conversation_id": ""
}
```

Output:

```json
{
  "ticket_id": "",
  "status": "open"
}
```

### `create_escalation`

Use this tool when the request requires human support.

Input:

```json
{
  "ticket_id": "optional",
  "customer_id": "optional",
  "user_name": "",
  "user_email": "",
  "category": "",
  "reason": "",
  "preferred_time": "optional"
}
```

Output:

```json
{
  "escalation_id": "",
  "status": "open",
  "follow_up_summary": ""
}
```

### `log_conversation_event`

Use this tool to log important agent actions and decisions.

Input:

```json
{
  "conversation_id": "",
  "event_type": "",
  "summary": "",
  "metadata": {}
}
```

Output:

```json
{
  "logged": true
}
```

## Tool Rules

- Tools should return structured data.
- Tools should handle missing records without crashing.
- Tools should never expose secrets.
- Tools should log failed calls with enough detail to debug.
- Tools that create tickets or escalations should write to Supabase.
- The agent should use tools only when the request requires business data or an action.
