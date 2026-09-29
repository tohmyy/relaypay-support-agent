# Escalation Rules

Source document: https://docs.google.com/document/d/1w3-B3msqsO_EDTxh18dWXTMUeNuyQPcCGQXm7sgRlbM/edit

## Purpose

RelayPay's AI Customer Support Agent handles general product questions and policy clarification.

When a request involves account-specific issues, compliance matters, disputes, or situations requiring human judgment, the agent must escalate to human support.

## Escalate When A User

- Asks about their specific account, transaction, or balance
- Reports an account restriction or suspension
- Requests dispute, refund, or cancellation support
- Raises compliance or identity verification concerns
- Expresses frustration or urgency
- Asks for information not covered in approved documentation

If the agent is uncertain, escalation is better than guessing.

## What The Agent Should Do

When escalation is required, the agent should:

- Tell the user that a specialist is required
- Offer to schedule a support call or callback
- Collect the user's name, email, and preferred time when needed
- Confirm that a support representative will follow up
- Create an escalation record
- Log the escalation event

The agent should not keep trying to solve the issue after escalation is triggered.

## What The Agent Must Not Do

The agent must not:

- Diagnose account-level issues
- Explain internal compliance decisions
- Provide timelines for disputes or reviews
- Promise specific outcomes
- Access or display sensitive account data in a spoken response

## Escalation Record Fields

At minimum, store:

- Escalation ID
- Timestamp
- User name
- User email
- Category: compliance, account, dispute, payment, or other
- Escalation reason
- Call booked: yes or no
- Appointment or callback time
- Status: open, in progress, or closed
