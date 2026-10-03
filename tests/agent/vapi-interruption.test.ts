import { describe, expect, it } from 'vitest';
import { assistantPatch, interruptionFromEnv, interruptionPatch } from '../../scripts/vapi/payload';

const base = { baseUrl: 'https://a.example.com', credentialId: 'c', webhookSecret: 'whsec-12345678' };

describe('interruptionFromEnv', () => {
  it('reads nothing when nothing is set, so the assistant is left alone', () => {
    expect(interruptionFromEnv({})).toEqual({});
    expect(interruptionFromEnv({ INTERRUPT_NUM_WORDS: '', START_WAIT_SECONDS: '  ', SMART_DENOISING: '' })).toEqual({});
  });

  it('reads each setting as a number or flag', () => {
    expect(
      interruptionFromEnv({
        INTERRUPT_NUM_WORDS: '2',
        INTERRUPT_VOICE_SECONDS: '0.3',
        INTERRUPT_BACKOFF_SECONDS: '1.5',
        START_WAIT_SECONDS: '0.6',
        SMART_DENOISING: '1',
      }),
    ).toEqual({ numWords: 2, voiceSeconds: 0.3, backoffSeconds: 1.5, waitSeconds: 0.6, smartDenoising: true });
    expect(interruptionFromEnv({ SMART_DENOISING: '0' })).toEqual({ smartDenoising: false });
  });

  it('reads smart endpointing, and rejects anything but vapi or livekit', () => {
    expect(interruptionFromEnv({ SMART_ENDPOINTING: 'vapi' })).toEqual({ smartEndpointing: 'vapi' });
    expect(interruptionFromEnv({ SMART_ENDPOINTING: ' livekit ' })).toEqual({ smartEndpointing: 'livekit' });
    expect(interruptionFromEnv({ SMART_ENDPOINTING: '' })).toEqual({});
    expect(() => interruptionFromEnv({ SMART_ENDPOINTING: 'on' })).toThrow('SMART_ENDPOINTING');
  });

  it('accepts the ends of every range', () => {
    expect(
      interruptionFromEnv({ INTERRUPT_NUM_WORDS: '0', INTERRUPT_VOICE_SECONDS: '0.5', INTERRUPT_BACKOFF_SECONDS: '10', START_WAIT_SECONDS: '5' }),
    ).toEqual({ numWords: 0, voiceSeconds: 0.5, backoffSeconds: 10, waitSeconds: 5 });
  });

  it.each([
    ['INTERRUPT_NUM_WORDS', '11'],
    ['INTERRUPT_NUM_WORDS', '-1'],
    ['INTERRUPT_NUM_WORDS', '1.5'],
    ['INTERRUPT_NUM_WORDS', 'two'],
    ['INTERRUPT_VOICE_SECONDS', '0.6'],
    ['INTERRUPT_VOICE_SECONDS', '-0.1'],
    ['INTERRUPT_BACKOFF_SECONDS', '11'],
    ['START_WAIT_SECONDS', '5.1'],
    ['START_WAIT_SECONDS', 'NaN'],
    ['SMART_DENOISING', 'yes'],
    ['SMART_DENOISING', '2'],
  ])('rejects %s=%s by name', (name, value) => {
    expect(() => interruptionFromEnv({ [name]: value })).toThrow(name);
  });

  it('names every bad variable, and never prints a value', () => {
    try {
      interruptionFromEnv({ INTERRUPT_NUM_WORDS: 'secret-looking', START_WAIT_SECONDS: '99' });
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('INTERRUPT_NUM_WORDS');
      expect(message).toContain('START_WAIT_SECONDS');
      expect(message).not.toContain('secret-looking');
      expect(message).not.toContain('99');
    }
  });
});

describe('interruptionPatch smart endpointing', () => {
  it('sets the endpointing provider without losing the rest of the start plan', () => {
    const current = { startSpeakingPlan: { waitSeconds: 0.4, smartEndpointingPlan: { provider: 'livekit', extra: 1 } } };
    expect(interruptionPatch({ smartEndpointing: 'vapi' }, current)).toEqual({
      startSpeakingPlan: { waitSeconds: 0.4, smartEndpointingPlan: { provider: 'vapi', extra: 1 } },
    });
  });

  it('combines with the wait time in one start plan', () => {
    expect(interruptionPatch({ waitSeconds: 1, smartEndpointing: 'vapi' })).toEqual({
      startSpeakingPlan: { waitSeconds: 1, smartEndpointingPlan: { provider: 'vapi' } },
    });
  });

  it('leaves the start plan alone when neither is set', () => {
    expect(interruptionPatch({ numWords: 2 }, { startSpeakingPlan: { waitSeconds: 0.4 } })).not.toHaveProperty('startSpeakingPlan');
  });
});

describe('interruptionPatch', () => {
  it('adds nothing when no setting is given', () => {
    expect(interruptionPatch()).toEqual({});
    expect(interruptionPatch({}, { stopSpeakingPlan: { numWords: 3 } })).toEqual({});
  });

  it('adds only the plan whose setting was given', () => {
    expect(interruptionPatch({ numWords: 2 })).toEqual({ stopSpeakingPlan: { numWords: 2 } });
    expect(interruptionPatch({ waitSeconds: 0.8 })).toEqual({ startSpeakingPlan: { waitSeconds: 0.8 } });
    expect(interruptionPatch({ smartDenoising: true })).toEqual({
      backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
    });
  });

  it('keeps every other field of the plan the assistant already has (a PATCH replaces a nested plan whole)', () => {
    const current = {
      stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1, acknowledgementPhrases: ['okay', 'yeah'] },
      startSpeakingPlan: { waitSeconds: 0.4, smartEndpointingPlan: { provider: 'vapi' } },
      backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: false }, fourierDenoisingPlan: { enabled: false, staticThreshold: -35 } },
    };
    const patch = interruptionPatch({ numWords: 2, waitSeconds: 0.7, smartDenoising: true }, current);
    expect(patch.stopSpeakingPlan).toEqual({ numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1, acknowledgementPhrases: ['okay', 'yeah'] });
    expect(patch.startSpeakingPlan).toEqual({ waitSeconds: 0.7, smartEndpointingPlan: { provider: 'vapi' } });
    expect(patch.backgroundSpeechDenoisingPlan).toEqual({
      smartDenoisingPlan: { enabled: true },
      fourierDenoisingPlan: { enabled: false, staticThreshold: -35 },
    });
  });

  it('merges several stop settings into one plan, and lets zero through', () => {
    expect(interruptionPatch({ numWords: 0, voiceSeconds: 0, backoffSeconds: 0 })).toEqual({
      stopSpeakingPlan: { numWords: 0, voiceSeconds: 0, backoffSeconds: 0 },
    });
  });

  it('treats a missing or null current plan as empty', () => {
    expect(interruptionPatch({ numWords: 1 }, { stopSpeakingPlan: null })).toEqual({ stopSpeakingPlan: { numWords: 1 } });
  });

  it('does not change the object it was given', () => {
    const current = { stopSpeakingPlan: { numWords: 0 } };
    interruptionPatch({ numWords: 5 }, current);
    expect(current).toEqual({ stopSpeakingPlan: { numWords: 0 } });
  });
});

describe('assistantPatch with interruption settings', () => {
  it('is exactly what it was when no settings are given', () => {
    const plain = assistantPatch(base);
    expect(Object.keys(plain).sort()).toEqual(['credentialIds', 'model', 'server', 'serverMessages']);
    expect(assistantPatch({ ...base, interruption: {}, current: { stopSpeakingPlan: { numWords: 3 } } })).toEqual(plain);
  });

  it('adds only the plans that were asked for, next to the existing fields', () => {
    const p = assistantPatch({
      ...base,
      sessionMaxSeconds: 360,
      interruption: { numWords: 2, smartDenoising: true },
      current: { stopSpeakingPlan: { voiceSeconds: 0.2 } },
    });
    expect(p).toMatchObject({
      maxDurationSeconds: 370,
      stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.2 },
      backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
    });
    expect(p).not.toHaveProperty('startSpeakingPlan');
  });

  it('never touches the voice, transcriber or name', () => {
    const p = assistantPatch({ ...base, interruption: { numWords: 2, voiceSeconds: 0.3, backoffSeconds: 2, waitSeconds: 1, smartDenoising: true } });
    for (const key of ['voice', 'transcriber', 'name', 'firstMessage']) expect(p).not.toHaveProperty(key);
  });
});
