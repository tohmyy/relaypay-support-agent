// @vitest-environment jsdom
import { act, cleanup, configure, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceSession } from '@/hooks/useVoiceSession';
import { COPY } from '@/lib/copy';
import { deriveSupportState } from '@/lib/support/derive';
import { NEUTRAL_STATE, type PublicConversationState } from '@/lib/conversation-state';
import { MockVoiceClient } from '@/lib/voice/mock-client';

const h = vi.hoisted(() => ({ session: null as unknown }));

vi.mock('next/navigation', () => ({ usePathname: () => '/support' }));
vi.mock('@/components/SupportWorkspace', () => ({ default: () => <div data-testid="workspace" /> }));
vi.mock('@/components/Header', () => ({ default: () => <header data-testid="public-header" /> }));
vi.mock('@/lib/voice/vapi-client', () => ({ createVapiClient: vi.fn() }));
vi.mock('@/hooks/useVoiceSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useVoiceSession')>();
  return { ...actual, useVoiceSession: (...args: Parameters<typeof actual.useVoiceSession>) => (h.session ?? actual.useVoiceSession(...args)) };
});

import HumanSupport from '@/components/shell/HumanSupport';
import StaffChat from '@/components/shell/StaffChat';
import SupportPage from '@/components/SupportPage';

// These tests poll over real timers; a loaded machine can take longer than the default second.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  h.session = null;
});

type Reply = { status?: number; json: unknown };
/** A fake fetch keyed by "METHOD path-without-query"; each key may hold a queue of replies (the last one repeats). */
function fakeFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const queues = new Map<string, Reply[]>();
  for (const [k, v] of Object.entries(routes)) queues.set(k, Array.isArray(v) ? [...v] : [v]);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body as string | undefined });
    const q = queues.get(`${method} ${url.split('?')[0]}`);
    if (!q) return new Response('{}', { status: 404 });
    const r = q.length > 1 ? q.shift()! : q[0];
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

const BASE = '/api/support/conversations/vapi_abc';
const thread = (over: Record<string, unknown> = {}) => ({
  supportMode: 'human',
  ended: false,
  messages: [],
  staff: null,
  staffTyping: false,
  ...over,
});
const message = (id: string, sender: string, body: string, at: string, author: unknown = null) => ({ id, sender, body, at, author });

describe('HumanSupport', () => {
  it('waits for a specialist, shows the notice, and then who joined and their messages', async () => {
    const notice = message('1', 'system', "You're being connected to a support specialist.", '2026-10-03T12:00:00.000Z');
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: [
        { json: thread({ messages: [notice], waitingSince: new Date().toISOString(), staffOnline: true }) },
        {
          json: thread({
            messages: [message('2', 'staff', 'Hi Amara, I am on it.', '2026-10-03T12:00:05.000Z', { name: 'Sarah', title: 'Support Specialist', avatarUrl: null })],
            staff: { name: 'Sarah', title: 'Support Specialist', avatarUrl: null },
            staffTyping: true,
          }),
        },
      ],
      [`POST ${BASE}/read`]: { json: { ok: true } },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText("You're being connected to a support specialist.")).toBeTruthy();
    expect(screen.getByText(/A specialist is online and will join you shortly/)).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Conversation with a support specialist' })).toBeTruthy();

    expect(await screen.findByText('Hi Amara, I am on it.', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('Support Specialist')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Sarah is typing…');
    expect(screen.queryByText(/is online and will join/)).toBeNull();
    // The second poll asked only for what came after the first message.
    expect(f.calls.some((c) => c.url.includes('after=2026-10-03T12%3A00%3A00.000Z'))).toBe(true);
  });

  it('says the team will reply when nobody is online, and tells the customer to ask for a callback in the message box', async () => {
    fakeFetch({ [`GET ${BASE}/messages`]: { json: thread({ waitingSince: new Date().toISOString(), staffOnline: false }) } });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText(/Our team will reply as soon as someone is free/)).toBeTruthy();
    expect(screen.getByText(/Waiting for under a minute/)).toBeTruthy();
    expect(screen.getByText(/tell us a day and time in the message box/)).toBeTruthy();
    // No callback form or button (AC-18.1): scheduling happens in the chat.
    expect(screen.queryByRole('button', { name: /callback/i })).toBeNull();
    expect(screen.queryByLabelText(/good time to call/)).toBeNull();
    expect(screen.queryByText(/Still waiting\?/)).toBeNull();
  });

  it('sends a message at once, and keeps it visible with a retry if it did not get through', async () => {
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: { json: thread() },
      [`POST ${BASE}/messages`]: [{ status: 500, json: { error: 'unavailable' } }, { status: 201, json: { ok: true } }],
      [`POST ${BASE}/typing`]: { json: { ok: true } },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    const box = await screen.findByLabelText('Your message');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveProperty('disabled', true);

    await userEvent.type(box, 'Hello?');
    await userEvent.click(send);
    // It is in the conversation straight away, and the box is free for the next message.
    expect((box as HTMLTextAreaElement).value).toBe('');
    expect(await screen.findByText('Hello?')).toBeTruthy();
    expect(await screen.findByText(/Not sent\./)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/messages'))).toHaveLength(2));
    const sends = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/messages'));
    const [first, second] = sends.map((c) => JSON.parse(c.body as string) as { body: string; clientId: string });
    expect(first.body).toBe('Hello?');
    // The retry carries the same id, so a first attempt that did get through cannot be stored twice.
    expect(second.clientId).toBe(first.clientId);
    expect(first.clientId).toMatch(/^[0-9a-f-]{36}$/);
    // Typing was signalled, and not on every keystroke.
    expect(f.calls.filter((c) => c.url.endsWith('/typing')).length).toBe(1);
  });

  it('sends with Enter and keeps Shift+Enter for a new line', async () => {
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: { json: thread() },
      [`POST ${BASE}/messages`]: { status: 201, json: { ok: true } },
      [`POST ${BASE}/typing`]: { json: { ok: true } },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    const box = await screen.findByLabelText('Your message');
    await userEvent.type(box, 'one{Shift>}{Enter}{/Shift}two');
    expect((box as HTMLTextAreaElement).value).toBe('one\ntwo');
    await userEvent.type(box, '{Enter}');
    await waitFor(() => expect(f.calls.some((c) => c.method === 'POST' && c.url.endsWith('/messages'))).toBe(true));
  });

  it('refuses an over-long message before sending it', async () => {
    const f = fakeFetch({ [`GET ${BASE}/messages`]: { json: thread() } });
    render(<HumanSupport conversationId="vapi_abc" />);
    const box = await screen.findByLabelText('Your message');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, 'x'.repeat(2001));
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect((await screen.findByRole('alert')).textContent).toContain('2,000 characters');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(f.calls.some((c) => c.method === 'POST' && c.url.endsWith('/messages'))).toBe(false);
  });

  it('offers the specialist-stage rating only once the chat is closed (AC-33.2)', async () => {
    fakeFetch({ [`GET ${BASE}/messages`]: { json: thread({ supportMode: 'ended', ended: true }) } });
    const view = render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('This conversation is closed')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How was the help from our support specialist?' })).toBeTruthy();
    view.unmount();

    fakeFetch({ [`GET ${BASE}/messages`]: { json: thread({ waitingSince: new Date().toISOString() }) } });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByLabelText('Your message')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'How was the help from our support specialist?' })).toBeNull();
  });

  it('shows the closed state instead of the message box, and stops polling', async () => {
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: { json: thread({ supportMode: 'ended', ended: true, messages: [message('9', 'system', 'Sarah has closed this conversation.', '2026-10-03T12:10:00.000Z')] }) },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('This conversation is closed')).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to overview' }).getAttribute('href')).toBe('/dashboard');
    const polls = f.calls.length;
    await new Promise((r) => setTimeout(r, 2500));
    expect(f.calls.length).toBe(polls);
  });

  it('keeps what is on screen and says so when an update fails', async () => {
    fakeFetch({
      [`GET ${BASE}/messages`]: [
        { json: thread({ messages: [message('1', 'system', 'Connected.', '2026-10-03T12:00:00.000Z')] }) },
        { status: 503, json: { error: 'unavailable' } },
      ],
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('Connected.')).toBeTruthy();
    expect(await screen.findByText(/having trouble updating/, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('Connected.')).toBeTruthy();
  });
});

describe('StaffChat', () => {
  const SB = '/api/staff/conversations/vapi_abc';
  const staffThread = (over: Record<string, unknown> = {}) => ({
    supportMode: 'human',
    ended: false,
    messages: [message('1', 'customer', 'My payout failed', '2026-10-03T12:00:00.000Z')],
    assignedTo: null,
    assignedToMe: false,
    canReply: true,
    customerTyping: false,
    ...over,
  });

  it('shows the customer, offers to take an unassigned conversation, and refreshes after taking it', async () => {
    const f = fakeFetch({
      [`GET ${SB}/messages`]: [
        { json: staffThread() },
        { json: staffThread({ assignedTo: { name: 'Sarah' }, assignedToMe: true, customerTyping: true }) },
      ],
      [`POST ${SB}/claim`]: { json: { assigned: true } },
    });
    render(<StaffChat conversationId="vapi_abc" />);
    expect(await screen.findByText('My payout failed')).toBeTruthy();
    expect(screen.getByText(/Waiting for staff/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Take this conversation' }));
    expect(await screen.findByText('Assigned to you')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Customer is typing…');
    expect(f.calls.some((c) => c.method === 'POST' && c.url.endsWith('/claim'))).toBe(true);
  });

  it('says so when another team member got there first', async () => {
    fakeFetch({
      [`GET ${SB}/messages`]: { json: staffThread() },
      [`POST ${SB}/claim`]: { status: 409, json: { error: 'taken' } },
    });
    render(<StaffChat conversationId="vapi_abc" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Take this conversation' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Another team member');
  });

  it('only lets the assigned person reply, and asks before closing', async () => {
    const f = fakeFetch({
      [`GET ${SB}/messages`]: { json: staffThread({ assignedTo: { name: 'David' }, assignedToMe: false, canReply: false }) },
    });
    const { unmount } = render(<StaffChat conversationId="vapi_abc" />);
    expect(await screen.findByText('Assigned to David')).toBeTruthy();
    expect(screen.queryByLabelText('Reply to the customer')).toBeNull();
    expect(screen.getByText(/Only the assigned team member or an admin/)).toBeTruthy();
    unmount();

    const g = fakeFetch({
      [`GET ${SB}/messages`]: { json: staffThread({ assignedTo: { name: 'Sarah' }, assignedToMe: true }) },
      [`POST ${SB}/close`]: { json: { closed: true } },
    });
    render(<StaffChat conversationId="vapi_abc" />);
    await screen.findByLabelText('Reply to the customer');
    await userEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(g.calls.some((c) => c.url.endsWith('/close'))).toBe(false); // not yet: it asks first
    await userEvent.click(screen.getByRole('button', { name: 'Keep open' }));
    expect(screen.getByRole('button', { name: 'Close conversation' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close it now' }));
    await waitFor(() => expect(g.calls.some((c) => c.method === 'POST' && c.url.endsWith('/close'))).toBe(true));
    void f;
  });

  it('shows a closed conversation without a reply box', async () => {
    fakeFetch({ [`GET ${SB}/messages`]: { json: staffThread({ supportMode: 'ended', ended: true, canReply: false }) } });
    render(<StaffChat conversationId="vapi_abc" />);
    expect(await screen.findByText('This conversation is closed.')).toBeTruthy();
    expect(screen.queryByLabelText('Reply to the customer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close conversation' })).toBeNull();
  });
});

describe('SupportPage with a specialist', () => {
  const vapi = { mode: 'vapi' as const, publicKey: 'pk', assistantId: 'as' };
  const baseSession = (over: Record<string, unknown> = {}) => ({
    voice: {},
    support: 'normal',
    turns: [],
    backend: NEUTRAL_STATE,
    level: 0,
    session: {},
    endReason: null,
    conversationId: 'vapi_abc',
    blocked: null,
    statusUnavailable: false,
    signedOut: false,
    start: async () => {},
    end: vi.fn(async () => {}),
    ...over,
  });

  beforeEach(() => {
    fakeFetch({
      [`GET ${BASE}/messages`]: { json: thread() },
      'POST /api/support/link': { json: { linked: true } },
    });
  });

  it('shows the text chat in place of the voice workspace once the conversation moved', () => {
    h.session = baseSession({ support: 'human-support' });
    render(<SupportPage config={vapi} embedded linkIdentity />);
    expect(screen.getByText('Chat with a support specialist')).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  it('keeps the voice workspace otherwise', () => {
    h.session = baseSession();
    render(<SupportPage config={vapi} embedded linkIdentity />);
    expect(screen.getByTestId('workspace')).toBeTruthy();
  });

  it.each([
    ['active-session', 409, 'You already have an active support conversation'],
    ['rate-limited', 429, 'You have started several conversations recently'],
  ])('ends the call and says why when the server reports %s', async (reason, status, text) => {
    const end = vi.fn(async () => {});
    h.session = baseSession({ end });
    fakeFetch({ 'POST /api/support/link': { status, json: { linked: true, error: reason } } });
    render(<SupportPage config={vapi} embedded linkIdentity />);
    expect((await screen.findByRole('alert')).textContent).toContain(text);
    await waitFor(() => expect(end).toHaveBeenCalled());
  });

  it('retries a failed link once, automatically, and then it is linked (AC-30.*)', async () => {
    h.session = baseSession();
    const f = fakeFetch({ 'POST /api/support/link': [{ status: 503, json: { error: 'unavailable' } }, { json: { linked: true } }] });
    render(<SupportPage config={vapi} embedded linkIdentity />);
    await waitFor(() => expect(f.calls.filter((c) => c.url === '/api/support/link')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives up after the one retry, offers to save the conversation, and a manual try starts a fresh budget', async () => {
    h.session = baseSession();
    const f = fakeFetch({
      'POST /api/support/link': [
        { status: 503, json: { error: 'unavailable' } },
        { status: 503, json: { error: 'unavailable' } },
        { json: { linked: true } },
      ],
    });
    render(<SupportPage config={vapi} embedded linkIdentity />);
    const save = await screen.findByRole('button', { name: COPY.link.saveAction });
    expect(f.calls.filter((c) => c.url === '/api/support/link')).toHaveLength(2);
    await userEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(f.calls.filter((c) => c.url === '/api/support/link')).toHaveLength(3);
  });

  it('does not retry a refusal (another owner): one attempt, then the failed state', async () => {
    h.session = baseSession();
    const f = fakeFetch({ 'POST /api/support/link': { status: 409, json: { error: 'conflict' } } });
    render(<SupportPage config={vapi} embedded linkIdentity />);
    expect((await screen.findByRole('alert')).textContent).toContain(COPY.link.failed);
    expect(f.calls.filter((c) => c.url === '/api/support/link')).toHaveLength(1);
  });

  it('does not end the call for an unrelated link failure', async () => {
    const end = vi.fn(async () => {});
    h.session = baseSession({ end });
    fakeFetch({ 'POST /api/support/link': { status: 409, json: { error: 'conflict' } } });
    render(<SupportPage config={vapi} embedded linkIdentity />);
    // Not a limit: the call carries on, and the customer is offered a way to save it to their account.
    expect((await screen.findByRole('alert')).textContent).toContain(COPY.link.saveAction);
    expect(end).not.toHaveBeenCalled();
  });
});

describe('the voice session when the conversation moves to a specialist', () => {
  const human: PublicConversationState = { ...NEUTRAL_STATE, supportMode: 'human' };

  it('derives a human-support state ahead of "completed"', () => {
    expect(deriveSupportState(human, { callEnded: false })).toBe('human-support');
    expect(deriveSupportState(human, { callEnded: true })).toBe('human-support');
    expect(deriveSupportState({ ...human, supportMode: 'ended' }, { callEnded: true })).toBe('completed');
  });

  it('stops the browser call when polling shows the hand-over', async () => {
    const client = new MockVoiceClient([], 'vapi_test-call');
    let backend: PublicConversationState = NEUTRAL_STATE;
    const { result } = renderHook(() =>
      useVoiceSession({
        createClient: () => client,
        fetchState: async () => backend,
        checkMic: async () => null,
        pollMs: 20,
      }),
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => client.handlers!.onCallStart());
    expect(result.current.voice.state).toBe('listening');
    expect(client.stopped).toBe(false);

    backend = human;
    await waitFor(() => expect(result.current.support).toBe('human-support'));
    await waitFor(() => expect(client.stopped).toBe(true));
    expect(result.current.conversationId).toBe('vapi_test-call');
  });
});
