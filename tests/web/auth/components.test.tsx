// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ pathname: '/dashboard', conversationId: null as string | null }));

vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useVoiceSession', () => ({
  useVoiceSession: () => ({
    voice: {},
    support: {},
    turns: [],
    backend: { ticketReference: null, escalation: null },
    level: 0,
    session: {},
    endReason: null,
    conversationId: h.conversationId,
    start: async () => {},
    end: async () => {},
  }),
}));
vi.mock('@/components/SupportWorkspace', () => ({ default: () => <div data-testid="workspace" /> }));
vi.mock('@/components/Header', () => ({ default: () => <header data-testid="public-header" /> }));
vi.mock('@/lib/voice/vapi-client', () => ({ createVapiClient: vi.fn() }));

import AppShell from '@/components/shell/AppShell';
import LoginForm from '@/components/shell/LoginForm';
import NavLinks, { isCurrent } from '@/components/shell/NavLinks';
import SupportPage from '@/components/SupportPage';

afterEach(cleanup);

describe('LoginForm', () => {
  it('has labelled fields, a submit button and carries the next path', () => {
    const { container } = render(<LoginForm action={async () => ({ error: null })} next="/payments" />);
    expect(screen.getByLabelText('Email address')).toHaveProperty('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveProperty('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(container.querySelector('input[name="next"]')).toHaveProperty('value', '/payments');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces a failure as an alert and marks the fields invalid', async () => {
    const action = vi.fn(async () => ({ error: 'That email address or password is not right.' }));
    render(<LoginForm action={action} next="" />);
    await userEvent.type(screen.getByLabelText('Email address'), 'a@x.example');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever12345');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('not right');
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('disables the button and says so while signing in', async () => {
    let finish: (v: { error: null }) => void = () => {};
    const action = () => new Promise<{ error: null }>((r) => (finish = r));
    render(<LoginForm action={action} next="" />);
    await userEvent.type(screen.getByLabelText('Email address'), 'a@x.example');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever12345');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const pending = await screen.findByRole('button', { name: 'Signing in…' });
    expect(pending).toHaveProperty('disabled', true);
    finish({ error: null });
  });
});

describe('navigation', () => {
  const items = [
    { href: '/dashboard', label: 'Overview', icon: 'overview' as const },
    { href: '/support', label: 'Support', icon: 'support' as const, prefix: true },
  ];

  it('marks only the current page', () => {
    h.pathname = '/dashboard';
    render(<NavLinks items={items} label="Main" />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('aria-current')).toBeNull();
  });

  it('counts pages under a prefix as current, but not look-alike paths', () => {
    expect(isCurrent('/support/vapi_abc', items[1])).toBe(true);
    expect(isCurrent('/supports', items[1])).toBe(false);
    expect(isCurrent('/support/x', items[0])).toBe(false);
  });
});

describe('AppShell', () => {
  it('shows who is signed in, the navigation, a skip link and a sign-out button', () => {
    h.pathname = '/dashboard';
    const signOut = vi.fn(async () => {});
    render(
      <AppShell
        brand="RelayPay"
        homeHref="/dashboard"
        nav={[{ href: '/dashboard', label: 'Overview', icon: 'overview' }]}
        navLabel="Main"
        skipLabel="Skip to main content"
        signOutLabel="Sign out"
        signOut={signOut}
        user={{ displayName: 'Amara Okafor', subtitle: 'LagosLedger' }}
      >
        <p>Page body</p>
      </AppShell>,
    );
    expect(screen.getByText('Amara Okafor')).toBeTruthy();
    expect(screen.getByText('LagosLedger')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').textContent).toContain('Page body');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('SupportPage identity link', () => {
  const vapi = { mode: 'vapi' as const, publicKey: 'pk', assistantId: 'as' };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h.conversationId = 'vapi_abc';
    fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ties a real call to the signed-in customer once, using only the call id', async () => {
    const { rerender } = render(<SupportPage config={vapi} embedded linkIdentity />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/support/link');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ conversationId: 'vapi_abc' });
    rerender(<SupportPage config={vapi} embedded linkIdentity />);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the public page, in preview mode or before the call has an id', async () => {
    render(<SupportPage config={vapi} />);
    cleanup();
    render(<SupportPage config={{ mode: 'mock' }} embedded linkIdentity />);
    cleanup();
    h.conversationId = null;
    render(<SupportPage config={vapi} embedded linkIdentity />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the public header only outside the shell', () => {
    h.conversationId = null;
    const { unmount } = render(<SupportPage config={vapi} />);
    expect(screen.getByTestId('public-header')).toBeTruthy();
    unmount();
    render(<SupportPage config={vapi} embedded />);
    expect(screen.queryByTestId('public-header')).toBeNull();
    expect(screen.getByTestId('workspace')).toBeTruthy();
  });

  it('does not break the call when the link request fails', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'));
    render(<SupportPage config={vapi} embedded linkIdentity />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.getByTestId('workspace')).toBeTruthy();
  });
});
