import { describe, expect, it } from 'vitest';
import { validateContact } from '@/lib/contact';
import {
  CONVERSATION_ID_PATTERN,
  NEUTRAL_STATE,
  toPublicState,
  type ConversationRows,
} from '@/lib/conversation-state';
import { COPY, FORBIDDEN_CUSTOMER_TERMS, VOICE_PROMPT, VOICE_STATUS } from '@/lib/copy';
import { deriveSupportState, emptyBackendState } from '@/lib/support/derive';
import { addTypedTurn, applyTranscript, type ConversationTurn } from '@/lib/transcript';
import { classifyVapiError } from '@/lib/voice/vapi-client';
import {
  initialVoiceModel,
  voiceReducer,
  type VoiceEvent,
  type VoiceModel,
  type VoiceState,
} from '@/lib/voice/state';

const run = (events: VoiceEvent[], from: VoiceModel = initialVoiceModel) => events.reduce(voiceReducer, from);

describe('voice state machine', () => {
  it('follows the normal call flow', () => {
    expect(run([{ type: 'START' }]).state).toBe('connecting');
    expect(run([{ type: 'START' }, { type: 'CALL_STARTED' }]).state).toBe('listening');
    expect(run([{ type: 'START' }, { type: 'CALL_STARTED' }, { type: 'USER_SPEECH_START' }]).state).toBe('user-speaking');
    const afterSpeech = run([
      { type: 'START' },
      { type: 'CALL_STARTED' },
      { type: 'USER_SPEECH_START' },
      { type: 'USER_SPEECH_END' },
    ]);
    expect(afterSpeech.state).toBe('processing');
    expect(voiceReducer(afterSpeech, { type: 'ASSISTANT_SPEECH_START' }).state).toBe('assistant-speaking');
    expect(run([{ type: 'ASSISTANT_SPEECH_END' }], { state: 'assistant-speaking' }).state).toBe('listening');
  });

  it('lets the customer talk over the assistant', () => {
    expect(run([{ type: 'USER_SPEECH_START' }], { state: 'assistant-speaking' }).state).toBe('user-speaking');
  });

  it('ends a call from any active state and then reaches ended', () => {
    for (const state of ['connecting', 'listening', 'user-speaking', 'processing', 'assistant-speaking'] as VoiceState[]) {
      expect(run([{ type: 'END_REQUESTED' }], { state }).state).toBe('ending');
    }
    expect(run([{ type: 'CALL_ENDED' }], { state: 'ending' }).state).toBe('ended');
    expect(run([{ type: 'CALL_ENDED' }], { state: 'listening' }).state).toBe('ended');
  });

  it('records the error kind, and retry starts again', () => {
    const failed = run([{ type: 'START' }, { type: 'ERROR', kind: 'microphone' }]);
    expect(failed).toEqual({ state: 'error', error: 'microphone' });
    expect(voiceReducer(failed, { type: 'START' })).toEqual({ state: 'connecting' });
  });

  it('keeps an error visible when the call reports it ended afterwards', () => {
    const failed: VoiceModel = { state: 'error', error: 'connection' };
    expect(voiceReducer(failed, { type: 'CALL_ENDED' })).toBe(failed);
  });

  it('only restarts from idle, ended or error', () => {
    for (const state of ['connecting', 'listening', 'processing', 'ending'] as VoiceState[]) {
      expect(run([{ type: 'START' }], { state }).state).toBe(state);
    }
    expect(run([{ type: 'START' }], { state: 'ended' }).state).toBe('connecting');
  });

  it('ignores events that make no sense for the current state', () => {
    expect(run([{ type: 'USER_SPEECH_START' }]).state).toBe('idle');
    expect(run([{ type: 'CALL_STARTED' }], { state: 'listening' }).state).toBe('listening');
    expect(run([{ type: 'ERROR', kind: 'service' }], { state: 'ended' }).state).toBe('ended');
    expect(run([{ type: 'ASSISTANT_SPEECH_END' }], { state: 'processing' }).state).toBe('processing');
  });
});

describe('support state derivation', () => {
  const flags = { callEnded: false, contactSubmitted: false };
  const backend = (over: Partial<typeof emptyBackendState> = {}) => ({ ...emptyBackendState, ...over });

  it.each([
    [backend(), flags, 'normal'],
    [backend({ answerType: 'direct_answer' }), flags, 'normal'],
    [backend({ answerType: 'clarification' }), flags, 'clarifying'],
    [backend({ ticketReference: 'TKT-000001', answerType: 'clarification' }), flags, 'ticket-created'],
    [backend({ answerType: 'escalation' }), flags, 'escalation-required'],
    [backend({ answerType: 'escalation' }), { ...flags, contactSubmitted: true }, 'escalating'],
    [backend({ answerType: 'escalation', escalation: { requestedTime: null } }), { ...flags, contactSubmitted: true }, 'escalated'],
    [backend({ escalation: { requestedTime: 'Tuesday' } }), flags, 'escalated'],
    [backend({ escalation: { requestedTime: null } }), { ...flags, callEnded: true }, 'completed'],
    [backend(), { ...flags, callEnded: true }, 'completed'],
  ] as const)('%j with %j is %s', (b, f, expected) => {
    expect(deriveSupportState(b, f)).toBe(expected);
  });
});

describe('transcript', () => {
  const ev = (role: 'user' | 'assistant', text: string, final: boolean) => ({ role, text, final });

  it('updates a partial turn in place and then finalizes it', () => {
    let turns: ConversationTurn[] = [];
    turns = applyTranscript(turns, ev('user', 'how much', false), 1);
    turns = applyTranscript(turns, ev('user', 'how much are fees', false), 2);
    turns = applyTranscript(turns, ev('user', 'How much are fees?', true), 3);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ speaker: 'user', text: 'How much are fees?', final: true });
  });

  it('starts a new turn after a final one or when the speaker changes', () => {
    let turns = applyTranscript([], ev('user', 'Hello.', true), 1);
    turns = applyTranscript(turns, ev('user', 'Another question', false), 2);
    turns = applyTranscript(turns, ev('assistant', 'Sure.', true), 3);
    expect(turns.map((t) => [t.speaker, t.final])).toEqual([
      ['user', true],
      ['user', false],
      ['assistant', true],
    ]);
    expect(new Set(turns.map((t) => t.id)).size).toBe(3);
  });

  it('ignores empty text and closes an open turn before a typed one', () => {
    expect(applyTranscript([], ev('user', '   ', false))).toEqual([]);
    const open = applyTranscript([], ev('user', 'half a sentence', false), 1);
    const withTyped = addTypedTurn(open, 'Details sent', 2);
    expect(withTyped).toHaveLength(2);
    expect(withTyped[0].final).toBe(true);
    expect(withTyped[1]).toMatchObject({ speaker: 'user', text: 'Details sent', final: true });
  });
});

describe('public conversation state', () => {
  const rows = (over: Partial<ConversationRows> = {}): ConversationRows => ({
    turns: [],
    tickets: [],
    escalations: [],
    conversation: [],
    ...over,
  });

  const now = new Date('2026-10-01T12:00:00Z');

  it('is neutral when nothing is recorded', () => {
    expect(toPublicState(rows(), { now })).toEqual({ ...NEUTRAL_STATE, serverTime: now.toISOString() });
  });

  it('uses the latest turn, the newest ticket and the escalation time', () => {
    const s = toPublicState(
      rows({
        turns: [
          { turn_number: 1, answer_type: 'clarification' },
          { turn_number: 3, answer_type: 'escalation' },
          { turn_number: 2, answer_type: 'direct_answer' },
        ],
        tickets: [
          { ticket_id: 'TKT-000001', created_at: '2026-09-30T10:00:00Z' },
          { ticket_id: 'TKT-000002', created_at: '2026-09-30T11:00:00Z' },
        ],
        escalations: [{ preferred_time: ' Tuesday at 2 ' }],
        conversation: [{ ended_at: '2026-09-30T12:00:00Z' }],
      }),
      { now },
    );
    expect(s).toEqual({
      answerType: 'escalation',
      ticketReference: 'TKT-000002',
      escalation: { requestedTime: 'Tuesday at 2' },
      ended: true,
      endReason: null,
      startedAt: null,
      serverTime: now.toISOString(),
      limits: null,
    });
  });

  it('passes through a known end reason, session start and limits, and drops anything else', () => {
    const limits = { sessionMaxSeconds: 360, warningSeconds: 30, silenceTimeoutSeconds: 15, countdownSeconds: 10 };
    const s = toPublicState(
      rows({ conversation: [{ ended_at: 'x', end_reason: 'session-timeout', started_at: '2026-10-01T11:54:00Z' }] }),
      { now, limits },
    );
    expect(s).toMatchObject({ endReason: 'session-timeout', startedAt: '2026-10-01T11:54:00.000Z', limits });
    for (const bad of ['internal-note', '', null, undefined]) {
      expect(toPublicState(rows({ conversation: [{ ended_at: null, end_reason: bad as never }] })).endReason).toBeNull();
    }
    expect(toPublicState(rows({ conversation: [{ ended_at: null, started_at: 'not a date' }] })).startedAt).toBeNull();
  });

  it('drops unknown answer types and blank times', () => {
    const s = toPublicState(
      rows({ turns: [{ turn_number: 1, answer_type: 'internal_thing' }], escalations: [{ preferred_time: '  ' }] }),
    );
    expect(s.answerType).toBeNull();
    expect(s.escalation).toEqual({ requestedTime: null });
  });

  it('exposes only the whitelisted public fields, whatever the rows contain', () => {
    const dirty = rows({
      turns: [{ turn_number: 1, answer_type: 'escalation', user_transcript: 'my email is a@b.co' } as never],
      escalations: [{ preferred_time: 'noon', user_email: 'a@b.co', user_name: 'Ada', reason: 'x' } as never],
      tickets: [{ ticket_id: 'TKT-000009', summary: 'secret', customer_id: 'CUS-1001' } as never],
    });
    const s = toPublicState(dirty);
    expect(Object.keys(s).sort()).toEqual([
      'answerType', 'endReason', 'ended', 'escalation', 'limits', 'serverTime', 'startedAt', 'ticketReference',
    ]);
    expect(JSON.stringify(s)).not.toMatch(/a@b\.co|Ada|secret|CUS-1001|my email/);
  });

  it('validates conversation ids', () => {
    for (const ok of ['vapi_abc-123', 'conv_1', 'a.b:c']) expect(CONVERSATION_ID_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'x'.repeat(65), 'a b', 'a/b', "x'; drop", '../etc']) {
      expect(CONVERSATION_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe('contact validation', () => {
  it('requires a name and a valid email; time is optional', () => {
    expect(validateContact({ name: '', email: '', preferredTime: '' })).toEqual({
      name: COPY.escalation.nameRequired,
      email: COPY.escalation.emailRequired,
    });
    expect(validateContact({ name: 'Ada', email: 'not-an-email', preferredTime: '' }).email).toBe(
      COPY.escalation.emailInvalid,
    );
    expect(validateContact({ name: 'Ada', email: 'ada@example.com', preferredTime: '' })).toEqual({});
    expect(validateContact({ name: '  ', email: ' ada@example.com ', preferredTime: 'Tue' }).name).toBeTruthy();
  });
});

describe('customer-facing copy', () => {
  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
    return [];
  }
  const all = [...strings(COPY), ...strings(VOICE_STATUS), ...strings(VOICE_PROMPT)];

  it('never uses internal or technical vocabulary', () => {
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) {
      for (const term of FORBIDDEN_CUSTOMER_TERMS) {
        const re = new RegExp(`(^|[^a-z])${term.replace(' ', '\\s')}([^a-z]|$)`, 'i');
        expect(re.test(s), `"${s}" contains "${term}"`).toBe(false);
      }
    }
  });

  it('has a status text and screen-reader text for every voice state', () => {
    for (const state of Object.keys(VOICE_STATUS)) {
      const s = VOICE_STATUS[state as VoiceState];
      expect(s.label).toBeTruthy();
      expect(s.screenReader.startsWith('Voice status: ')).toBe(true);
    }
    expect(VOICE_STATUS.listening.label).toBe(VOICE_STATUS['user-speaking'].label);
    expect(VOICE_STATUS.listening.screenReader).not.toBe(VOICE_STATUS['user-speaking'].screenReader);
  });

  it('never promises a scheduled callback', () => {
    expect(all.join(' ')).not.toMatch(/scheduled|booked/i);
  });
});

describe('provider error classification', () => {
  it('maps permission and device problems to the microphone message, the rest to connection', () => {
    expect(classifyVapiError(new DOMException('Permission denied', 'NotAllowedError'))).toBe('microphone');
    expect(classifyVapiError({ message: 'Requested device not found' })).toBe('microphone');
    expect(classifyVapiError({ message: 'network down' })).toBe('connection');
    expect(classifyVapiError(undefined)).toBe('connection');
  });
});
