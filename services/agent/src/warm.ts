import { startup as sdkStartup, type WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import { errorMessage, logEvent } from './logger';

type StartupParams = NonNullable<Parameters<typeof sdkStartup>[0]>;

export interface WarmPoolOptions {
  /** The SDK options for one conversation. Fixed at warm time, so a warm process belongs to exactly one call. */
  build(conversationId: string): StartupParams['options'];
  /** Unused warm processes are closed after this long. */
  ttlMs?: number;
  /** At most this many warm processes at once; beyond it, calls simply start cold. */
  max?: number;
  /** Injectable for tests. */
  startup?: (params: StartupParams) => Promise<WarmQuery>;
}

interface Entry {
  ready: Promise<WarmQuery | undefined>;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_WARM_TTL_MS = 90_000;
export const DEFAULT_WARM_MAX = 8;

/**
 * Keeps one pre-started agent subprocess per live call so the first model call of a turn does not pay for process
 * start and handshake. A warm process can be used once and only for its own conversation (the MCP headers carry the
 * conversation id), so it is started when a call begins and again after each turn. Anything that goes wrong simply
 * means the turn starts cold, exactly as before.
 */
export class WarmPool {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly start: (params: StartupParams) => Promise<WarmQuery>;
  private closed = false;

  constructor(private readonly opts: WarmPoolOptions) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_WARM_TTL_MS;
    this.max = opts.max ?? DEFAULT_WARM_MAX;
    this.start = opts.startup ?? sdkStartup;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Starts a warm process for this conversation if there is none and there is room. Never throws. */
  warm(conversationId: string): void {
    if (this.closed || this.entries.has(conversationId) || this.entries.size >= this.max) return;
    let options: StartupParams['options'];
    try {
      options = this.opts.build(conversationId);
    } catch (error) {
      logEvent('warn', 'warm start skipped', { conversation_id: conversationId, message: errorMessage(error) });
      return;
    }
    const ready = this.start({ options }).then(
      (w) => w,
      (error) => {
        logEvent('warn', 'warm start failed', { conversation_id: conversationId, message: errorMessage(error) });
        this.entries.delete(conversationId);
        return undefined;
      },
    );
    const timer = setTimeout(() => void this.release(conversationId), this.ttlMs);
    (timer as { unref?: () => void }).unref?.();
    this.entries.set(conversationId, { ready, timer });
  }

  /**
   * Hands over this conversation's warm process, once. Waits if it is still starting (no slower than starting cold,
   * since it began earlier). Undefined means start cold.
   */
  async take(conversationId: string): Promise<WarmQuery | undefined> {
    const entry = this.entries.get(conversationId);
    if (!entry) return undefined;
    this.entries.delete(conversationId);
    clearTimeout(entry.timer);
    return entry.ready;
  }

  /** Closes this conversation's warm process, if any (the call ended, or it sat unused). */
  async release(conversationId: string): Promise<void> {
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    this.entries.delete(conversationId);
    clearTimeout(entry.timer);
    try {
      (await entry.ready)?.close();
    } catch {
      // Already gone.
    }
  }

  /** Closes everything and refuses new warm-ups. */
  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.entries.keys()].map((id) => this.release(id)));
  }
}
