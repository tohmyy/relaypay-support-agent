// @vitest-environment jsdom
import { cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getContactMethodsDetail: vi.fn(),
  isAnyStaffOnline: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ usePathname: () => '/staff/settings', redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock('@/lib/auth/dal', () => ({ requireRole: (...a: unknown[]) => h.requireRole(...a) }));
vi.mock('@/lib/dashboard/data.server', () => ({ isAnyStaffOnline: () => h.isAnyStaffOnline() }));
vi.mock('@/lib/settings/contact-methods.server', () => ({ getContactMethodsDetail: () => h.getContactMethodsDetail() }));

import StaffSettingsPage from '@/app/(staff)/staff/settings/page';
import ContactMethodsSettings from '@/components/shell/ContactMethodsSettings';
import HumanSupport from '@/components/shell/HumanSupport';

configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(routes: Record<string, { status?: number; json: unknown }>) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body as string | undefined });
    const r = routes[`${method} ${url.split('?')[0]}`];
    return r ? new Response(JSON.stringify(r.json), { status: r.status ?? 200 }) : new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

describe('the settings form', () => {
  const API = 'PUT /api/staff/settings/contact-methods';
  const mount = (initial = { textChat: true, callback: true }, extra: Partial<React.ComponentProps<typeof ContactMethodsSettings>> = {}) =>
    render(<ContactMethodsSettings initial={initial} staffOnline lastChanged={null} {...extra} />);

  it('shows each method with its status, the phone call as not available, and nothing to save yet', () => {
    mount();
    const chat = screen.getByRole('checkbox', { name: /Live text chat/ });
    const callback = screen.getByRole('checkbox', { name: /Callback request/ });
    const phone = screen.getByRole('checkbox', { name: /Live phone call/ });
    expect(chat).toHaveProperty('checked', true);
    expect(callback).toHaveProperty('checked', true);
    expect(phone).toHaveProperty('checked', false);
    expect(phone).toHaveProperty('disabled', true);
    expect(screen.getByText('Not available yet')).toBeTruthy();
    expect(screen.getAllByText('On')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
    expect(screen.getByText('A member of staff is online now.')).toBeTruthy();
    expect(screen.getByText('Not changed yet: both are on.')).toBeTruthy();
  });

  it('says who changed it last, and whether nobody is online', () => {
    mount({ textChat: true, callback: true }, { staffOnline: false, lastChanged: { when: '5 Oct 2026, 09:00 UTC', who: 'Support Admin' } });
    expect(screen.getByText('Last changed 5 Oct 2026, 09:00 UTC by Support Admin.')).toBeTruthy();
    expect(screen.getByText(/Nobody is online now/)).toBeTruthy();
  });

  it('saves a change with one button and confirms it', async () => {
    const calls = stubFetch({ [API]: { json: { methods: { textChat: false, callback: true } } } });
    mount();
    await userEvent.click(screen.getByRole('checkbox', { name: /Live text chat/ }));
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText(/Customers are not offered this/)).toBeTruthy();
    expect(screen.getByText('You have unsaved changes.')).toBeTruthy();
    expect(calls).toHaveLength(0); // nothing is sent until Save
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Saved\. The assistant uses the new setting/)).toBeTruthy();
    expect(JSON.parse(calls[0].body as string)).toEqual({ textChat: false, callback: true });
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
  });

  it('will not let every method be switched off', async () => {
    const calls = stubFetch({ [API]: { json: {} } });
    mount();
    await userEvent.click(screen.getByRole('checkbox', { name: /Live text chat/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Callback request/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Keep at least one method on');
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('checkbox', { name: /Callback request/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('keeps the change and says so when saving fails, so it can be tried again', async () => {
    stubFetch({ [API]: { status: 503, json: { error: 'unavailable' } } });
    mount();
    await userEvent.click(screen.getByRole('checkbox', { name: /Callback request/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Callback request/ })).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false);
  });

  it('describes every method for someone who cannot see the switch', () => {
    mount();
    expect(screen.getByRole('checkbox', { name: /Live text chat/ }).getAttribute('aria-describedby')).toBe('method-text-chat-help');
    expect(document.getElementById('method-text-chat-help')?.textContent).toMatch(/signed in/);
  });
});

describe('the settings page', () => {
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset();
    h.isAnyStaffOnline.mockResolvedValue(false);
  });

  it('is for administrators: anyone else is sent away before anything is read', async () => {
    h.requireRole.mockRejectedValue(new Error('REDIRECT:/staff'));
    await expect(StaffSettingsPage()).rejects.toThrow('REDIRECT:/staff');
    expect(h.requireRole).toHaveBeenCalledWith(['support_admin'], '/staff/settings');
    expect(h.getContactMethodsDetail).not.toHaveBeenCalled();
  });

  it('shows the saved choice to an administrator', async () => {
    h.requireRole.mockResolvedValue({ role: 'support_admin' });
    h.getContactMethodsDetail.mockResolvedValue({ methods: { textChat: false, callback: true }, updatedAt: '2026-10-05T09:00:00Z', updatedBy: 'Support Admin' });
    const html = renderToStaticMarkup(await StaffSettingsPage());
    expect(html).toContain('Live text chat');
    expect(html).toContain('Last changed 5 Oct 2026, 09:00 UTC by Support Admin.');
    expect(html).toMatch(/id="method-text-chat"[^>]*/);
    expect(html).not.toMatch(/id="method-text-chat"[^>]*checked/);
    expect(html).toMatch(/id="method-callback"[^>]*checked/);
  });

  it('says so, without a form, when the setting cannot be loaded', async () => {
    h.requireRole.mockResolvedValue({ role: 'support_admin' });
    h.getContactMethodsDetail.mockRejectedValue(new Error('down'));
    const html = renderToStaticMarkup(await StaffSettingsPage());
    expect(html).toContain('Could not load the settings');
    expect(html).not.toContain('Save changes');
  });
});

describe('the customer chat when the callback is off', () => {
  const BASE = '/api/support/conversations/vapi_abc';
  const waiting = (over: Record<string, unknown>) => ({
    json: {
      supportMode: 'human',
      ended: false,
      messages: [],
      staff: null,
      staffTyping: false,
      staffReadAt: null,
      staffOnline: false,
      waitingSince: new Date(Date.now() - 5 * 60_000).toISOString(),
      callbackAvailable: true,
      ...over,
    },
  });

  it('points to the message box for a callback when it is on (no callback form)', async () => {
    stubFetch({ [`GET ${BASE}/messages`]: waiting({}) });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText(/tell us a day and time in the message box/)).toBeTruthy();
    expect(screen.getByText(/Still waiting\? Tell us in the message box when you would like a callback/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /callback/i })).toBeNull();
  });

  it('does not offer or mention a callback when an administrator turned it off, but still lets the customer end the chat', async () => {
    stubFetch({ [`GET ${BASE}/messages`]: waiting({ callbackAvailable: false }) });
    render(<HumanSupport conversationId="vapi_abc" />);
    expect(await screen.findByText('Our team will reply as soon as someone is free.')).toBeTruthy();
    expect(screen.getByText(/Thanks for your patience/)).toBeTruthy();
    expect(screen.queryByText(/callback/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'End chat' })).toBeTruthy();
  });
});
