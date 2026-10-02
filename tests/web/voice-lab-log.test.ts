import { describe, expect, it } from 'vitest';
import { appendEntry, formatElapsed, formatLog, summarizeError, summarizeMessage, type LabEntry } from '@/lib/dev/voice-lab-log';

describe('summarizeMessage', () => {
  it('shows the shape of a message: its type and a few short labels', () => {
    expect(summarizeMessage({ type: 'speech-update', role: 'user', status: 'started' })).toBe('speech-update role=user status=started');
    expect(summarizeMessage({ type: 'transcript', role: 'assistant', transcriptType: 'final' })).toBe(
      'transcript role=assistant transcriptType=final',
    );
    expect(summarizeMessage({ type: 'status-update', status: 'ended', endedReason: 'customer-ended-call' })).toBe(
      'status-update status=ended endedReason=customer-ended-call',
    );
  });

  it('never includes what anyone said, or any other payload', () => {
    const text = summarizeMessage({
      type: 'transcript',
      role: 'user',
      transcriptType: 'final',
      transcript: 'my card number is 4111 1111 1111 1111',
      artifact: { messages: [{ message: 'secret' }] },
      content: 'hello there',
      message: 'private',
    });
    expect(text).toBe('transcript role=user transcriptType=final');
    expect(text).not.toMatch(/4111|secret|hello|private/);
  });

  it('drops a label that is not a short plain label, so free text cannot slip in through a known field', () => {
    expect(summarizeMessage({ type: 'status-update', status: 'my email is a@b.co' })).toBe('status-update');
    expect(summarizeMessage({ type: 'x'.repeat(61) })).toBe('message (unrecognised shape)');
    expect(summarizeMessage({ type: 5, role: null })).toBe('message (unrecognised shape)');
  });

  it('copes with anything the SDK might hand over', () => {
    expect(summarizeMessage(null)).toBe('object');
    expect(summarizeMessage(undefined)).toBe('undefined');
    expect(summarizeMessage('hello')).toBe('string');
    expect(summarizeMessage({})).toBe('message (unrecognised shape)');
    expect(summarizeMessage([1, 2])).toBe('message (unrecognised shape)');
  });
});

describe('summarizeError', () => {
  it('reads an Error, an SDK error object, or a string', () => {
    expect(summarizeError(new Error('Call object is not available.'))).toBe('Call object is not available.');
    expect(summarizeError({ message: 'Meeting has ended' })).toBe('Meeting has ended');
    expect(summarizeError({ error: { message: 'network lost' } })).toBe('network lost');
    expect(summarizeError({ errorMsg: 'ejected' })).toBe('ejected');
    expect(summarizeError('plain')).toBe('plain');
    expect(summarizeError({})).toBe('error');
  });

  it('never prints "[object Object]": the SDK wraps the real reason in objects', () => {
    // Seen on a real call: errors at hang-up and on a failed reconnect.
    expect(summarizeError({ error: { type: 'ejected', msg: 'Meeting has ended' } })).toBe('Meeting has ended');
    expect(summarizeError({ error: { type: 'ejected' } })).toBe('ejected');
    expect(summarizeError({ message: { type: 'x', detail: 'y' } })).toBe('{"type":"x","detail":"y"}');
    expect(summarizeError({ action: 'error', code: 7 })).toBe('{"action":"error","code":7}');
    for (const e of [{ error: {} }, { message: {} }, { a: { b: 1 } }, [], null, undefined]) {
      expect(summarizeError(e)).not.toContain('[object');
    }
  });

  it('hides links, which can carry access tokens', () => {
    const out = summarizeError({ error: { msg: 'cannot join https://example.daily.co/room?t=SECRET123 now' } });
    expect(out).toBe('cannot join <link> now');
    expect(summarizeError({ detail: { url: 'https://x.example/a?token=abc' } })).not.toContain('abc');
  });

  it('keeps it to one short line', () => {
    const out = summarizeError(new Error(`first line\nsecond ${'x'.repeat(400)}`));
    expect(out).not.toContain('\n');
    expect(out.length).toBeLessThanOrEqual(160);
  });
});

describe('formatting the log', () => {
  it('shows elapsed time to a tenth of a second and never negative', () => {
    expect(formatElapsed(0)).toBe('+0.0s');
    expect(formatElapsed(12_340)).toBe('+12.3s');
    expect(formatElapsed(-50)).toBe('+0.0s');
  });

  it('lines the entries up for pasting', () => {
    const text = formatLog([
      { at: 0, kind: 'action', text: 'start (normal)' },
      { at: 1500, kind: 'event', text: 'call-start' },
      { at: 61_200, kind: 'error', text: 'Meeting has ended' },
    ]);
    expect(text.split('\n')).toEqual([
      '   +0.0s  action  start (normal)',
      '   +1.5s  event   call-start',
      '  +61.2s  error   Meeting has ended',
    ]);
  });

  it('folds the same entry repeating into one line with a count (a stream of partial transcripts)', () => {
    let log: LabEntry[] = [];
    log = appendEntry(log, { at: 0, kind: 'action', text: 'start' });
    for (const at of [4400, 4600, 4800, 8800]) {
      log = appendEntry(log, { at, kind: 'message', text: 'transcript role=assistant transcriptType=partial' });
    }
    log = appendEntry(log, { at: 8900, kind: 'message', text: 'transcript role=assistant transcriptType=final' });
    expect(log).toHaveLength(3);
    expect(formatLog(log).split('\n')).toEqual([
      '   +0.0s  action  start',
      '   +4.4s  message transcript role=assistant transcriptType=partial x4 (until +8.8s)',
      '   +8.9s  message transcript role=assistant transcriptType=final',
    ]);
  });

  it('only folds identical neighbours: the same text again later, or a different kind, stays separate', () => {
    let log: LabEntry[] = [];
    log = appendEntry(log, { at: 0, kind: 'note', text: 'same' });
    log = appendEntry(log, { at: 1, kind: 'error', text: 'same' });
    log = appendEntry(log, { at: 2, kind: 'note', text: 'same' });
    expect(log).toHaveLength(3);
    expect(log.every((e) => e.count === undefined)).toBe(true);
  });

  it('does not change the list it was given', () => {
    const before: LabEntry[] = [{ at: 0, kind: 'note', text: 'x' }];
    appendEntry(before, { at: 5, kind: 'note', text: 'x' });
    expect(before).toEqual([{ at: 0, kind: 'note', text: 'x' }]);
  });

  it('is empty for an empty log', () => {
    expect(formatLog([])).toBe('');
  });
});
