import { afterAll, describe, expect, it } from 'vitest';
import { getSupabase } from '../../services/agent/src/supabase';
import { retrieveKnowledge } from '../../services/agent/retrieval/retrieve';

const live = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

// BUILD-PLAN section 13. Runs against the real Supabase project; skipped without credentials.
describe.skipIf(!live)('retrieval acceptance (live)', () => {
  const startedAt = new Date().toISOString();

  // These calls log to retrieval_logs without a conversation id; remove what this run wrote.
  afterAll(async () => {
    if (live) await getSupabase().from('retrieval_logs').delete().is('conversation_id', null).gte('created_at', startedAt);
  });

  const cases: [string, string[]][] = [
    ['How much does RelayPay charge?', ['How Does RelayPay Charge Fees?']],
    ['How long does an international payout take?', ['How Long Do Payments Take To Process?']],
    ['Why can a payout be delayed?', ['Why Is My Payment Delayed?']],
    [
      'What happens if my account is restricted?',
      ['What Should I Do If My Account Is Restricted?', 'Account Restrictions And Suspensions'],
    ],
    ['Can RelayPay guarantee my payout arrives tomorrow?', ['Can RelayPay Guarantee Payment Timelines?']],
  ];

  it.each(cases)('%s', async (question, expected) => {
    const r = await retrieveKnowledge(question, { limit: 3 });
    expect(r.empty).toBe(false);
    expect(r.sourceTitles.some((t) => expected.includes(t))).toBe(true);
  });

  it('returns empty for an out-of-scope question', async () => {
    const r = await retrieveKnowledge("What's the weather in Paris?");
    expect(r.empty).toBe(true);
  });
});
