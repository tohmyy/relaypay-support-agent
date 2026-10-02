// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationTranscript from '@/components/ConversationTranscript';
import ErrorState from '@/components/ErrorState';
import EscalationPanel from '@/components/EscalationPanel';
import SupportWorkspace, { type WorkspaceProps } from '@/components/SupportWorkspace';
import VoiceControl from '@/components/VoiceControl';
import VoiceStatus from '@/components/VoiceStatus';
import VoiceVisualizer from '@/components/VoiceVisualizer';
import { COPY, VOICE_STATUS } from '@/lib/copy';
import type { ConversationTurn } from '@/lib/transcript';
import type { ErrorKind, VoiceState } from '@/lib/voice/state';

afterEach(cleanup);

// jsdom has no layout, so scrolling helpers are stubbed.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});

const turn = (id: number, speaker: 'user' | 'assistant', text: string, final = true): ConversationTurn => ({
  id,
  speaker,
  text,
  final,
  timestamp: 0,
});

describe('VoiceControl', () => {
  const labels: [VoiceState, string, boolean][] = [
    ['idle', COPY.buttons.start, false],
    ['connecting', COPY.buttons.connecting, true],
    ['listening', COPY.buttons.end, false],
    ['user-speaking', COPY.buttons.end, false],
    ['processing', COPY.buttons.end, false],
    ['assistant-speaking', COPY.buttons.end, false],
    ['ending', COPY.buttons.end, true],
    ['ended', COPY.buttons.startAnother, false],
    ['error', COPY.buttons.tryAgain, false],
  ];

  it.each(labels)('in %s shows "%s" (disabled: %s)', (state, label, disabled) => {
    render(<VoiceControl state={state} onStart={() => {}} onEnd={() => {}} />);
    const button = screen.getByRole('button', { name: label });
    expect((button as HTMLButtonElement).disabled).toBe(disabled);
  });

  it('starts from idle and ends from an active call', async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<VoiceControl state="idle" onStart={onStart} onEnd={onEnd} />);
    await user.click(screen.getByRole('button', { name: COPY.buttons.start }));
    rerender(<VoiceControl state="listening" onStart={onStart} onEnd={onEnd} />);
    await user.click(screen.getByRole('button', { name: COPY.buttons.end }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('cannot start when voice support is unavailable', () => {
    render(<VoiceControl state="idle" onStart={() => {}} onEnd={() => {}} unavailable />);
    expect((screen.getByRole('button', { name: COPY.buttons.start }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('VoiceStatus', () => {
  it.each(Object.keys(VOICE_STATUS) as VoiceState[])('shows the text for %s', (state) => {
    const { container } = render(<VoiceStatus state={state} />);
    expect(container.textContent).toContain(VOICE_STATUS[state].label);
    expect(container.querySelector('[data-voice-state]')?.getAttribute('data-voice-state')).toBe(state);
  });

  it('announces status politely, and speaking is announced as listening to avoid chatter', () => {
    const { rerender } = render(<VoiceStatus state="processing" />);
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Voice status: Thinking');
    rerender(<VoiceStatus state="user-speaking" />);
    expect(screen.getByRole('status').textContent).toBe('Voice status: Listening');
  });
});

describe('VoiceVisualizer', () => {
  it('moves only while the customer is speaking and always has a text label', () => {
    const { container, rerender } = render(<VoiceVisualizer state="idle" />);
    expect(container.querySelector('.animate-voice-wave')).toBeNull();
    rerender(<VoiceVisualizer state="user-speaking" />);
    expect(container.querySelectorAll('.animate-voice-wave').length).toBe(5);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('You are speaking');
    rerender(<VoiceVisualizer state="assistant-speaking" level={0.8} />);
    expect(container.querySelector('.animate-voice-wave')).toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('RelayPay Support is speaking');
  });
});

describe('ErrorState', () => {
  it.each(['connection', 'microphone', 'no-microphone', 'service', 'unsupported', 'unavailable'] as ErrorKind[])('%s', async (kind) => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState kind={kind} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain(COPY.errors[kind].message);
    await user.click(screen.getByRole('button', { name: COPY.errors[kind].action }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('explains microphone access in plain language', () => {
    render(<ErrorState kind="microphone" onRetry={() => {}} />);
    expect(screen.getByText('Microphone access is required to use voice support.')).toBeTruthy();
  });
});

describe('ConversationTranscript', () => {
  it('is a labelled, keyboard-focusable log with plain speaker labels', () => {
    render(
      <ConversationTranscript
        turns={[turn(1, 'user', 'My payout is delayed.'), turn(2, 'assistant', 'Do you have the payout reference?')]}
      />,
    );
    const log = screen.getByRole('log', { name: COPY.conversation.transcriptLabel });
    expect(log.getAttribute('tabindex')).toBe('0');
    const items = within(log).getAllByRole('listitem');
    expect(items[0].textContent).toContain(COPY.conversation.you);
    expect(items[1].textContent).toContain(COPY.conversation.support);
    // One chat bubble per turn: the customer's on the right, support's on the left.
    expect(items[0].className).toContain('bg-accent-soft');
    expect(items[0].className).toContain('ml-auto');
    expect(items[1].className).not.toContain('bg-accent-soft');
    expect(items[1].className).toContain('mr-auto');
  });

  it('shows an empty state', () => {
    render(<ConversationTranscript turns={[]} />);
    expect(screen.getByText(COPY.conversation.empty)).toBeTruthy();
  });
});

describe('EscalationPanel (no form: details come from the account, the time is agreed in conversation)', () => {
  it('explains what happens while a specialist is needed, and asks for nothing', () => {
    const { container } = render(<EscalationPanel support="escalation-required" requestedTime={null} />);
    expect(screen.getByRole('heading', { name: COPY.escalation.heading })).toBeTruthy();
    expect(screen.getByText(COPY.escalation.body)).toBeTruthy();
    expect(screen.getByText(COPY.escalation.timeHint)).toBeTruthy();
    // AC-41.2 / AC-18.1: no name, email or callback-time inputs, and nothing to submit.
    expect(container.querySelectorAll('input, textarea, select, form, button')).toHaveLength(0);
  });

  it('shows a confirmation with the requested (not scheduled) callback', () => {
    render(<EscalationPanel support="escalated" requestedTime="Tue, 6 Oct 2026, 2:00 pm (Africa/Lagos)" />);
    expect(screen.getByText(COPY.escalation.confirmed)).toBeTruthy();
    expect(screen.getByText(COPY.escalation.confirmedBody)).toBeTruthy();
    expect(screen.getByText(`${COPY.escalation.requestedCallback}: Tue, 6 Oct 2026, 2:00 pm (Africa/Lagos)`)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(COPY.escalation.confirmed);
  });

  it('renders nothing for other support states', () => {
    for (const support of ['normal', 'clarifying', 'ticket-created', 'completed'] as const) {
      const { container } = render(<EscalationPanel support={support} requestedTime={null} />);
      expect(container.innerHTML).toBe('');
    }
  });
});

describe('SupportWorkspace', () => {
  const base: WorkspaceProps = {
    voice: { state: 'idle' },
    support: 'normal',
    turns: [],
    ticketReference: null,
    requestedTime: null,
    escalated: false,
    level: 0,
    onStart: () => {},
    onEnd: () => {},
  };

  it('opens with identity, purpose, one action, topics and the privacy notice', () => {
    render(<SupportWorkspace {...base} />);
    expect(screen.getByRole('heading', { level: 1, name: COPY.landingHeading })).toBeTruthy();
    expect(screen.getByText(COPY.landingBody)).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.buttons.start })).toBeTruthy();
    for (const topic of COPY.topics) expect(screen.getByText(topic)).toBeTruthy();
    expect(screen.getByText(COPY.privacyNotice)).toBeTruthy();
    expect(screen.queryByText(COPY.conversation.title)).toBeNull();
  });

  it('explains up front that the microphone is needed and the browser will ask (before Start)', () => {
    render(<SupportWorkspace {...base} />);
    expect(screen.getByText(COPY.microphone.heading + '.')).toBeTruthy();
    expect(screen.getByTestId('mic-instruction').textContent).toContain(COPY.microphone.instruction);
  });

  it('offers a way to reach a specialist from the dashboard when support is unavailable', () => {
    render(<SupportWorkspace {...base} voice={{ state: 'error', error: 'unavailable' }} />);
    const link = screen.getByRole('link', { name: COPY.errorHelp.unavailable.linkLabel });
    expect(link.getAttribute('href')).toBe('/dashboard');
    expect(screen.getByRole('button', { name: COPY.errors.unavailable.action })).toBeTruthy();
  });

  it('explains when voice support cannot start', () => {
    render(<SupportWorkspace {...base} unavailable />);
    expect(screen.getByText(COPY.notConfigured)).toBeTruthy();
    expect((screen.getByRole('button', { name: COPY.buttons.start }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the voice panel and the conversation during a call, without the topic hints', () => {
    render(<SupportWorkspace {...base} voice={{ state: 'listening' }} turns={[turn(1, 'user', 'Hello')]} />);
    expect(screen.getByRole('button', { name: COPY.buttons.end })).toBeTruthy();
    expect(screen.getByRole('heading', { name: COPY.conversation.title })).toBeTruthy();
    expect(screen.queryByText(COPY.topicsHeading)).toBeNull();
  });

  it('shows a ticket confirmation with its reference', () => {
    render(<SupportWorkspace {...base} voice={{ state: 'listening' }} support="ticket-created" ticketReference="TKT-000123" />);
    expect(screen.getByText(COPY.ticket.heading)).toBeTruthy();
    expect(screen.getByText(`${COPY.ticket.reference}: TKT-000123`)).toBeTruthy();
  });

  it('shows the error state instead of the workspace', () => {
    render(<SupportWorkspace {...base} voice={{ state: 'error', error: 'microphone' }} />);
    expect(screen.getByRole('alert').textContent).toContain(COPY.errors.microphone.message);
    expect(screen.queryByText(COPY.landingHeading)).toBeNull();
  });

  it('completes with the right heading depending on whether a request was made', () => {
    const { rerender } = render(<SupportWorkspace {...base} voice={{ state: 'ended' }} support="completed" />);
    expect(screen.getByRole('heading', { name: COPY.complete.headingDefault })).toBeTruthy();
    expect(screen.getByText(COPY.complete.bodyDefault)).toBeTruthy();
    rerender(<SupportWorkspace {...base} voice={{ state: 'ended' }} support="completed" ticketReference="TKT-000123" />);
    expect(screen.getByRole('heading', { name: COPY.complete.headingWithRequest })).toBeTruthy();
    expect(screen.getByText(/Reference: TKT-000123/)).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY.buttons.startAnother })).toBeTruthy();
  });

  it('has no contact or callback form anywhere in the support console (AC-41.2)', () => {
    for (const support of ['escalation-required', 'escalated'] as const) {
      const { container, unmount } = render(
        <SupportWorkspace {...base} voice={{ state: 'listening' }} support={support} escalated={support === 'escalated'} />,
      );
      expect(container.querySelector('form')).toBeNull();
      expect(container.querySelector('input[type="email"], input[name*="email" i], input[name*="name" i]')).toBeNull();
      expect(screen.queryByLabelText(/preferred callback time/i)).toBeNull();
      unmount();
    }
  });

  it('uses no technical terms anywhere on screen', () => {
    const { container } = render(
      <SupportWorkspace {...base} voice={{ state: 'listening' }} support="escalation-required" turns={[turn(1, 'user', 'Hi')]} />,
    );
    expect(container.textContent).not.toMatch(/\b(MCP|RAG|Claude|Supabase|SDK|embedding|tool call|agent)\b/i);
  });

  describe('session timing', () => {
    const live = { ...base, voice: { state: 'listening' } as const, turns: [turn(1, 'user', 'Hi')] };

    it('shows the silence countdown during a call', () => {
      render(<SupportWorkspace {...live} session={{ silenceCountdown: 7, secondsLeft: 200, sessionWarning: false }} />);
      expect(screen.getByText(COPY.session.silenceHeading)).toBeTruthy();
      expect(screen.getByText('Ending conversation in 7 seconds...')).toBeTruthy();
      expect(screen.getByText(COPY.session.silenceHint)).toBeTruthy();
      // One calm announcement for assistive technology, not one per second.
      const announcement = screen.getByText(COPY.session.silenceScreenReader);
      expect(announcement.closest('[role="status"]')).toBeTruthy();
      expect(announcement.className).toContain('sr-only');
      // The ticking text itself is hidden from assistive technology.
      expect(screen.getByText('Ending conversation in 7 seconds...').closest('[aria-hidden="true"]')).toBeTruthy();
    });

    it('uses the singular for the last second', () => {
      render(<SupportWorkspace {...live} session={{ silenceCountdown: 1, secondsLeft: 200, sessionWarning: false }} />);
      expect(screen.getByText('Ending conversation in 1 second...')).toBeTruthy();
    });

    it('shows the time-limit warning, and the countdown wins when both apply', () => {
      const { rerender } = render(
        <SupportWorkspace {...live} session={{ silenceCountdown: null, secondsLeft: 24, sessionWarning: true }} />,
      );
      expect(screen.getByText(COPY.session.warningHeading)).toBeTruthy();
      expect(screen.getByText('This support session will end in about 24 seconds.')).toBeTruthy();
      rerender(<SupportWorkspace {...live} session={{ silenceCountdown: 5, secondsLeft: 24, sessionWarning: true }} />);
      expect(screen.queryByText(COPY.session.warningHeading)).toBeNull();
      expect(screen.getByText(COPY.session.silenceHeading)).toBeTruthy();
    });

    it('shows nothing extra when no notice applies', () => {
      render(<SupportWorkspace {...live} session={{ silenceCountdown: null, secondsLeft: 200, sessionWarning: false }} />);
      expect(screen.queryByText(COPY.session.silenceHeading)).toBeNull();
      expect(screen.queryByText(COPY.session.warningHeading)).toBeNull();
    });

    it.each([
      ['silence-timeout', COPY.session.endedBodySilence],
      ['session-timeout', COPY.session.endedBodyTimeout],
    ] as const)('explains a session that ended on %s and offers a new conversation', (endReason, body) => {
      render(<SupportWorkspace {...base} voice={{ state: 'ended' }} support="completed" endReason={endReason} />);
      expect(screen.getByRole('heading', { name: COPY.session.endedHeading })).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
      expect(screen.getByText(COPY.session.endedNewConversation)).toBeTruthy();
      expect(screen.getByRole('button', { name: COPY.buttons.startAnother })).toBeTruthy();
    });

    it('keeps the normal ending for a conversation the customer finished', () => {
      render(<SupportWorkspace {...base} voice={{ state: 'ended' }} support="completed" endReason="user-ended" />);
      expect(screen.getByRole('heading', { name: COPY.complete.headingDefault })).toBeTruthy();
      expect(screen.queryByText(COPY.session.endedNewConversation)).toBeNull();
    });

    it('still acknowledges a ticket when the session timed out', () => {
      render(
        <SupportWorkspace {...base} voice={{ state: 'ended' }} support="completed" endReason="session-timeout" ticketReference="TKT-000123" />,
      );
      expect(screen.getByText(/Reference: TKT-000123/)).toBeTruthy();
    });

    it('uses no technical terms in any session notice', () => {
      const { container } = render(
        <SupportWorkspace {...live} session={{ silenceCountdown: 3, secondsLeft: 20, sessionWarning: true }} />,
      );
      expect(container.textContent).not.toMatch(/\b(MCP|RAG|Claude|Supabase|SDK|Vapi|agent)\b/i);
    });
  });
});
