import type { SupabaseClient } from '@supabase/supabase-js';
import type { TurnResult } from '../agent';
import { ensureConversation, loadHistory, saveTurn } from '../history';
import { errorMessage, logEvent } from '../logger';
import { classifyCompletion, classifyConfirmation } from './completion';
import { endConversation } from './persist';
import {
  type ConversationEndReason,
  DEFAULT_SESSION_CONFIG,
  SESSION_TEXT,
  type SessionConfig,
  type SessionControlPhase,
} from './types';
import { type CallHandle, noopCallControl, type VapiCallControl } from './vapi-control';

/** Extra time on the server-side silence countdown so the customer's visible 1 is never cut short by latency. */
const SILENCE_GRACE_MS = 1000;
/** If the goodbye's speech-end event never arrives, still end the call. */
const PENDING_END_FALLBACK_MS = 10_000;

export type TurnDecision =
  | { kind: 'proceed' }
  | { kind: 'reply'; text: string };

export interface SessionControllerOptions {
  db: SupabaseClient;
  control?: VapiCallControl;
  config?: SessionConfig;
}

interface Session {
  conversationId: string;
  call: CallHandle;
  startedAt: number;
  phase: SessionControlPhase;
  /** Phase to return to when a silence countdown is cancelled. */
  resumePhase: SessionControlPhase;
  ended: boolean;
  turnInFlight: boolean;
  /** Escalation contact form is open: the customer is expected to be quiet, so silence is not measured. */
  formPending: boolean;
  assistantSpeaking: boolean;
  userSpeaking: boolean;
  /** When the webhook said the customer stopped speaking; consumed by the next turn to estimate speech_to_agent_ms. */
  userStoppedAt?: number;
  pendingEnd?: { reason: ConversationEndReason; sawSpeech: boolean };
  silenceTimer?: ReturnType<typeof setTimeout>;
  countdownTimer?: ReturnType<typeof setTimeout>;
  warningTimer?: ReturnType<typeof setTimeout>;
  hardTimer?: ReturnType<typeof setTimeout>;
  pendingEndTimer?: ReturnType<typeof setTimeout>;
}

function unref(t: ReturnType<typeof setTimeout>) {
  (t as { unref?: () => void }).unref?.();
  return t;
}

/**
 * Deterministic session control for the voice path: the absolute session lifetime, silence detection, and the
 * customer saying they are done. None of it involves the model. State is in-process; the deadline is rehydrated
 * from `conversations.started_at`, and Vapi's maxDurationSeconds is the independent backstop.
 */
export class SessionController {
  private readonly sessions = new Map<string, Session>();
  private readonly control: VapiCallControl;
  private readonly config: SessionConfig;
  private readonly db: SupabaseClient;

  constructor(opts: SessionControllerOptions) {
    this.db = opts.db;
    this.control = opts.control ?? noopCallControl;
    this.config = opts.config ?? DEFAULT_SESSION_CONFIG;
  }

  /** Phase of a conversation's session, for tests and diagnostics. */
  phaseOf(conversationId: string): SessionControlPhase | undefined {
    return this.sessions.get(conversationId)?.phase;
  }

  /**
   * Milliseconds from the customer's last "stopped speaking" webhook to now, once. Approximate: the webhook itself
   * takes time to arrive, and it is undefined when no recent speech event was seen.
   */
  consumeSpeechGapMs(conversationId: string): number | undefined {
    const s = this.sessions.get(conversationId);
    const at = s?.userStoppedAt;
    if (!s || at === undefined) return undefined;
    s.userStoppedAt = undefined;
    const gap = Date.now() - at;
    return gap >= 0 && gap < 60_000 ? gap : undefined;
  }

  dispose() {
    for (const s of this.sessions.values()) this.clearTimers(s);
    this.sessions.clear();
  }

  // --- Vapi server messages ---

  /** Feed status-update, speech-update and end-of-call-report messages (already authenticated). */
  async handleVapiMessage(conversationId: string, message: Record<string, unknown>) {
    const call = (message.call ?? {}) as { id?: unknown; monitor?: { controlUrl?: unknown } };
    const handle: CallHandle = {
      callId: typeof call.id === 'string' ? call.id : undefined,
      controlUrl: typeof call.monitor?.controlUrl === 'string' ? call.monitor.controlUrl : undefined,
    };

    if (message.type === 'status-update' && message.status === 'in-progress') {
      await this.ensure(conversationId, handle);
    } else if (message.type === 'speech-update') {
      const s = await this.ensure(conversationId, handle);
      const role = message.role === 'user' || message.role === 'assistant' ? message.role : undefined;
      if (role && (message.status === 'started' || message.status === 'stopped')) {
        this.onSpeech(s, role, message.status === 'started');
      }
    } else if (message.type === 'end-of-call-report') {
      const s = this.sessions.get(conversationId);
      if (s) {
        s.ended = true;
        s.phase = 'ended';
        this.clearTimers(s);
      }
    }
  }

  // --- Turn hooks (call inside the per-conversation serialization) ---

  async beforeTurn(input: {
    conversationId: string;
    callId?: string;
    userMessage: string;
  }): Promise<TurnDecision> {
    try {
      const s = await this.ensure(input.conversationId, { callId: input.callId });
      if (s.ended) return this.reply(s, input.userMessage, SESSION_TEXT.ended);
      if (Date.now() >= s.startedAt + this.config.maxSeconds * 1000) {
        const decision = await this.reply(s, input.userMessage, SESSION_TEXT.timeout);
        await this.end(s, 'session-timeout');
        return decision;
      }

      this.cancelSilence(s);
      s.turnInFlight = true;
      s.formPending = false;

      const wasConfirming = s.phase === 'awaiting-confirmation';
      if (wasConfirming) s.phase = 'active';
      const completion = classifyCompletion(input.userMessage);
      const closing =
        completion === 'clear' || (wasConfirming && classifyConfirmation(input.userMessage) === 'end');
      if (closing || completion === 'ambiguous') s.turnInFlight = false; // answered here, no model turn follows
      if (closing) {
        s.phase = 'ending';
        s.pendingEnd = { reason: 'user-ended', sawSpeech: false };
        s.pendingEndTimer = unref(
          setTimeout(() => void this.end(s, 'user-ended'), PENDING_END_FALLBACK_MS),
        );
        return this.reply(s, input.userMessage, SESSION_TEXT.goodbye);
      }
      if (completion === 'ambiguous') {
        s.phase = 'awaiting-confirmation';
        return this.reply(s, input.userMessage, SESSION_TEXT.anythingElse);
      }
      return { kind: 'proceed' };
    } catch (error) {
      // Lifecycle control must never block a customer turn.
      logEvent('error', 'session beforeTurn failed', {
        conversation_id: input.conversationId,
        message: errorMessage(error),
      });
      return { kind: 'proceed' };
    }
  }

  /** Call after every turn, including failed ones (pass undefined). */
  afterTurn(conversationId: string, result?: Partial<Pick<TurnResult, 'answerType' | 'escalated'>>) {
    const s = this.sessions.get(conversationId);
    if (!s || s.ended) return;
    s.turnInFlight = false;
    s.formPending = result?.answerType === 'escalation' && !result.escalated;
    // The reply is about to be spoken; the assistant-stopped event restarts the silence timer.
  }

  // --- internals ---

  private async reply(s: Session, userMessage: string, text: string): Promise<TurnDecision> {
    try {
      await ensureConversation(this.db, s.conversationId);
      const { nextTurnNumber } = await loadHistory(this.db, s.conversationId);
      await saveTurn(this.db, {
        conversationId: s.conversationId,
        turnNumber: nextTurnNumber,
        userMessage,
        response: text,
        answerType: 'direct_answer',
      });
    } catch (error) {
      logEvent('error', 'session reply not persisted', {
        conversation_id: s.conversationId,
        message: errorMessage(error),
      });
    }
    return { kind: 'reply', text };
  }

  private async ensure(conversationId: string, call: CallHandle): Promise<Session> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.call.callId ??= call.callId;
      existing.call.controlUrl ??= call.controlUrl;
      return existing;
    }

    let startedAt = Date.now();
    let alreadyEnded = false;
    try {
      const { data, error } = await this.db
        .from('conversations')
        .select('started_at, ended_at, end_reason')
        .eq('conversation_id', conversationId);
      if (error) throw new Error(error.message);
      const row = data?.[0] as
        | { started_at?: string | null; ended_at?: string | null; end_reason?: string | null }
        | undefined;
      if (row?.started_at && Number.isFinite(Date.parse(row.started_at))) {
        startedAt = Date.parse(row.started_at);
      }
      alreadyEnded = Boolean(row?.ended_at || row?.end_reason);
    } catch (error) {
      logEvent('warn', 'session rehydrate failed', {
        conversation_id: conversationId,
        message: errorMessage(error),
      });
    }

    // A racing caller may have created it while we awaited the database.
    const raced = this.sessions.get(conversationId);
    if (raced) return raced;

    const s: Session = {
      conversationId,
      call: { ...call },
      startedAt,
      phase: alreadyEnded ? 'ended' : 'active',
      resumePhase: 'active',
      ended: alreadyEnded,
      turnInFlight: false,
      formPending: false,
      assistantSpeaking: false,
      userSpeaking: false,
    };
    this.sessions.set(conversationId, s);
    if (!alreadyEnded) {
      this.scheduleLimits(s);
      this.armSilence(s);
    }
    return s;
  }

  private scheduleLimits(s: Session) {
    const maxMs = this.config.maxSeconds * 1000;
    const warnAt = Math.max(0, maxMs - this.config.warningSeconds * 1000);
    const elapsed = Date.now() - s.startedAt;
    if (elapsed < warnAt) {
      s.warningTimer = unref(setTimeout(() => void this.warn(s), warnAt - elapsed));
    }
    s.hardTimer = unref(
      setTimeout(() => void this.end(s, 'session-timeout', { speak: true }), Math.max(0, maxMs - elapsed)),
    );
  }

  private async warn(s: Session) {
    if (s.ended) return;
    await this.logEvent(s, 'session_warning', 'session time limit approaching', {
      seconds_left: this.config.warningSeconds,
    });
    // Spoken warning only when Vapi live control is available; the customer UI shows it either way.
    await this.control.say(s.call, SESSION_TEXT.warning).catch(() => false);
  }

  private onSpeech(s: Session, role: 'user' | 'assistant', started: boolean) {
    if (s.ended) return;
    if (role === 'assistant') {
      s.assistantSpeaking = started;
      if (started && s.pendingEnd) s.pendingEnd.sawSpeech = true;
      if (!started && s.pendingEnd?.sawSpeech) {
        void this.end(s, s.pendingEnd.reason);
        return;
      }
    } else {
      s.userSpeaking = started;
      if (!started) s.userStoppedAt = Date.now();
    }
    if (started) this.cancelSilence(s);
    else this.armSilence(s);
  }

  private canMeasureSilence(s: Session) {
    return !(
      s.ended ||
      s.turnInFlight ||
      s.formPending ||
      s.pendingEnd ||
      s.assistantSpeaking ||
      s.userSpeaking
    );
  }

  private armSilence(s: Session) {
    this.cancelSilence(s);
    if (!this.canMeasureSilence(s)) return;
    s.silenceTimer = unref(
      setTimeout(() => void this.silenceWarning(s), this.config.silenceSeconds * 1000),
    );
  }

  private cancelSilence(s: Session) {
    if (s.silenceTimer) clearTimeout(s.silenceTimer);
    if (s.countdownTimer) clearTimeout(s.countdownTimer);
    s.silenceTimer = undefined;
    s.countdownTimer = undefined;
    if (s.phase === 'silence-warning') s.phase = s.resumePhase;
  }

  private async silenceWarning(s: Session) {
    if (!this.canMeasureSilence(s)) return;
    s.resumePhase = s.phase === 'awaiting-confirmation' ? 'awaiting-confirmation' : 'active';
    s.phase = 'silence-warning';
    s.countdownTimer = unref(
      setTimeout(
        () => void this.end(s, 'silence-timeout'),
        this.config.countdownSeconds * 1000 + SILENCE_GRACE_MS,
      ),
    );
    await this.logEvent(s, 'silence_warning', 'silence countdown started', {
      countdown_seconds: this.config.countdownSeconds,
    });
  }

  /** Persist first (so the customer UI can read the reason when the call drops), then hang up. Idempotent. */
  private async end(s: Session, reason: ConversationEndReason, opts: { speak?: boolean } = {}) {
    if (s.ended) return;
    s.ended = true;
    s.phase = 'ending';
    this.clearTimers(s);
    try {
      await endConversation(this.db, s.conversationId, reason);
    } catch (error) {
      logEvent('error', 'session end not persisted', {
        conversation_id: s.conversationId,
        end_reason: reason,
        message: errorMessage(error),
      });
    }
    s.phase = 'ended';
    try {
      const spoke = opts.speak
        ? await this.control.say(s.call, SESSION_TEXT.timeout, { endAfter: true })
        : false;
      if (!spoke) await this.control.endCall(s.call);
    } catch (error) {
      logEvent('warn', 'session hang-up failed', {
        conversation_id: s.conversationId,
        message: errorMessage(error),
      });
    }
  }

  private clearTimers(s: Session) {
    for (const key of ['silenceTimer', 'countdownTimer', 'warningTimer', 'hardTimer', 'pendingEndTimer'] as const) {
      if (s[key]) clearTimeout(s[key]);
      s[key] = undefined;
    }
  }

  private async logEvent(
    s: Session,
    eventType: string,
    summary: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      const { error } = await this.db
        .from('conversation_events')
        .insert({ conversation_id: s.conversationId, event_type: eventType, summary, metadata });
      if (error) throw new Error(error.message);
    } catch (error) {
      logEvent('warn', 'session event not recorded', {
        conversation_id: s.conversationId,
        event_type: eventType,
        message: errorMessage(error),
      });
    }
  }
}
