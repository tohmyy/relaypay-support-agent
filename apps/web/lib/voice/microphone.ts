import type { ErrorKind } from './state';

/**
 * Asks for microphone access up front so a refusal becomes a clear message instead of a failed call.
 * Returns null when the microphone can be used.
 */
export async function checkMicrophone(): Promise<ErrorKind | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return null;
  } catch {
    // Denied, no microphone, or blocked by policy: all are fixed the same way by the customer.
    return 'microphone';
  }
}
