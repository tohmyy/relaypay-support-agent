# Test Scenarios

Use these scenarios to test the support agent before submission.

## Scenario 1: Knowledge-Grounded Answer

User asks:

> What fees does RelayPay charge for international payments?

Expected behavior:

- Retrieve relevant fee policy from the knowledge base.
- Explain that fees depend on corridor, currency, payment method, recipient country, and account setup.
- Mention that RelayPay shows fees before confirmation.
- Avoid inventing an exact fee for a specific transaction.

## Scenario 2: Clarifying Question

User asks:

> My payment is stuck.

Expected behavior:

- Ask whether the user means an incoming transfer, outgoing payout, or invoice payment.
- Ask for a transaction reference if needed.
- Avoid guessing the payment status.

## Scenario 3: Customer Lookup

User says:

> I am Amara from LagosLedger. Can you check my account?

Expected behavior:

- Use the MCP customer lookup tool if enough identifying information is provided.
- Avoid reading sensitive details aloud.
- Summarize only safe account information.

## Scenario 4: Transaction Lookup

User says:

> Can you check transaction TXN-9001?

Expected behavior:

- Use the MCP transaction lookup tool.
- Give the customer-safe status summary.
- Avoid promising an exact arrival time beyond the record.

## Scenario 5: Payout Lookup

User says:

> What is happening with payout PAY-7002?

Expected behavior:

- Use the MCP payout lookup tool.
- Identify that the payout requires review.
- Escalate if the issue involves compliance review.

## Scenario 6: Ticket Creation

User says:

> My invoice payment failed and I need someone to look at it.

Expected behavior:

- Ask for the needed reference if missing.
- Create a support ticket through the MCP server.
- Store the ticket in Supabase.

## Scenario 7: Human Escalation

User says:

> My account was restricted and nobody is helping me.

Expected behavior:

- Escalate to human support.
- Collect name, email, and preferred callback time if needed.
- Create an escalation record.
- Avoid explaining internal compliance decisions.

## Scenario 8: Unsupported Question

User asks:

> Can RelayPay guarantee my payout arrives by 9am tomorrow?

Expected behavior:

- Decline to guarantee the outcome.
- Use approved knowledge about payout timelines.
- Escalate if the customer needs account-specific help.

## Scenario 9: Voice Flow

User asks any supported question by voice.

Expected behavior:

- Vapi captures the user speech.
- The backend agent responds.
- Vapi returns spoken audio to the user.
- Supabase logs the conversation and tool calls.
