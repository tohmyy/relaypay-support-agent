// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationComplete from '@/components/ConversationComplete';
import ConversationTranscript from '@/components/ConversationTranscript';
import ErrorState from '@/components/ErrorState';
import SupportWorkspace, { type WorkspaceProps } from '@/components/SupportWorkspace';
import TextConversation from '@/components/TextConversation';
import { useTextSession } from '@/hooks/useTextSession';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { END_REASONS } from '@/lib/conversation-state';
import { COPY, END_REASON_BODY } from '@/lib/copy';
import { emptyBackendState } from '@/lib/support/derive';
import type { ConversationTurn } from '@/lib/transcript';
import { MockVoiceClient } from '@/lib/voice/mock-client';
import type { ErrorKind } from '@/lib/voice/state';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const turn = (id: number, speaker: 'user' | 'assistant', text: string, final = true): ConversationTurn => ({
  id,
  speaker,
  text,
  final,
  timestamp: 0,
});

const base: WorkspaceProps = {
  voice: { state: 'listening' },
  support: 'normal',
  turns: [turn(1, 'user', 'Hello'), turn(2, 'assistant', 'Hi, how can I help?')],
  ticketReference: null,
  requestedTime: null,
  escalated: false,
  level: 0,
  onStart: () => {},
  onEnd: () => {},
};

describe('vertical stack layout (AC-11.1, AC-11.2)', () => {
  it('stacks the voice panel above the conversation while a call is active, with no side-by-side grid', () => {
    const { container } = render(<SupportWorkspace {...base} />);
    const root = container.querySelector('[data-layout="stack"]')!;
    expect(root).toBeTruthy();
    expect(root.className).toContain('flex-col');
    expect(container.innerHTML).not.toContain('lg:grid-cols-2');
    expect(container.innerHTML).not.toMatch(/grid-cols-\d/);
    const voice = screen.getByLabelText('Voice');
    const conversation = screen.getByRole('heading', { name: COPY.conversation.title });
    expect(voice.compareDocumentPosition(conversation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stacks the completion above the transcript when the call has ended', () => {
    const { container } = render(<SupportWorkspace {...base} voice={{ state: 'ended' }} support="completed" />);
    expect(container.querySelector('[data-layout="stack"]')).toBeTruthy();
    expect(container.innerHTML).not.toContain('lg:grid-cols-2');
    const complete = screen.getByRole('heading', { name: COPY.complete.headingDefault });
    const transcript = screen.getByRole('log', { name: COPY.conversation.transcriptLabel });
    expect(complete.compareDocumentPosition(transcript) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('turn bubbles (AC-14.1)', () => {
  it('renders each turn as exactly one bubble with a speaker label, customer right and support left', () => {
    render(<ConversationTranscript turns={base.turns} />);
    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const li of items) expect(li.hasAttribute('data-bubble')).toBe(true);
    expect(items[0].textContent).toContain(COPY.conversation.you);
    expect(items[0].textContent).toContain('Hello');
    expect(items[0].className).toMatch(/ml-auto/);
    expect(items[1].textContent).toContain(COPY.conversation.support);
    expect(items[1].className).toMatch(/mr-auto/);
  });

  it('shows a partial turn softly, in the same single bubble', () => {
    render(<ConversationTranscript turns={[turn(1, 'user', 'How much are', false)]} />);
    const items = within(screen.getByRole('log')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].className).toContain('opacity-80');
  });
});

describe('transcript auto-scroll (AC-17.1, AC-17.2)', () => {
  /** jsdom has no layout: give the log a scrollable box we control. */
  function stubBox(el: HTMLElement, box: { scrollHeight: number; clientHeight: number }) {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => box.scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => box.clientHeight });
  }

  it('sticks to the bottom as turns arrive and grow', () => {
    const { rerender } = render(<ConversationTranscript turns={[turn(1, 'user', 'a')]} />);
    const log = screen.getByRole('log');
    const box = { scrollHeight: 500, clientHeight: 200 };
    stubBox(log, box);
    rerender(<ConversationTranscript turns={[turn(1, 'user', 'a'), turn(2, 'assistant', 'b')]} />);
    expect(log.scrollTop).toBe(500);
    box.scrollHeight = 900;
    rerender(<ConversationTranscript turns={[turn(1, 'user', 'a'), turn(2, 'assistant', 'b, and a longer answer', false)]} />);
    expect(log.scrollTop).toBe(900);
  });

  it('pauses when the customer scrolls up, and follows again when they return to the bottom', () => {
    const { rerender } = render(<ConversationTranscript turns={[turn(1, 'user', 'a')]} />);
    const log = screen.getByRole('log');
    const box = { scrollHeight: 1000, clientHeight: 200 };
    stubBox(log, box);

    // Scrolled up to read (more than 24px from the bottom): new turns do not drag the view down.
    log.scrollTop = 300;
    fireEvent.scroll(log);
    rerender(<ConversationTranscript turns={[turn(1, 'user', 'a'), turn(2, 'assistant', 'b')]} />);
    expect(log.scrollTop).toBe(300);

    // Back within 24px of the bottom: following resumes.
    log.scrollTop = 780; // 1000 - 780 - 200 = 20
    fireEvent.scroll(log);
    box.scrollHeight = 1200;
    rerender(<ConversationTranscript turns={[turn(1, 'user', 'a'), turn(2, 'assistant', 'b'), turn(3, 'user', 'c')]} />);
    expect(log.scrollTop).toBe(1200);
  });
});

describe('ConversationComplete (AC-31.*)', () => {
  const props = { ticketReference: null, escalated: false, onStartAnother: () => {} };

  it('has an explanation for every recorded end reason, and a calm default while it is still being read', () => {
    for (const reason of END_REASONS) expect(reason in END_REASON_BODY).toBe(true);
    for (const reason of [...END_REASONS, null] as const) {
      const { unmount } = render(<ConversationComplete {...props} endReason={reason} />);
      expect(screen.getByRole('heading').textContent!.length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: COPY.buttons.startAnother })).toBeTruthy();
      const body = reason ? END_REASON_BODY[reason] : null;
      if (body) expect(screen.getByText(body)).toBeTruthy();
      else expect(screen.getByText(COPY.complete.bodyDefault)).toBeTruthy();
      unmount();
    }
  });

  it('says it ended on its own for timeouts, limits, noise and errors', () => {
    for (const reason of ['silence-timeout', 'session-timeout', 'limit-reached', 'low-confidence', 'error'] as const) {
      const { unmount } = render(<ConversationComplete {...props} endReason={reason} />);
      expect(screen.getByRole('heading', { name: COPY.session.endedHeading })).toBeTruthy();
      unmount();
    }
  });

  it('links to the saved transcript only for a linked, signed-in conversation', () => {
    const link = () => screen.queryByRole('link', { name: COPY.buttons.viewTranscript });
    const { rerender } = render(<ConversationComplete {...props} conversationId="vapi_abc" embedded linkStatus="linked" />);
    expect(link()?.getAttribute('href')).toBe('/support/vapi_abc');
    // No false history links (AC-31.3): pending, failed or unknown link, not embedded, or no id.
    for (const over of [
      { linkStatus: 'linking' as const },
      { linkStatus: 'failed' as const },
      { linkStatus: null },
      { embedded: false },
      { conversationId: null },
    ]) {
      rerender(<ConversationComplete {...props} conversationId="vapi_abc" embedded linkStatus="linked" {...over} />);
      expect(link()).toBeNull();
    }
  });
});

describe('typed converse during a call (AC-13.1)', () => {
  it('shows the text box only while the call is live', () => {
    const onSendText = vi.fn(async () => true);
    const { rerender } = render(<SupportWorkspace {...base} onSendText={onSendText} />);
    expect(screen.getByLabelText(COPY.typed.label)).toBeTruthy();
    for (const state of ['connecting', 'ending'] as const) {
      rerender(<SupportWorkspace {...base} voice={{ state }} onSendText={onSendText} />);
      expect(screen.queryByLabelText(COPY.typed.label)).toBeNull();
    }
  });

  it('sends what is typed (Enter sends)', async () => {
    const onSendText = vi.fn(async () => true);
    render(<SupportWorkspace {...base} onSendText={onSendText} />);
    await userEvent.type(screen.getByLabelText(COPY.typed.label), 'My payout is PAY-7002{Enter}');
    expect(onSendText).toHaveBeenCalledWith('My payout is PAY-7002');
  });

  function setup() {
    const client = new MockVoiceClient([], 'vapi_test-call');
    const hook = renderHook(() =>
      useVoiceSession({
        createClient: () => client,
        fetchState: async () => emptyBackendState,
        checkMic: async () => null,
        pollMs: 20,
      }),
    );
    return { client, hook };
  }

  it('reaches the call and appears in the transcript as the customer’s turn', async () => {
    const { client, hook } = setup();
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.sendText('  What is the status of PAY-7002?  ');
    });
    expect(ok).toBe(true);
    expect(client.sent).toEqual(['What is the status of PAY-7002?']);
    expect(hook.result.current.turns.at(-1)).toMatchObject({ speaker: 'user', text: 'What is the status of PAY-7002?', final: true });
  });

  it('can type a callback date and time instead of speaking it, with no form (AC-13.3)', async () => {
    const { client, hook } = setup();
    await act(async () => {
      await hook.result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    await act(async () => {
      await hook.result.current.sendText('Tomorrow at 10am, I am in Lagos');
    });
    expect(client.sent).toEqual(['Tomorrow at 10am, I am in Lagos']);
  });

  it('refuses when there is no live call, the call is ending, or the text is empty or too long', async () => {
    const { client, hook } = setup();
    expect(await hook.result.current.sendText('hello')).toBe(false); // idle
    await act(async () => {
      await hook.result.current.start();
    });
    expect(await hook.result.current.sendText('hello')).toBe(false); // connecting
    act(() => client.handlers!.onCallStart());
    expect(await hook.result.current.sendText('   ')).toBe(false);
    expect(await hook.result.current.sendText('x'.repeat(2001))).toBe(false);
    await act(async () => {
      await hook.result.current.end();
    });
    expect(await hook.result.current.sendText('too late')).toBe(false);
    expect(client.sent).toEqual([]);
  });
});

describe('Type instead (AC-13.2)', () => {
  it.each(['microphone', 'no-microphone', 'unsupported'] as ErrorKind[])('is offered on the %s error and works', async (kind) => {
    const onTypeInstead = vi.fn();
    render(<ErrorState kind={kind} onRetry={() => {}} onTypeInstead={onTypeInstead} />);
    await userEvent.click(screen.getByRole('button', { name: COPY.typed.typeInstead }));
    expect(onTypeInstead).toHaveBeenCalledOnce();
  });

  it.each(['connection', 'service', 'unavailable'] as ErrorKind[])('is not offered on the %s error', (kind) => {
    render(<ErrorState kind={kind} onRetry={() => {}} onTypeInstead={() => {}} />);
    expect(screen.queryByRole('button', { name: COPY.typed.typeInstead })).toBeNull();
  });

  it('is not shown when no handler is given', () => {
    render(<ErrorState kind="microphone" onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: COPY.typed.typeInstead })).toBeNull();
  });
});

describe('typed-only conversation (no Vapi)', () => {
  function stubFetch(handler: (body: Record<string, unknown>) => { status?: number; json: unknown }) {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('/api/support/text-turn');
        const body = JSON.parse(String(init?.body));
        calls.push(body);
        const r = handler(body);
        return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
      }),
    );
    return calls;
  }

  it('creates the conversation on the first message, continues it after, and shows both sides', async () => {
    const calls = stubFetch((body) => ({
      json: { conversationId: 'text_abc', response: `Answer to: ${body.message}`, ended: false },
    }));
    const { result } = renderHook(() => useTextSession());
    await act(async () => {
      expect(await result.current.send('Where is my payout?')).toBe(true);
    });
    await act(async () => {
      expect(await result.current.send('And my invoice?')).toBe(true);
    });
    expect(calls[0]).toEqual({ message: 'Where is my payout?' });
    expect(calls[1]).toEqual({ conversationId: 'text_abc', message: 'And my invoice?' });
    expect(result.current.turns.map((t) => [t.speaker, t.text])).toEqual([
      ['user', 'Where is my payout?'],
      ['assistant', 'Answer to: Where is my payout?'],
      ['user', 'And my invoice?'],
      ['assistant', 'Answer to: And my invoice?'],
    ]);
  });

  it('takes back the message and reports why when it could not be sent, so the text stays in the box', async () => {
    stubFetch(() => ({ status: 503, json: { error: 'unavailable' } }));
    const { result } = renderHook(() => useTextSession());
    await act(async () => {
      expect(await result.current.send('hello')).toBe(false);
    });
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBe('failed');

    stubFetch(() => ({ status: 429, json: { error: 'rate-limited' } }));
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.error).toBe('rate-limited');
  });

  it('shows the ended screen with a transcript link when the conversation is over', async () => {
    stubFetch(() => ({ json: { conversationId: 'text_abc', response: 'Goodbye.', ended: true } }));
    render(<TextConversation onUseVoice={() => {}} />);
    await userEvent.type(screen.getByLabelText(COPY.typed.label), "That's all, thank you{Enter}");
    expect(await screen.findByRole('heading', { name: COPY.complete.headingDefault })).toBeTruthy();
    expect(screen.getByRole('link', { name: COPY.buttons.viewTranscript }).getAttribute('href')).toBe('/support/text_abc');
    expect(screen.queryByLabelText(COPY.typed.label)).toBeNull();
    // Start another conversation resets it.
    await userEvent.click(screen.getByRole('button', { name: COPY.buttons.startAnother }));
    await waitFor(() => expect(screen.getByLabelText(COPY.typed.label)).toBeTruthy());
  });

  it('lets the customer go back to voice', async () => {
    const onUseVoice = vi.fn();
    render(<TextConversation onUseVoice={onUseVoice} />);
    await userEvent.click(screen.getByRole('button', { name: COPY.typed.useVoice }));
    expect(onUseVoice).toHaveBeenCalledOnce();
  });
});
