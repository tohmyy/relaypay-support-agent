import type { ErrorKind } from './state';

/**
 * Checks the microphone up front so a refusal or a missing device becomes a clear message instead of a failed call.
 * Returns null when a microphone can be used. Never retried automatically: the customer has to change something
 * (allow access, plug a device in) first.
 *
 * - no browser support            → 'unsupported'
 * - permission refused / blocked  → 'microphone'
 * - no input device present       → 'no-microphone'
 */
export async function checkMicrophone(): Promise<ErrorKind | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    // No device at all is a different fix from a refused permission.
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone';
    return 'microphone';
  }
  // Permission was given; make sure there is at least one input device (some browsers hand back a silent stream).
  try {
    const devices = await navigator.mediaDevices.enumerateDevices?.();
    if (devices && devices.length > 0 && !devices.some((d) => d.kind === 'audioinput')) return 'no-microphone';
  } catch {
    // Listing devices is only a second opinion; the permission check above already passed.
  }
  return null;
}
