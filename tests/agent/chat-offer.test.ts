import { describe, expect, it } from 'vitest';
import {
  ChatOfferSource,
  DEFAULT_METHODS,
  STAFF_ONLINE_WINDOW_MS,
  parseContactMethods,
} from '../../services/agent/src/chat-offer';
import { fakeDb, type Row } from './fake-db';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const seen = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const staff = (over: Row = {}): Row => ({
  id: 's1',
  role: 'support_agent',
  available: true,
  disabled: false,
  last_seen_at: seen(10_000),
  ...over,
});
const amara: Row = { customer_id: 'CUS-1001', contact_name: 'Amara Okafor', contact_email: 'amara@lagosledger.example' };
const setting = (value: unknown): Row[] => [{ key: 'contact_methods', value }];

function setup(users: Row[], customers: Row[] = [amara], settings: Row[] = []) {
  const clock = { t: NOW };
  const fake = fakeDb({ app_users: users, customers, app_settings: settings });
  return { ...fake, clock, source: new ChatOfferSource(fake.db, () => clock.t) };
}

describe('staff online check', () => {
  it('counts an available staff member who was seen recently', async () => {
    expect(await setup([staff()]).source.staffOnline()).toBe(true);
  });

  it.each([
    ['not available', { available: false }],
    ['not seen for a while', { last_seen_at: seen(STAFF_ONLINE_WINDOW_MS + 1000) }],
    ['never seen', { last_seen_at: null }],
    ['disabled', { disabled: true }],
    ['a customer account', { role: 'customer' }],
  ])('ignores someone who is %s', async (_label, over) => {
    expect(await setup([staff(over as Row)]).source.staffOnline()).toBe(false);
  });

  it('counts an admin, and says no when there is nobody', async () => {
    expect(await setup([staff({ role: 'support_admin' })]).source.staffOnline()).toBe(true);
    expect(await setup([]).source.staffOnline()).toBe(false);
  });

  it('caches the answer for a few seconds, then looks again', async () => {
    const s = setup([staff()]);
    await s.source.staffOnline();
    const queries = s.queries.length;
    await s.source.staffOnline();
    expect(s.queries.length).toBe(queries);
    s.clock.t += 16_000;
    s.tables.app_users[0].available = false;
    expect(await s.source.staffOnline()).toBe(false);
    expect(s.queries.length).toBeGreaterThan(queries);
  });
});

describe('the administrator\'s setting', () => {
  it('reads both methods as on unless one was turned off', () => {
    expect(parseContactMethods(undefined)).toEqual(DEFAULT_METHODS);
    expect(parseContactMethods({})).toEqual(DEFAULT_METHODS);
    expect(parseContactMethods({ text_chat: false })).toEqual({ textChat: false, callback: true });
    expect(parseContactMethods({ callback: false })).toEqual({ textChat: true, callback: false });
    expect(parseContactMethods({ text_chat: true, callback: true })).toEqual(DEFAULT_METHODS);
  });

  it('treats nonsense as "on" and a saved value with both off as a mistake (both on)', () => {
    expect(parseContactMethods('off')).toEqual(DEFAULT_METHODS);
    expect(parseContactMethods({ text_chat: 'no', callback: 0 })).toEqual(DEFAULT_METHODS);
    expect(parseContactMethods({ text_chat: false, callback: false })).toEqual(DEFAULT_METHODS);
  });

  it('is read from the database, cached briefly, and defaults to both on when nothing is saved or it cannot be read', async () => {
    const s = setup([], [amara], setting({ text_chat: false, callback: true }));
    expect(await s.source.methods()).toEqual({ textChat: false, callback: true });
    const reads = s.queries.filter((q) => q === 'app_settings').length;
    await s.source.methods();
    expect(s.queries.filter((q) => q === 'app_settings').length).toBe(reads);
    s.clock.t += 16_000;
    s.tables.app_settings[0].value = { text_chat: true, callback: false };
    expect(await s.source.methods()).toEqual({ textChat: true, callback: false });

    expect(await setup([]).source.methods()).toEqual(DEFAULT_METHODS);
    const broken = setup([], [amara], setting({ text_chat: false }));
    broken.failNext('app_settings');
    expect(await broken.source.methods()).toEqual(DEFAULT_METHODS);
  });
});

describe('what the assistant is told for this caller', () => {
  it('both methods on, linked customer: text chat with the account details and who is online', async () => {
    expect(await setup([staff()]).source.contactFor('CUS-1001', true)).toEqual({
      textChat: true,
      callback: true,
      staffOnline: true,
      customer: { name: 'Amara Okafor', email: 'amara@lagosledger.example' },
    });
    expect((await setup([]).source.contactFor('CUS-1001', true))?.staffOnline).toBe(false);
  });

  it('says nothing extra when handoff is off and the callback is on: the normal callback procedure', async () => {
    const s = setup([staff()]);
    expect(await s.source.contactFor('CUS-1001', false)).toBeUndefined();
    expect(await s.source.contactFor(null, false)).toBeUndefined();
  });

  it('turns the text chat off when an administrator did, even for a linked customer', async () => {
    const s = setup([staff()], [amara], setting({ text_chat: false, callback: true }));
    expect(await s.source.contactFor('CUS-1001', true)).toEqual({ textChat: false, callback: true, staffOnline: false, customer: null });
  });

  it('turns the callback off when an administrator did, with or without handoff', async () => {
    const s = setup([staff()], [amara], setting({ text_chat: true, callback: false }));
    expect(await s.source.contactFor('CUS-1001', true)).toMatchObject({ textChat: true, callback: false });
    // Handoff off: the text chat is not possible, and the callback is off too, so there is nothing to offer.
    expect(await s.source.contactFor('CUS-1001', false)).toEqual({ textChat: false, callback: false, staffOnline: false, customer: null });
  });

  it('offers no text chat to a caller who is not a linked customer', async () => {
    expect(await setup([staff()]).source.contactFor(null, true)).toEqual({ textChat: false, callback: true, staffOnline: false, customer: null });
    const textOnly = setup([staff()], [amara], setting({ callback: false }));
    expect(await textOnly.source.contactFor(null, true)).toEqual({ textChat: false, callback: false, staffOnline: false, customer: null });
  });

  it('offers no text chat when the account has no usable contact details or does not exist', async () => {
    const noEmail = setup([staff()], [{ customer_id: 'CUS-1001', contact_name: 'Amara', contact_email: null }]);
    expect(await noEmail.source.contactFor('CUS-1001', true)).toMatchObject({ textChat: false, callback: true, customer: null });
    expect(await setup([staff()], []).source.contactFor('CUS-1001', true)).toMatchObject({ textChat: false, callback: true });
  });

  it('keeps going, without the text chat, when a lookup fails', async () => {
    const s = setup([staff()]);
    s.failNext('customers');
    expect(await s.source.contactFor('CUS-1001', true)).toMatchObject({ textChat: false, callback: true });
    const t = setup([staff()]);
    t.failNext('app_users');
    expect(await t.source.contactFor('CUS-1001', true)).toMatchObject({ textChat: false, callback: true });
  });

  it('remembers contact details for a while', async () => {
    const s = setup([staff()]);
    await s.source.contactFor('CUS-1001', true);
    const lookups = s.queries.filter((q) => q === 'customers').length;
    await s.source.contactFor('CUS-1001', true);
    expect(s.queries.filter((q) => q === 'customers').length).toBe(lookups);
    s.clock.t += 6 * 60_000;
    await s.source.contactFor('CUS-1001', true);
    expect(s.queries.filter((q) => q === 'customers').length).toBe(lookups + 1);
  });

  it('keeps one customer\'s details apart from another\'s', async () => {
    const s = setup([staff()], [amara, { customer_id: 'CUS-1002', contact_name: 'Daniel Mwangi', contact_email: 'daniel@nairobiops.example' }]);
    expect((await s.source.contactFor('CUS-1001', true))?.customer?.name).toBe('Amara Okafor');
    expect((await s.source.contactFor('CUS-1002', true))?.customer?.name).toBe('Daniel Mwangi');
  });
});
