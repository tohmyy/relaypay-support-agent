# RelayPay Production Customer Support Agent

## UI Specification

**Version:** 1.0
**Status:** Draft / Implementation Ready
**Product:** RelayPay Customer Support Agent
**Primary Experience:** Voice-first customer support web application

---

# 1. Overview

The RelayPay Customer Support Agent is a voice-first support experience designed for RelayPay customers who need help with payments, payouts, invoices, account issues, compliance-related questions, and general product information.

The interface should feel like a **professional fintech support console**, not a traditional chatbot.

The primary interaction is voice.

The UI exists to:

* Clearly communicate the current voice state.
* Make it obvious when RelayPay is listening.
* Make it obvious when the agent is processing.
* Make it obvious when the agent is speaking.
* Provide useful supporting context without overwhelming the user.
* Give the customer control over the conversation.
* Clearly communicate when human support is required.
* Provide graceful handling of connection and system errors.

The experience should remain calm and trustworthy even when the customer is discussing failed payments, restricted accounts, or other potentially stressful issues.

---

# 2. Design Principles

## 2.1 Voice First

The primary interaction should be voice.

The interface should not require customers to read a long chat transcript or navigate through complex controls to receive support.

The main action should always be obvious:

> Talk to RelayPay Support.

---

## 2.2 Calm and Trustworthy

Financial support interactions require a high level of trust.

The interface should use:

* Clear hierarchy
* Generous spacing
* Restrained color usage
* Familiar interaction patterns
* Clear system states
* Minimal visual noise

Avoid visual patterns that make the application feel experimental or entertainment-oriented.

---

## 2.3 Context Without Overload

The UI should provide enough information to help the customer understand what is happening without turning the interface into an operations dashboard.

The customer should not need to understand:

* MCP
* Agent reasoning
* Retrieval
* Tool calls
* Internal compliance systems
* Database state

Technical operations remain invisible.

---

## 2.4 Human Support Should Feel Like a Normal Next Step

Escalation should not feel like an application failure.

When human support is required, the UI should communicate:

* Why a specialist is needed at a high level.
* What happens next.
* Whether contact information is required.
* Whether a callback has been requested.

The customer should feel that the support process is continuing, rather than that the system has stopped working.

---

# 3. Brand Direction

The UI follows the RelayPay brand direction supplied for the project.

## 3.1 Brand Character

The visual language should communicate:

* Professional
* Reliable
* Modern
* Financial
* Secure
* Calm
* Efficient
* Human

The interface should avoid:

* Playful visual language
* Excessive decoration
* Bright/neon colors
* Heavy gradients
* Excessive shadows
* Overly rounded "AI chatbot" aesthetics
* Large decorative illustrations
* Excessive animation
* Emoji-based status communication

---

# 4. Color System

The brand palette should use the RelayPay-defined deep blue, teal-blue accent, and off-white/light-grey surfaces.

The exact brand color values should be taken from the approved brand design rather than independently invented in the UI implementation.

Conceptual roles:

| Token          | Purpose                               |
| -------------- | ------------------------------------- |
| Primary        | Primary RelayPay actions and branding |
| Primary Hover  | Hover/pressed state                   |
| Accent         | Voice activity and secondary emphasis |
| Background     | Main application background           |
| Surface        | Cards and elevated content            |
| Surface Subtle | Secondary sections                    |
| Text Primary   | Main text                             |
| Text Secondary | Supporting text                       |
| Text Muted     | Metadata/helper text                  |
| Border         | Dividers and component boundaries     |
| Success        | Successful operations                 |
| Warning        | Attention/review states               |
| Error          | Errors and failed operations          |
| Info           | Informational states                  |

Color should communicate state rather than decorate the interface.

---

# 5. Typography

Use **Inter or the approved RelayPay system font**.

Typography should prioritize:

* Readability
* Clear hierarchy
* Moderate weight variation
* Comfortable line height

Avoid:

* Decorative fonts
* Excessive font weights
* Oversized marketing typography
* Monospace typography in customer-facing UI

Recommended hierarchy:

```text
Page title
    ↓
Section heading
    ↓
Supporting text
    ↓
Body text
    ↓
Metadata / helper text
```

---

# 6. Application Layout

The primary experience should use a **single focused support workspace**.

Recommended desktop structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ RelayPay                                      Support       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                                                             │
│                  Support workspace                          │
│                                                             │
│              ┌─────────────────────┐                        │
│              │                     │                        │
│              │   Voice interface   │                        │
│              │                     │                        │
│              └─────────────────────┘                        │
│                                                             │
│                    Status text                              │
│                                                             │
│                ───────────────                              │
│                                                             │
│                 [ Voice Control ]                           │
│                                                             │
│                                                             │
│          Supporting conversation context                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The experience should not feel like a conventional multi-page SaaS dashboard.

The customer comes to the application primarily to **have a support conversation**.

---

# 7. Header

The header should be minimal.

### Left

RelayPay logo/wordmark.

### Right

A small contextual support label such as:

> Customer Support

Optional secondary actions may include:

* Help
* Privacy
* End conversation

These should not compete with the primary voice interaction.

The header should remain visually lightweight.

---

# 8. Main Support Workspace

The central workspace contains the primary voice experience.

It should have three conceptual areas:

```text
┌───────────────────────────────┐
│                               │
│      Conversation status      │
│                               │
│       Voice visualizer        │
│                               │
│       Current state           │
│                               │
│       Primary control         │
│                               │
└───────────────────────────────┘
```

The voice experience should remain visually centered on desktop.

---

# 9. Voice Visualizer

A visual representation of voice activity should be used.

Its purpose is to communicate state rather than act as decoration.

The visualizer should respond to:

* Listening
* User speaking
* Processing
* Assistant speaking

The visualizer should remain restrained.

Avoid:

* Large animated blobs
* Aggressive waveform animations
* Full-screen reactive effects
* Constant motion when nothing is happening

---

# 10. Voice States

The interface must clearly distinguish the following states.

## 10.1 Idle

Displayed before a conversation begins.

Example:

> Ready to help

Primary action:

> Start conversation

---

## 10.2 Connecting

Displayed while establishing the Vapi session.

Example:

> Connecting to RelayPay Support…

The primary control should be temporarily disabled.

---

## 10.3 Listening

Displayed when the system is waiting for the customer to speak.

Example:

> Listening…

The visualizer should indicate that the microphone is active.

---

## 10.4 User Speaking

Displayed while speech is being captured.

Example:

> Listening…

The voice visualizer responds to speech activity.

---

## 10.5 Processing

Displayed after the customer stops speaking while the agent processes the request.

Example:

> Thinking…

Avoid exposing technical terms such as:

> Running MCP tool…

or:

> Retrieving embeddings…

---

## 10.6 Assistant Speaking

Displayed while Vapi is speaking the response.

Example:

> RelayPay Support is responding…

The customer should understand that they can listen rather than speak over the response.

---

## 10.7 Waiting for User

After the assistant finishes speaking:

> How can I help further?

or another contextually appropriate prompt.

---

## 10.8 Error

If the voice connection fails:

> We couldn't connect to RelayPay Support.

Provide:

* Retry
* Alternative support instruction where appropriate

Do not expose technical error messages.

---

## 10.9 Ending

When the customer ends the conversation:

> Ending your support session…

Then transition to the completion state.

---

# 11. Primary Voice Control

The main control should be visually prominent but not oversized.

Recommended behavior:

### Before conversation

```text
[ Start conversation ]
```

### During active conversation

```text
[ End conversation ]
```

### During connection

```text
[ Connecting… ]
```

The primary control should have clear:

* Hover
* Focus
* Pressed
* Disabled

states.

---

# 12. Microphone Permission

If microphone permission is unavailable, display a clear explanation.

Example:

> Microphone access is required to use voice support.

Provide an appropriate action such as:

> Allow microphone access

If the browser has permanently blocked access, explain how the customer can re-enable it without exposing browser-specific technical terminology unless necessary.

---

# 13. Conversation Context

Although the product is voice-first, a lightweight transcript/context panel should be available.

Recommended desktop layout:

```text
┌─────────────────────────────────────────────────────────────┐
│                     Voice workspace                         │
│                                                             │
│                      Voice UI                               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Conversation                                                │
│                                                             │
│ You                                                          │
│ My payout is delayed.                                       │
│                                                             │
│ RelayPay Support                                            │
│ I can help check that. Do you have the payout reference?   │
└─────────────────────────────────────────────────────────────┘
```

The transcript should support comprehension and accessibility without becoming the primary interaction model.

---

# 14. Transcript Design

Transcript messages should be visually differentiated by speaker.

### Customer

Label:

> You

### Assistant

Label:

> RelayPay Support

> **Amended by Build Plan V3 (concern 14, V3.11).** The live transcript now renders **one chat bubble per turn**: the customer's
> on the right, RelayPay Support's on the left, each with its speaker label. It matches the saved-transcript view
> (`TranscriptView`), so what the customer sees live is what they find in their history. Keep the bubbles calm (no avatars,
> no tails, no animation); the transcript is still secondary to the voice interaction.

Each turn may contain:

* Speaker
* Message
* Timestamp, if useful

---

# 15. Transcript Behavior

The transcript should:

* Automatically scroll to the latest turn.
* Preserve the conversation during the active session.
* Avoid jumping unexpectedly while the user is reading.
* Support keyboard navigation.
* Remain readable on smaller screens.

The current/latest assistant response may receive subtle visual emphasis.

---

# 16. Supporting Information

The UI may display lightweight contextual information below or beside the voice interface.

Examples:

> General support
> Payments · Payouts · Invoices · Account help

or:

> You can ask about payments, payouts, invoices, fees, and account support.

This should help first-time users understand what the agent can do.

---

# 17. Capability Presentation

Capabilities should be communicated using plain language.

Recommended:

```text
You can ask about:

Payments
Payouts
Invoices
Fees
Account support
```

Avoid:

```text
✓ RAG
✓ MCP tools
✓ Transaction lookup
✓ Agentic workflows
```

The customer should understand the product's capabilities, not its architecture.

---

# 18. Suggested Prompts

Suggested prompts may appear before the conversation begins.

Examples:

* "How much are international payment fees?"
* "What is the status of my payout?"
* "How long do international payouts take?"
* "I need help with a failed payment."

These are optional and should disappear or reduce prominence once the conversation begins.

---

# 19. Account-Specific Support

When a user requests account-specific assistance, the UI should not expose internal data by default.

For example, after a transaction lookup the UI may show:

> Transaction status: Processing

rather than exposing the raw transaction record.

The same customer-safe response spoken by the agent may also appear in the transcript.

---

# 20. Sensitive Information

The UI must follow the same privacy principles as the voice layer.

Do not display:

* Identity documents
* Internal compliance notes
* Internal risk assessments
* Confidential thresholds
* Internal decision logic
* Sensitive information belonging to other customers

Even if such information exists in the backend.

---

# 21. Ticket Creation State

When a support ticket is created, the UI should provide a concise confirmation.

Example:

> **Support request created**
>
> Your issue has been submitted to RelayPay Support.

Optional:

> Reference: TKT-1234

The ticket ID should only be shown if appropriate.

Avoid exposing internal ticket metadata.

---

# 22. Escalation Experience

Escalation should use a dedicated, clearly understandable state.

Example:

```text
┌─────────────────────────────────────┐
│                                     │
│       A support specialist          │
│       needs to assist you           │
│                                     │
│  We'll collect a few details so    │
│  the team can follow up with you.  │
│                                     │
│  Name                               │
│  [________________________]         │
│                                     │
│  Email                              │
│  [________________________]         │
│                                     │
│  Preferred callback time            │
│  [________________________]         │
│                                     │
│       [ Request support ]           │
│                                     │
└─────────────────────────────────────┘
```

The form should only request information necessary for the escalation.

---

# 23. Escalation Confirmation

After successful escalation:

> **Your request has been sent to RelayPay Support.**

Supporting text:

> A support specialist will follow up using the contact information you provided.

If a callback time was requested:

> Requested callback: Tuesday at 2:00 PM

The UI must not promise that the callback will definitely occur at a particular time unless the system actually supports confirmed scheduling.

---

# 24. Unsupported Request

When the agent cannot safely answer a request, the UI should remain neutral.

The transcript may show:

> I don't have enough approved information to answer that accurately. I can connect you with RelayPay Support if you'd like.

Do not show:

> AI confidence: 42%

or:

> Knowledge retrieval failed.

Internal reasoning should remain hidden.

---

# 25. Guarantee/Promise Handling

For requests such as:

> "Can you guarantee my payout arrives by 9am?"

The interface should support a response such as:

> RelayPay can't guarantee an exact payout time. International payouts typically take 2–5 business days depending on the destination and banking partners.

The UI should not use warning styling simply because a guarantee cannot be provided.

This is normal support behavior, not an application error.

---

# 26. Loading States

Loading states should be lightweight.

Examples:

> Connecting…

> Preparing your support session…

> Checking your request…

> One moment…

Avoid technical loading messages such as:

> Initializing Claude Agent SDK

> Querying Supabase

> Calling MCP server

---

# 27. Error States

Errors should be categorized from the customer's perspective.

## Connection Error

> We couldn't connect to RelayPay Support.

Action:

> Try again

## Microphone Error

> We can't access your microphone.

Action:

> Check microphone access

## Temporary Service Error

> Something went wrong while processing your request.

Action:

> Try again

## Tool/Data Retrieval Error

The customer should receive a safe response such as:

> I couldn't retrieve that information right now. I can help you contact RelayPay Support.

Technical details should only appear in developer logs.

---

# 28. End Conversation

Ending a conversation should require deliberate interaction.

Recommended:

> End conversation

For an active session, the user may be asked for confirmation if accidental termination is likely.

After ending:

```text
Conversation ended

Thank you for contacting RelayPay Support.

[Start another conversation]
```

If a ticket or escalation was created, the completion state can acknowledge that.

---

# 29. Mobile Layout

The experience should adapt to a single-column mobile layout.

```text
┌─────────────────────────┐
│ RelayPay       Support  │
├─────────────────────────┤
│                         │
│                         │
│      Voice visualizer   │
│                         │
│       Listening…        │
│                         │
│   [ End conversation ]  │
│                         │
├─────────────────────────┤
│ Conversation            │
│                         │
│ You                     │
│ My payout is delayed.   │
│                         │
│ RelayPay Support        │
│ I can help with that.   │
│                         │
└─────────────────────────┘
```

The voice control should remain accessible without requiring scrolling.

---

# 30. Desktop Layout

Desktop should use the additional horizontal space for supporting context rather than enlarging the voice control excessively.

Recommended:

```text
┌─────────────────────────────────────────────────────────────┐
│ RelayPay                                    Customer Support │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│                              │      Conversation            │
│       Voice Workspace        │                              │
│                              │      You                     │
│       Voice Visualizer       │      ...                     │
│                              │                              │
│       Listening...           │      RelayPay Support        │
│                              │      ...                     │
│       [ End conversation ]   │                              │
│                              │                              │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

The transcript panel should remain secondary to the voice workspace.

---

# 31. Responsive Breakpoints

Use the project's Tailwind breakpoint system.

Recommended behavior:

### Mobile

* Single column
* Compact header
* Voice interface first
* Transcript below
* Full-width controls

### Tablet

* Single primary workspace
* Optional transcript section
* Increased spacing

### Desktop

* **One column** (amended by Build Plan V3, concern 11, V3.11): the voice panel and status notices on top, the conversation
  underneath, each at full width. The old two-column workspace (voice left, transcript right) left both panes short.
* Voice interface as primary
* Transcript as secondary, scrolling inside its own region (it sticks to the newest turn unless the customer scrolls up)

### Large Desktop

Do not excessively stretch the content.

Use a reasonable maximum content width.

---

# 32. Accessibility

The application must support accessible voice and visual interaction.

Requirements:

* Keyboard-accessible controls
* Visible focus states
* Semantic HTML
* Proper button labels
* Sufficient text contrast
* Screen-reader labels for voice states
* Do not rely solely on color to communicate state
* Reduced-motion support
* Clear error messaging
* Accessible form labels
* Logical tab order

Voice state should have an accessible textual representation.

For example:

```text
Voice status: Listening
```

rather than relying only on animation.

---

# 33. Reduced Motion

Users who prefer reduced motion should receive a simplified visual experience.

For example:

Normal:

```text
Animated voice activity
```

Reduced motion:

```text
Static voice activity indicator
```

The interface must remain fully understandable without animation.

---

# 34. Animation

Animation should be purposeful.

Appropriate:

* Subtle voice activity response
* State transitions
* Button feedback
* Transcript appearance
* Connection state changes

Avoid:

* Continuous decorative animation
* Large-scale page transitions
* Excessive bouncing
* Pulsing elements unrelated to active voice state

Animation should reinforce system state.

---

# 35. Iconography

Use a consistent professional icon set such as Lucide.

Potential icons:

| Action/State     | Icon                  |
| ---------------- | --------------------- |
| Microphone       | Mic                   |
| End conversation | PhoneOff              |
| Listening        | Audio/Waves           |
| Processing       | Loader                |
| Success          | Check                 |
| Warning          | AlertTriangle         |
| Error            | AlertCircle           |
| Support          | Headset               |
| Callback         | Calendar/Clock        |
| Settings/help    | Settings / HelpCircle |

Icons should supplement labels rather than replace them for important actions.

---

# 36. Forms

Forms should only appear when required.

Examples:

* Escalation contact information
* Callback preference

Forms should use:

* Clear labels
* Inline validation
* Helpful error messages
* Appropriate input types
* Minimal required fields

Avoid unnecessarily asking the user to fill out information that the conversation already established.

---

# 37. Notifications

Use restrained notifications.

Examples:

### Success

> Support request created.

### Error

> We couldn't complete that request. Please try again.

### Informational

> A support specialist will need to assist with this issue.

Notifications should not interrupt the voice interaction unnecessarily.

---

# 38. Visual Hierarchy

The hierarchy should generally be:

```text
RelayPay identity
        ↓
Current support state
        ↓
Voice interaction
        ↓
Primary action
        ↓
Conversation context
        ↓
Secondary information
```

The customer should always be able to identify:

1. Where they are.
2. What the system is doing.
3. What they can do next.

---

# 39. Component Inventory

Recommended React component structure:

```text
SupportPage
├── Header
│   ├── RelayPayLogo
│   └── SupportLabel
│
├── SupportWorkspace
│   ├── VoicePanel
│   │   ├── VoiceStatus
│   │   ├── VoiceVisualizer
│   │   ├── VoicePrompt
│   │   └── VoiceControl
│   │
│   └── ConversationPanel
│       ├── ConversationHeader
│       ├── ConversationTranscript
│       └── ConversationTurn
│
├── CapabilityHints
│
├── EscalationPanel
│   ├── EscalationExplanation
│   ├── ContactForm
│   └── EscalationConfirmation
│
├── ErrorState
│
└── ConversationComplete
```

---

# 40. Voice State Model

The frontend should maintain a clear state model.

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

The UI should render from this state rather than independently inferring state in multiple components.

---

# 41. Support Workflow State

The application may separately track support workflow state:

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

This should remain separate from the low-level Vapi voice state.

For example:

```text
Voice state:
assistant-speaking

Support state:
escalation-required
```

The voice may still be communicating the escalation instructions while the application is preparing the escalation UI.

---

# 42. Design System Structure

The implementation should organize reusable design tokens into:

```text
tokens
├── colors
├── typography
├── spacing
├── radius
├── shadows
├── borders
├── motion
└── breakpoints
```

These should map cleanly into the project's Tailwind theme.

---

# 43. Spacing

The layout should use a consistent spacing scale.

Prioritize:

* Generous outer spacing
* Comfortable text spacing
* Clear separation between primary and secondary content
* Adequate touch targets

Avoid tightly packed dashboard layouts.

---

# 44. Borders and Shadows

Use borders and subtle elevation to distinguish surfaces.

Prefer:

```text
subtle border
+
light surface contrast
```

over:

```text
heavy shadow
+
large rounded card
```

The overall visual style should remain light and professional.

---

# 45. Border Radius

Use moderate corner radii.

Buttons, inputs, cards, and panels should feel modern without becoming excessively rounded.

Avoid the "everything is a pill" design pattern.

---

# 46. Empty State

Before a conversation starts:

```text
How can we help?

Talk to RelayPay Support about payments,
payouts, invoices, fees, or account support.

[ Start conversation ]
```

Optional suggested questions can appear beneath the primary action.

---

# 47. Initial Landing Experience

The initial page should require minimal cognitive effort.

The customer should immediately see:

* RelayPay identity
* Support purpose
* Start conversation action
* What topics are supported

No dashboard navigation should be required before starting a support session.

---

# 48. Conversation Completion

After a successful conversation:

```text
Support session complete

Is there anything else you need help with?

[ Start another conversation ]
```

If appropriate:

```text
Your support request has been created.
Reference: TKT-1234
```

The UI should avoid forcing a rating/review flow unless that becomes a later product requirement.

---

# 49. Customer-Facing Language

The UI should use plain, professional language.

Prefer:

> Support specialist

over:

> Human escalation agent

Prefer:

> Checking your request

over:

> Executing support workflow

Prefer:

> We couldn't retrieve that information

over:

> MCP request failed

Prefer:

> Your transaction is under review

over:

> `status = review_required`

---

# 50. Design Anti-Patterns

The implementation should explicitly avoid:

### Chatbot-heavy UI

The product should not resemble a generic AI chat application.

### AI branding

Avoid prominently marketing the experience as an "AI agent."

The customer is interacting with:

> RelayPay Support

### Developer-facing information

Never display:

* Tool names
* Model names
* Retrieval scores
* Prompt information
* Database IDs unrelated to the customer's support case
* API errors

### Excessive decoration

No unnecessary:

* Gradients
* Floating shapes
* Decorative illustrations
* Animated backgrounds
* Neon highlights

---

# 51. Performance

The UI should prioritize fast initial rendering and quick voice-session startup.

Requirements:

* Avoid unnecessary client-side JavaScript.
* Lazy-load non-critical functionality.
* Do not block initial rendering on unnecessary backend requests.
* Keep visual animations lightweight.
* Avoid large decorative assets.

The voice connection should be established only when the user initiates a support session unless there is a specific reason to initialize it earlier.

---

# 52. Privacy UX

The initial interface should communicate that the customer is using a voice support system.

A concise notice may be provided:

> Voice conversations may be recorded and logged to provide and improve support.

The exact wording should follow the project's privacy/consent requirements.

The notice should not dominate the page.

---

# 53. Browser Support

The application should target modern versions of:

* Chrome
* Edge
* Safari
* Firefox

Voice functionality should gracefully handle browsers where microphone permissions or required APIs are unavailable.

---

# 54. UI Acceptance Criteria

The UI is considered complete when:

### Core

* [ ] RelayPay branding is correctly applied.
* [ ] Initial support state is clear.
* [ ] Start conversation is obvious.
* [ ] Voice state is always visible.
* [ ] User can end a conversation.
* [ ] Transcript is available.
* [ ] Desktop and mobile layouts work.

### Voice States

* [ ] Idle
* [ ] Connecting
* [ ] Listening
* [ ] User speaking
* [ ] Processing
* [ ] Assistant speaking
* [ ] Ending
* [ ] Ended
* [ ] Error

### Support States

* [ ] Normal support
* [ ] Clarification
* [ ] Ticket created
* [ ] Escalation required
* [ ] Escalation form
* [ ] Escalation confirmation
* [ ] Completion

### Accessibility

* [ ] Keyboard navigation works.
* [ ] Focus states are visible.
* [ ] Voice state has textual representation.
* [ ] Reduced motion is supported.
* [ ] Color is not the only state indicator.
* [ ] Forms are accessible.

### Privacy

* [ ] No sensitive internal information is displayed.
* [ ] Technical errors are not exposed.
* [ ] Customer-facing responses use safe language.
* [ ] Privacy/voice notice is presented appropriately.

---

# 55. Final Experience

The intended experience is:

```text
                    RELAYPAY
                Customer Support

             How can we help?

          Talk to RelayPay Support
        about payments, payouts,
          invoices, or account help.

             ┌─────────────┐
             │             │
             │    Voice    │
             │             │
             └─────────────┘

                 Ready to help

             [ Start conversation ]

          Payments · Payouts · Invoices
                 Fees · Accounts
```

Once active:

```text
                    RELAYPAY
                Customer Support

                    Listening…

                 ~ voice UI ~

              [ End conversation ]

────────────────────────────────────────────

Conversation

You
Can you check my payout?

RelayPay Support
Sure. What's the payout reference?

────────────────────────────────────────────
```

The experience should feel **focused, trustworthy, calm, and purpose-built for financial support**, while keeping the complexity of the underlying AI, MCP, retrieval, and database architecture invisible to the customer.

---

# 56. Implementation Principle

The UI should never dictate how the backend works.

The frontend communicates:

```text
customer intent
       ↓
voice interaction
       ↓
support state
       ↓
customer-facing result
```

The underlying implementation remains responsible for:

```text
Claude
   ↓
Knowledge Retrieval
   ↓
MCP
   ↓
Supabase
   ↓
Observability
```

This separation allows the support experience to evolve without coupling the visual interface to internal agent architecture.
