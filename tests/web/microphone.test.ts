import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkMicrophone } from '@/lib/voice/microphone';

function stubMedia(media: Partial<MediaDevices> | undefined) {
  vi.stubGlobal('navigator', { mediaDevices: media });
}
const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream;
const domError = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => vi.unstubAllGlobals());

describe('checkMicrophone', () => {
  it('reports an unsupported browser', async () => {
    stubMedia(undefined);
    expect(await checkMicrophone()).toBe('unsupported');
  });

  it('is fine when permission is granted and an input device exists', async () => {
    stubMedia({
      getUserMedia: vi.fn(async () => stream()),
      enumerateDevices: vi.fn(async () => [{ kind: 'audioinput' } as MediaDeviceInfo]),
    });
    expect(await checkMicrophone()).toBeNull();
  });

  it('stops the probe tracks straight away', async () => {
    const stop = vi.fn();
    stubMedia({ getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream) });
    await checkMicrophone();
    expect(stop).toHaveBeenCalled();
  });

  it('reports a refused permission as "microphone"', async () => {
    stubMedia({ getUserMedia: vi.fn(async () => Promise.reject(domError('NotAllowedError'))) });
    expect(await checkMicrophone()).toBe('microphone');
  });

  it('reports a missing device as "no-microphone"', async () => {
    stubMedia({ getUserMedia: vi.fn(async () => Promise.reject(domError('NotFoundError'))) });
    expect(await checkMicrophone()).toBe('no-microphone');
  });

  it('reports a stream with no input device in the device list as "no-microphone"', async () => {
    stubMedia({
      getUserMedia: vi.fn(async () => stream()),
      enumerateDevices: vi.fn(async () => [{ kind: 'audiooutput' } as MediaDeviceInfo]),
    });
    expect(await checkMicrophone()).toBe('no-microphone');
  });

  it('does not fail the check when the device list cannot be read', async () => {
    stubMedia({
      getUserMedia: vi.fn(async () => stream()),
      enumerateDevices: vi.fn(async () => Promise.reject(new Error('blocked'))),
    });
    expect(await checkMicrophone()).toBeNull();
  });

  it('asks only once (no automatic retry on a mic failure)', async () => {
    const getUserMedia = vi.fn(async () => Promise.reject(domError('NotAllowedError')));
    stubMedia({ getUserMedia });
    await checkMicrophone();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
