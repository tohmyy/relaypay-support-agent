// @vitest-environment jsdom
import { act, cleanup, configure, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ pathname: '/staff' }));
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }));

import HumanSupport from '@/components/shell/HumanSupport';
import LiveQueue from '@/components/shell/LiveQueue';
import NavLinks from '@/components/shell/NavLinks';
import PresenceControl from '@/components/shell/PresenceControl';
import StaffChat from '@/components/shell/StaffChat';
import { StaffInboxProvider, type InboxData } from '@/components/shell/StaffInbox';
import { useChatThread } from '@/hooks/useChatThread';
import { usePolling, type PollResult } from '@/hooks/usePolling';
import type { QueueItem } from '@/lib/dashboard/staff';

type Reply = { status?: number; json: unknown };
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
  return { fn, calls, set: (key: string, reply: Reply | Reply[]) => queues.set(key, Array.isArray(reply) ? [...reply] : [reply]) };
}

let visibility: 'visible' | 'hidden' = 'visible';
const setVisibility = (v: 'visible' | 'hidden') => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});
// These tests poll over real timers; a loaded machine can take longer than the default second.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('usePolling', () => {
  const half = () => 0.5; // no jitter

  it('polls at once, then at the foreground interval, and stops when told to', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async (): Promise<PollResult> => (poll.mock.calls.length >= 3 ? 'stop' : 'ok'));
    renderHook(() => usePolling(poll, { foregroundMs: 2000, hiddenMs: 10_000, random: half }));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(poll).toHaveBeenCalledTimes(3); // this one said stop
    await advance(60_000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('slows down while hidden and polls straight away when the page comes back', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async (): Promise<PollResult> => 'ok');
    renderHook(() => usePolling(poll, { foregroundMs: 2000, hiddenMs: 10_000, random: half }));
    await advance(0);
    setVisibility('hidden');
    await advance(2000); // the timer already running still fires...
    const afterFirstHidden = poll.mock.calls.length;
    await advance(9000);
    expect(poll.mock.calls.length).toBe(afterFirstHidden); // ...then the wait is ten seconds
    await advance(1500);
    expect(poll.mock.calls.length).toBe(afterFirstHidden + 1);
    const before = poll.mock.calls.length;
    setVisibility('visible');
    await advance(0);
    expect(poll.mock.calls.length).toBe(before + 1);
  });

  it('waits longer after failures and goes back to normal after a success', async () => {
    vi.useFakeTimers();
    const results: PollResult[] = ['failed', 'failed', 'ok', 'ok'];
    const poll = vi.fn(async (): Promise<PollResult> => results.shift() ?? 'ok');
    renderHook(() => usePolling(poll, { foregroundMs: 2000, hiddenMs: 10_000, random: half }));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(3999);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(poll).toHaveBeenCalledTimes(2); // 4 s after the first failure
    await advance(8000);
    expect(poll).toHaveBeenCalledTimes(3); // 8 s after the second
    await advance(2000);
    expect(poll).toHaveBeenCalledTimes(4); // back to 2 s
  });

  it('does not ask while the device is offline, and asks again when it is back', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async (): Promise<PollResult> => 'ok');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderHook(() => usePolling(poll, { foregroundMs: 2000, random: half }));
    await advance(10_000);
    expect(poll).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled, and nothing after unmount', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(async (): Promise<PollResult> => 'ok');
    const { rerender, unmount } = renderHook(({ on }) => usePolling(poll, { enabled: on, random: half }), { initialProps: { on: false } });
    await advance(10_000);
    expect(poll).not.toHaveBeenCalled();
    rerender({ on: true });
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);
    unmount();
    await advance(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});

describe('useChatThread', () => {
  const BASE = '/api/support/conversations/vapi_abc';
  const stored = (id: string, sender: string, body: string, at: string, clientId: string | null = null) => ({
    id,
    sender,
    body,
    at,
    clientId,
    author: null,
  });
  const thread = (messages: unknown[] = [], over: Record<string, unknown> = {}) => ({
    supportMode: 'human',
    ended: false,
    messages,
    staffReadAt: null,
    ...over,
  });
  const hook = (ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) => {
    const queue = [...ids];
    return renderHook(() =>
      useChatThread({
        messagesUrl: `${BASE}/messages`,
        typingUrl: `${BASE}/typing`,
        readUrl: `${BASE}/read`,
        me: 'customer',
        otherReadAt: (m) => (m as { staffReadAt?: string } | null)?.staffReadAt,
        newId: () => queue.shift() ?? 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        random: () => 0.5,
      }),
    );
  };

  it('shows a sent message at once and replaces it, without a duplicate, when the server copy arrives', async () => {
    vi.useFakeTimers();
    const id = '11111111-1111-4111-8111-111111111111';
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: [
        { json: thread() },
        { json: thread([stored('row-1', 'customer', 'Hello?', '2026-10-04T12:00:01.000Z', id)]) },
      ],
      [`POST ${BASE}/messages`]: { status: 201, json: { ok: true } },
    });
    const { result } = hook();
    await advance(0);
    await act(async () => void (await result.current.send('  Hello?  ')));
    // Already on screen, marked as sending, with the id the browser made.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ body: 'Hello?', clientId: id });
    await advance(0);
    expect(f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/messages'))).toHaveLength(1);
    expect(JSON.parse(f.calls.find((c) => c.method === 'POST')!.body as string)).toEqual({ body: 'Hello?', clientId: id });
    await advance(0);
    // After the next poll it is the stored message, once.
    expect(result.current.messages.map((m) => m.id)).toEqual(['row-1']);
    expect(result.current.messages[0].status).toBeUndefined();
  });

  it('keeps a message that did not send, retries it with the same id, and can drop it', async () => {
    vi.useFakeTimers();
    const id = '11111111-1111-4111-8111-111111111111';
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: { json: thread() },
      [`POST ${BASE}/messages`]: [{ status: 500, json: { error: 'unavailable' } }, { status: 201, json: { ok: true } }],
    });
    const { result } = hook();
    await advance(0);
    await act(async () => void (await result.current.send('Hi')));
    await advance(0);
    expect(result.current.messages[0]).toMatchObject({ status: 'failed', failure: 'failed', clientId: id });
    act(() => result.current.retry(id));
    expect(result.current.messages[0].status).toBe('sending');
    await advance(0);
    const posts = f.calls.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body as string) as { clientId: string });
    expect(posts.map((p) => p.clientId)).toEqual([id, id]);

    // A second message that fails can be removed.
    f.set(`POST ${BASE}/messages`, { status: 500, json: {} });
    await act(async () => void (await result.current.send('Again')));
    await advance(0);
    const failed = result.current.messages.find((m) => m.status === 'failed')!;
    act(() => result.current.discard(failed.clientId as string));
    expect(result.current.messages.find((m) => m.status === 'failed')).toBeUndefined();
  });

  it('reports why a send was refused: closed, taken, too long, too fast', async () => {
    vi.useFakeTimers();
    const f = fakeFetch({ [`GET ${BASE}/messages`]: { json: thread() }, [`POST ${BASE}/messages`]: { status: 409, json: { error: 'not-open' } } });
    const { result } = hook(['a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333']);
    await advance(0);
    await act(async () => void (await result.current.send('x')));
    await advance(0);
    expect(result.current.error).toBe('closed');
    f.set(`POST ${BASE}/messages`, { status: 409, json: { error: 'taken' } });
    await act(async () => void (await result.current.send('y')));
    await advance(0);
    expect(result.current.error).toBe('taken');
    f.set(`POST ${BASE}/messages`, { status: 429, json: { error: 'rate-limited' } });
    await act(async () => void (await result.current.send('z')));
    await advance(0);
    expect(result.current.messages.at(-1)).toMatchObject({ status: 'failed', failure: 'rate-limited' });
    // Too long never leaves the browser.
    const before = f.calls.length;
    await act(async () => void (await result.current.send('x'.repeat(2001))));
    expect(result.current.error).toBe('too-long');
    expect(f.calls.length).toBe(before);
  });

  it('marks the newest own message the other side has read as seen', async () => {
    vi.useFakeTimers();
    fakeFetch({
      [`GET ${BASE}/messages`]: {
        json: thread(
          [stored('1', 'customer', 'one', '2026-10-04T12:00:00.000Z'), stored('2', 'customer', 'two', '2026-10-04T12:00:30.000Z')],
          { staffReadAt: '2026-10-04T12:00:10.000Z' },
        ),
      },
      [`POST ${BASE}/read`]: { json: { ok: true } },
    });
    const { result } = hook();
    await advance(0);
    expect(result.current.seenMessageId).toBe('1');
  });

  it('tells the server it has read the conversation when it is in front and has something new, not more often than every few seconds', async () => {
    vi.useFakeTimers();
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: [
        { json: thread([stored('1', 'staff', 'hello', '2026-10-04T12:00:00.000Z')]) },
        { json: thread([stored('2', 'staff', 'again', '2026-10-04T12:00:01.000Z')]) },
        { json: thread([stored('3', 'staff', 'and again', '2026-10-04T12:00:30.000Z')]) },
      ],
      [`POST ${BASE}/read`]: { json: { ok: true } },
    });
    hook();
    await advance(0);
    const reads = () => f.calls.filter((c) => c.url.endsWith('/read')).length;
    expect(reads()).toBe(1);
    await advance(2000);
    expect(reads()).toBe(1); // a new message, but too soon after the last signal
    await advance(4000);
    expect(reads()).toBe(2);
  });

  it('does not report reading while the page is hidden, and does when it comes back', async () => {
    vi.useFakeTimers();
    visibility = 'hidden';
    const f = fakeFetch({
      [`GET ${BASE}/messages`]: { json: thread([stored('1', 'staff', 'hello', '2026-10-04T12:00:00.000Z')]) },
      [`POST ${BASE}/read`]: { json: { ok: true } },
    });
    const { result } = hook();
    await advance(0);
    expect(f.calls.some((c) => c.url.endsWith('/read'))).toBe(false);
    setVisibility('visible');
    await advance(0);
    expect(f.calls.some((c) => c.url.endsWith('/read'))).toBe(true);
    expect(result.current.unseenIncoming).toBe(0);
  });

  it('announces messages that arrive after the first load, not the ones already there', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false); // not looking, so they stay unseen
    fakeFetch({
      [`GET ${BASE}/messages`]: [
        { json: thread([stored('1', 'staff', 'earlier', '2026-10-04T12:00:00.000Z')]) },
        { json: thread([stored('2', 'staff', 'new one', '2026-10-04T12:00:05.000Z')]) },
      ],
    });
    const { result } = hook();
    await advance(0);
    expect(result.current.incoming).toBeNull();
    expect(result.current.unseenIncoming).toBe(0);
    await advance(2000);
    expect(result.current.incoming?.id).toBe('2');
    expect(result.current.unseenIncoming).toBe(1);
  });

  it('stops polling once the conversation is closed', async () => {
    vi.useFakeTimers();
    const f = fakeFetch({ [`GET ${BASE}/messages`]: { json: thread([], { supportMode: 'ended', ended: true }) } });
    hook();
    await advance(0);
    const polls = f.calls.length;
    await advance(60_000);
    expect(f.calls.length).toBe(polls);
  });
});

describe('waiting for a specialist', () => {
  const BASE = '/api/support/conversations/vapi_abc';
  const waiting = (minutesAgo: number, over: Record<string, unknown> = {}) => ({
    json: {
      supportMode: 'human',
      ended: false,
      messages: [],
      staff: null,
      staffTyping: false,
      staffReadAt: null,
      staffOnline: false,
      waitingSince: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      ...over,
    },
  });

  it('nudges towards asking for a callback in the chat after three minutes', async () => {
    fakeFetch({ [`GET ${BASE}/messages`]: waiting(4) });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText(/Still waiting\?/)).toBeTruthy();
    expect(screen.getByText(/Waiting for 4 minutes/)).toBeTruthy();
  });

  it('has no callback form or button, even while waiting (AC-18.1)', async () => {
    fakeFetch({ [`GET ${BASE}/messages`]: waiting(1) });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByLabelText('Your message')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /callback/i })).toBeNull();
    expect(screen.queryByLabelText(/good time to call/)).toBeNull();
  });

  it('does not nudge once a specialist has joined', async () => {
    fakeFetch({ [`GET ${BASE}/messages`]: waiting(5, { staff: { name: 'Sarah', title: null, avatarUrl: null }, waitingSince: null }) });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('Sarah')).toBeTruthy();
    expect(screen.queryByText(/Still waiting/)).toBeNull();
  });

  it('ends the chat only after confirming', async () => {
    const f = fakeFetch({ [`GET ${BASE}/messages`]: waiting(1), [`POST ${BASE}/end`]: { json: { ended: true } } });
    render(<HumanSupport conversationId="vapi_abc" />);
    await userEvent.click(await screen.findByRole('button', { name: 'End chat' }));
    expect(f.calls.some((c) => c.url.endsWith('/end'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Keep chatting' }));
    await userEvent.click(screen.getByRole('button', { name: 'End chat' }));
    await userEvent.click(screen.getByRole('button', { name: 'End this chat' }));
    expect(await screen.findByText('This conversation is closed')).toBeTruthy();
    expect(f.calls.filter((c) => c.url.endsWith('/end'))).toHaveLength(1);
  });

  it('shows "Seen" under the latest message the specialist has read, and "Sending…" until it is stored', async () => {
    fakeFetch({
      [`GET ${BASE}/messages`]: waiting(1, {
        staff: { name: 'Sarah', title: null, avatarUrl: null },
        waitingSince: null,
        staffReadAt: '2026-10-04T12:00:10.000Z',
        messages: [{ id: 'm1', sender: 'customer', body: 'Anyone there?', at: '2026-10-04T12:00:00.000Z', clientId: null, author: null }],
      }),
      [`POST ${BASE}/read`]: { json: { ok: true } },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('Anyone there?')).toBeTruthy();
    expect(await screen.findByText('Seen')).toBeTruthy();
  });

  it('announces a new message from the specialist in the polite status line, without its text', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    fakeFetch({
      [`GET ${BASE}/messages`]: [
        waiting(1, { staff: { name: 'Sarah', title: null, avatarUrl: null }, waitingSince: null }),
        waiting(1, {
          staff: { name: 'Sarah', title: null, avatarUrl: null },
          waitingSince: null,
          messages: [{ id: 'm9', sender: 'staff', body: 'Private details here', at: '2026-10-04T12:00:20.000Z', clientId: null, author: { name: 'Sarah', title: null, avatarUrl: null } }],
        }),
      ],
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    await screen.findByText('Sarah');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('New message from Sarah'), { timeout: 4000 });
    expect(screen.getByRole('status').textContent).not.toContain('Private details');
  });
});

describe('staff chat actions', () => {
  const SB = '/api/staff/conversations/vapi_abc';
  const mine = {
    supportMode: 'human',
    ended: false,
    messages: [{ id: 'm1', sender: 'customer', body: 'My payout failed', at: '2026-10-04T12:00:00.000Z', clientId: null, author: null }],
    assignedTo: { name: 'Sarah' },
    assignedToMe: true,
    canReply: true,
    customerTyping: false,
    customerReadAt: null,
    waitingSince: null,
  };

  it('returns a conversation to the queue only after confirming', async () => {
    const f = fakeFetch({ [`GET ${SB}/messages`]: { json: mine }, [`POST ${SB}/release`]: { json: { released: true } }, [`POST ${SB}/read`]: { json: { ok: true } } });
    render(<StaffChat conversationId="vapi_abc" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Return to queue' }));
    expect(f.calls.some((c) => c.url.endsWith('/release'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Return it now' }));
    await waitFor(() => expect(f.calls.some((c) => c.method === 'POST' && c.url.endsWith('/release'))).toBe(true));
  });

  it('shows how long an unassigned chat has waited, and the customer\'s typing', async () => {
    fakeFetch({
      [`GET ${SB}/messages`]: {
        json: { ...mine, assignedTo: null, assignedToMe: false, customerTyping: true, waitingSince: new Date(Date.now() - 2 * 60_000).toISOString() },
      },
    });
    render(<StaffChat conversationId="vapi_abc" />);
    expect(await screen.findByText(/Waiting for staff\. Take this conversation to reply\. Waiting 2 minutes\./)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Customer is typing…');
  });

  it('retries a reply that did not send', async () => {
    const f = fakeFetch({
      [`GET ${SB}/messages`]: { json: mine },
      [`POST ${SB}/messages`]: [{ status: 500, json: {} }, { status: 201, json: { ok: true } }],
      [`POST ${SB}/typing`]: { json: { ok: true } },
      [`POST ${SB}/read`]: { json: { ok: true } },
    });
    render(<StaffChat conversationId="vapi_abc" />);
    await userEvent.type(await screen.findByLabelText('Reply to the customer'), 'On it');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/messages'))).toHaveLength(2));
    const ids = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/messages')).map((c) => (JSON.parse(c.body as string) as { clientId: string }).clientId);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe('the live staff inbox', () => {
  const item = (over: Partial<QueueItem> = {}): QueueItem => ({
    conversationId: 'c1',
    state: 'waiting',
    statusLabel: 'Waiting for staff',
    customer: 'LagosLedger',
    issue: 'Payment question',
    ticket: null,
    started: '4 Oct 2026',
    waitingSince: new Date(Date.now() - 60_000).toISOString(),
    unread: false,
    assignedToMe: false,
    ...over,
  });
  const inbox = (items: QueueItem[]): InboxData => ({
    counts: {
      open: 0,
      waiting: items.filter((i) => i.state === 'waiting').length,
      inProgress: items.filter((i) => i.state === 'in-progress').length,
      escalated: 0,
      resolvedToday: 0,
    },
    items,
    waitingCount: items.filter((i) => i.state === 'waiting').length,
    unreadCount: items.filter((i) => i.unread).length,
  });
  const audio = () => {
    const oscillators: unknown[] = [];
    class FakeAudio {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() {
        const o = { frequency: { value: 0 }, connect: () => ({ connect: () => undefined }), start: () => undefined, stop: () => undefined };
        oscillators.push(o);
        return o;
      }
      createGain() {
        return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => ({ connect: () => undefined }) };
      }
      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudio);
    return oscillators;
  };
  const mount = (initial: InboxData, ui?: React.ReactNode) =>
    render(
      <StaffInboxProvider initial={initial} pollMs={1000} hiddenPollMs={1000}>
        {ui ?? <LiveQueue variant="queue" role="support_agent" />}
      </StaffInboxProvider>,
    );

  beforeEach(() => {
    document.title = 'Support queue';
    window.localStorage.clear();
  });

  it('starts from what the server gave it and shows the working queue with counts', () => {
    fakeFetch({ 'GET /api/staff/queue': { json: inbox([item()]) } });
    mount(inbox([item({ customer: 'LagosLedger' })]));
    expect(screen.getByText('LagosLedger')).toBeTruthy();
    expect(screen.getByText('Waiting for staff', { selector: 'p' })).toBeTruthy();
  });

  it('picks up a new waiting conversation without a reload, with a title count and a polite message', async () => {
    fakeFetch({ 'GET /api/staff/queue': { json: inbox([item({ conversationId: 'c1' }), item({ conversationId: 'c2', customer: 'NairobiOps' })]) } });
    mount(inbox([item({ conversationId: 'c1' })]));
    expect(await screen.findByText('NairobiOps', {}, { timeout: 4000 })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('(2) Support queue'));
    await waitFor(() => expect(screen.getByRole('status', { hidden: true }).textContent).toBe('A new conversation is waiting'));
  });

  it('shows a count beside Queue in the navigation, readable by screen readers', () => {
    fakeFetch({ 'GET /api/staff/queue': { json: inbox([item()]) } });
    mount(
      inbox([item(), item({ conversationId: 'c2' })]),
      <NavLinks items={[{ href: '/staff', label: 'Queue', icon: 'queue', badge: 'inbox' }]} label="Staff" />,
    );
    const link = screen.getByRole('link', { name: 'Queue, 2 need attention' });
    expect(link.textContent).toContain('2');
  });

  it('plays a sound or shows a desktop notification only when switched on and the page is not in front', async () => {
    const oscillators = audio();
    const shown: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
      constructor(title: string) {
        shown.push(title);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const f = fakeFetch({ 'GET /api/staff/queue': { json: inbox([item({ conversationId: 'c1' })]) } });
    mount(inbox([item({ conversationId: 'c1' })]));
    // Nothing is on by default, and the browser was not asked for anything.
    f.set('GET /api/staff/queue', { json: inbox([item({ conversationId: 'c1' }), item({ conversationId: 'c2', customer: 'NairobiOps' })]) });
    await screen.findByText('NairobiOps', {}, { timeout: 4000 });
    expect(oscillators).toHaveLength(0);
    expect(shown).toHaveLength(0);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    // Turning them on is a click; the permission question is asked then.
    await userEvent.click(screen.getByLabelText('Play a sound for new conversations'));
    await userEvent.click(screen.getByLabelText('Show desktop notifications'));
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('rp_staff_sound')).toBe('1');

    // Page in front and focused: still silent. Page hidden: both.
    f.set('GET /api/staff/queue', { json: inbox([item({ conversationId: 'c1' }), item({ conversationId: 'c2' }), item({ conversationId: 'c3', customer: 'AccraStack' })]) });
    await screen.findByText('AccraStack', {}, { timeout: 4000 });
    expect(oscillators).toHaveLength(0);
    expect(shown).toHaveLength(0);

    visibility = 'hidden';
    f.set('GET /api/staff/queue', { json: inbox([item({ conversationId: 'c1' }), item({ conversationId: 'c2' }), item({ conversationId: 'c3' }), item({ conversationId: 'c4', customer: 'KigaliWorks' })]) });
    await screen.findByText('KigaliWorks', {}, { timeout: 4000 });
    expect(oscillators.length).toBeGreaterThan(0);
    expect(shown).toEqual(['RelayPay Support Desk']);
  });

  it('says when the connection is lost and keeps what was already on screen', async () => {
    fakeFetch({ 'GET /api/staff/queue': { status: 503, json: { error: 'unavailable' } } });
    mount(inbox([item()]));
    expect(await screen.findByText(/Connection problem/)).toBeTruthy();
    expect(screen.getByText('LagosLedger')).toBeTruthy(); // what was on screen stays
  });
});

describe('the availability switch', () => {
  it('sends a heartbeat while available, and none when away', async () => {
    vi.useFakeTimers();
    const f = fakeFetch({ 'POST /api/staff/presence': { json: { ok: true } } });
    const { unmount } = render(<PresenceControl initialAvailable />);
    await advance(0);
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    await advance(35_000); // 30 s, plus up to 15 % of spread
    expect(f.calls.filter((c) => c.method === 'POST').length).toBeGreaterThanOrEqual(2);
    unmount();
    cleanup();

    const g = fakeFetch({ 'POST /api/staff/presence': { json: { ok: true } } });
    render(<PresenceControl initialAvailable={false} />);
    await advance(120_000);
    expect(g.calls).toHaveLength(0);
  });

  it('switches on and off, and says if it could not', async () => {
    const f = fakeFetch({ 'POST /api/staff/presence': [{ json: { ok: true, available: true } }, { status: 503, json: { error: 'unavailable' } }] });
    render(<PresenceControl initialAvailable={false} />);
    const toggle = screen.getByRole('switch', { name: /Available for chats/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(f.calls.some((c) => c.body === JSON.stringify({ available: true }))).toBe(true);
    await userEvent.click(toggle);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not change your availability');
    expect(toggle.getAttribute('aria-checked')).toBe('true'); // unchanged when it failed
  });
});
