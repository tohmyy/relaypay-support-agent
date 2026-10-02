// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HumanSupport from '@/components/shell/HumanSupport';
import { SHELL_COPY } from '@/lib/shell-copy';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fakeFetch(routes: Record<string, { status?: number; json: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split('?')[0];
      const hit = Object.entries(routes).find(([key]) => url.endsWith(key) || url === key);
      if (!hit) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(hit[1].json), { status: hit[1].status ?? 200 });
    }),
  );
}

describe('specialist UX', () => {
  it('announces when a specialist joins and keeps the closed banner after the chat ends', async () => {
    fakeFetch({
      '/messages': {
        json: {
          supportMode: 'human',
          ended: false,
          messages: [],
          staff: { name: 'Sarah Adeyemi', title: 'Support Specialist', avatarUrl: null },
          staffTyping: false,
        },
      },
      '/read': { json: { ok: true } },
      '/transcript': { json: { turns: [{ id: '1', role: 'assistant', displayText: 'I checked TXN-9001.', createdAt: '2026-10-01T12:00:00Z' }], cursor: null } },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('Sarah Adeyemi has joined this conversation.')).toBeTruthy();
    expect(screen.getByText(SHELL_COPY.human.earlierTitle)).toBeTruthy();
    expect(await screen.findByText('I checked TXN-9001.')).toBeTruthy();
  });

  it('replaces the composer with the closed state and says the ticket is closed', async () => {
    fakeFetch({
      '/messages': {
        json: {
          supportMode: 'ended',
          ended: true,
          messages: [],
          staff: { name: 'Sarah Adeyemi', title: 'Support Specialist', avatarUrl: null },
        },
      },
      '/read': { json: { ok: true } },
      '/transcript': { json: { turns: [], cursor: null } },
    });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText(SHELL_COPY.human.closedBody)).toBeTruthy();
    expect(screen.queryByLabelText(SHELL_COPY.human.messageLabel)).toBeNull();
  });
});
