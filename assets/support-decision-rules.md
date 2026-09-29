# Support Decision Rules

Source document: https://docs.google.com/document/d/1wdTPoH-mYjJcTJ0o__IwIZ89qwfAs71VRAmrlkiNfRI/edit

The agent should choose one of four response paths for each customer request.

## 1. Answer Directly

Use this path when:

- The question is general
- The answer exists in approved documentation
- No sensitive or account-specific information is required

Example:

> What are RelayPay's international transfer fees?

## 2. Ask a Clarifying Question

Use this path when:

- The question is vague
- Multiple interpretations are possible
- The agent needs one more detail before choosing the right support path

Example:

> My payment is stuck.

Possible response:

> Can you clarify whether this is an outgoing payout or an incoming transfer?

## 3. Escalate To Human Support

Use this path when:

- The question involves account access
- Compliance or identity verification is required
- The user is frustrated or reporting a serious issue
- The answer would require human judgment

Example:

> My account was suspended and I do not know why.

## 4. Decline Gracefully

Use this path when:

- The system cannot retrieve enough approved context
- The documentation does not cover the topic
- Answering would require guessing

Example:

> Can you tell me exactly when my payment will arrive?

If a relevant lookup tool can answer the question safely, use the tool. If not, decline or escalate.
