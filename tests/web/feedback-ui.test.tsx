// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationComplete from '@/components/ConversationComplete';
import SessionFeedback from '@/components/SessionFeedback';
import { isCurrent } from '@/components/shell/NavLinks';
import { SHELL_COPY } from '@/lib/shell-copy';

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

const copy = SHELL_COPY.feedback;

function stubFetch(status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ saved: true }), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SessionFeedback (AC-33.1, AC-33.2)', () => {
  it('asks for a 1 to 5 rating with an optional comment, and can be skipped', async () => {
    render(<SessionFeedback conversationId="vapi_abc" stage="ai" />);
    expect(screen.getByRole('heading', { name: copy.aiTitle })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByLabelText(copy.commentLabel)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: copy.skip }));
    expect(screen.queryByRole('heading', { name: copy.aiTitle })).toBeNull();
  });

  it('uses the specialist wording for the human stage', () => {
    render(<SessionFeedback conversationId="vapi_abc" stage="human" />);
    expect(screen.getByRole('heading', { name: copy.humanTitle })).toBeTruthy();
  });

  it('needs a rating before it sends anything', async () => {
    const fetchMock = stubFetch();
    render(<SessionFeedback conversationId="vapi_abc" stage="ai" />);
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));
    expect(screen.getByRole('alert').textContent).toBe(copy.needRating);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the stage, rating and comment for this conversation, then thanks the customer', async () => {
    const fetchMock = stubFetch();
    render(<SessionFeedback conversationId="vapi_abc" stage="ai" />);
    await userEvent.click(screen.getByRole('radio', { name: copy.star.replace('{n}', '4') }));
    expect(screen.getByRole('radio', { name: copy.star.replace('{n}', '4') }).getAttribute('aria-checked')).toBe('true');
    await userEvent.type(screen.getByLabelText(copy.commentLabel), 'Quick and clear');
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.thanks));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/support/conversations/vapi_abc/feedback');
    expect(JSON.parse(String(init.body))).toEqual({ stage: 'ai', rating: 4, comment: 'Quick and clear' });
  });

  it('keeps the form and says so when sending fails', async () => {
    stubFetch(503);
    render(<SessionFeedback conversationId="vapi_abc" stage="human" />);
    await userEvent.click(screen.getByRole('radio', { name: copy.star.replace('{n}', '2') }));
    await userEvent.click(screen.getByRole('button', { name: copy.submit }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.failed);
    expect(screen.getByRole('button', { name: copy.submit })).toBeTruthy();
  });

  it('sits beside Start another / View transcript and does not replace them', () => {
    render(
      <ConversationComplete ticketReference={null} escalated={false} conversationId="vapi_abc" embedded linkStatus="linked" onStartAnother={() => {}}>
        <SessionFeedback conversationId="vapi_abc" stage="ai" />
      </ConversationComplete>,
    );
    expect(screen.getByRole('button', { name: 'Start another conversation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View transcript' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: copy.aiTitle })).toBeTruthy();
  });

  it('uses no technical vocabulary', () => {
    const { container } = render(<SessionFeedback conversationId="vapi_abc" stage="ai" />);
    expect(container.textContent!.toLowerCase()).not.toMatch(/\b(mcp|rag|supabase|vapi|sdk|agent|claude)\b/);
  });
});

describe('navigation marks only one item current', () => {
  const support = { href: '/support', prefix: true, exclude: ['/support/history'] };
  const history = { href: '/support/history' };

  it('keeps conversations under Support and History apart', () => {
    expect(isCurrent('/support', support)).toBe(true);
    expect(isCurrent('/support/vapi_abc', support)).toBe(true);
    expect(isCurrent('/support/history', support)).toBe(false);
    expect(isCurrent('/support/history', history)).toBe(true);
    expect(isCurrent('/support/vapi_abc', history)).toBe(false);
  });
});
