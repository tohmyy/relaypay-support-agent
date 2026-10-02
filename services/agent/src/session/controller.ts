import type { SupabaseClient } from '@supabase/supabase-js';
import type { TurnResult } from '../agent';
import { ensureConversation, loadHistory, saveTurn } from '../history';
import { errorMessage, logEvent } from '../logger';
import { classifyCompletion, classifyConfirmation } from './completion';
import {
  activeEarlierSessions,
  budgetExceeded,
  countAllSessions,
  countCustomerSessions,
  limitsEnabled,
  loadUsage,
  lookupIdentity,
} from './limits';
import { endConversation, startHandoff } from './persist';
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
/**
 * Customer speech shorter than this while the assistant was talking is more likely a cough, a keystroke or a stray
 * word than a real interruption. Only a rough indicator: it is measured between webhook arrivals.
 */
const SHORT_INTERRUPT_MS = 500;
/**
 * How many turns re-read who the call belongs to while no customer is linked. The link lands a second or two after the
 * call starts, so a call still unlinked after a few turns is an anonymous one and stops costing a query per turn.
 */
const MAX_IDENTITY_CHECKS = 4;

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
  /** Customer speech that started while the assistant was speaking, how many were very short, and replies never heard. */
  interruptions: number;
  shortInterruptions: number;
  undeliveredReplies: number;
  silenceWarnings: number;
  /** When the current interruption began (cleared when the customer stops). */
  interruptStartedAt?: number;
  /** The once-per-call voice_stats event has been written (or must not be, for a session rebuilt after a restart). */
  statsRecorded: boolean;
  pendingEnd?: { reason: ConversationEndReason; sawSpeech: boolean };
  /** Who is talking: the AI, or (after a handoff) staff. Human conversations are never answered by the model. */
  mode: 'ai' | 'human';
  /** The signed-in customer this call belongs to, once the web app has linked it (it lands after the call starts). */
  customerId: string | null;
  /** Work done in this conversation, for the budgets. */
  agentCalls: number;
  toolCalls: number;
  retrievalCalls: number;
  /** The once-per-session checks (concurrency, creation rate) have run. */
  sessionChecksDone: boolean;
  globalCheckDone: boolean;
  identityChecks: number;
  /** Waiting for the customer to hear the line that explains the handoff, then the call is hung up. */
  pendingHandoff?: { reason: HandoffReason; sawSpeech: boolean };
  pendingHandoffTimer?: ReturnType<typeof setTimeout>;
  silenceTimer?: ReturnType<typeof setTimeout>;
  countdownTimer?: ReturnType<typeof setTimeout>;
  warningTimer?: ReturnType<typeof setTimeout>;
  hardTimer?: ReturnType<typeof setTimeout>;
  pendingEndTimer?: ReturnType<typeof setTimeout>;
}

type HandoffReason = 'escalation' | 'limit-reached';

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
        await this.recordVoiceStats(s);
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
      // The AI does not come back after a handoff: a request that still reaches the voice path gets a fixed line.
      if (s.mode === 'human') return { kind: 'reply', text: SESSION_TEXT.humanActive };
      if (s.ended) return this.reply(s, input.userMessage, SESSION_TEXT.ended);
      if (Date.now() >= s.startedAt + this.config.maxSeconds * 1000) {
        const decision = await this.reply(s, input.userMessage, SESSION_TEXT.timeout);
        await this.end(s, 'session-timeout');
        return decision;
      }

      // The customer is still talking after "that's all": the goodbye no longer ends the call. If what they say is
      // another closer it is classified below and the call ends then. Mere noise sends no turn, so it cancels nothing.
      if (s.pendingEnd) {
        s.pendingEnd = undefined;
        if (s.pendingEndTimer) clearTimeout(s.pendingEndTimer);
        s.pendingEndTimer = undefined;
        if (s.phase === 'ending') s.phase = 'active';
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
      // Abuse limits last: they only matter when the model is about to run.
      const blocked = await this.checkLimits(s, input.userMessage);
      if (blocked) {
        s.turnInFlight = false;
        return blocked;
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
  afterTurn(
    conversationId: string,
    result?: Partial<Pick<TurnResult, 'answerType' | 'escalated' | 'escalationCreated' | 'toolsUsed' | 'retrieved'>>,
  ) {
    const s = this.sessions.get(conversationId);
    if (!s || s.ended) return;
    s.turnInFlight = false;
    // The contact form is open until the escalation record exists (not merely until the model asks for the details).
    s.formPending = result?.answerType === 'escalation' && !result.escalationCreated;
    if (result) {
      s.agentCalls += 1;
      s.toolCalls += result.toolsUsed?.length ?? 0;
      if (result.retrieved) s.retrievalCalls += 1;
    }
    if (result?.escalationCreated && this.config.humanHandoff) void this.armHandoff(s, 'escalation');
    // The reply is about to be spoken; the assistant-stopped event restarts the silence timer.
  }

  /**
   * The customer's connection dropped before the reply reached Vapi, which is what happens when they talk over the
   * assistant mid-turn (assuming Vapi closes the request; docs/VAPI.md). The turn itself still completed and was
   * saved. Nothing will be spoken, so no assistant-stopped event will restart silence detection: do it here.
   */
  replyNotDelivered(conversationId: string) {
    const s = this.sessions.get(conversationId);
    if (!s || s.ended) return;
    s.undeliveredReplies += 1;
    s.turnInFlight = false;
    this.armSilence(s);
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
    let mode: 'ai' | 'human' = 'ai';
    let customerId: string | null = null;
    let usage = { agentCalls: 0, toolCalls: 0, retrievalCalls: 0 };
    try {
      const { data, error } = await this.db
        .from('conversations')
        .select('started_at, ended_at, end_reason, support_mode, customer_id')
        .eq('conversation_id', conversationId);
      if (error) throw new Error(error.message);
      const row = data?.[0] as
        | {
            started_at?: string | null;
            ended_at?: string | null;
            end_reason?: string | null;
            support_mode?: string | null;
            customer_id?: string | null;
          }
        | undefined;
      if (row?.started_at && Number.isFinite(Date.parse(row.started_at))) {
        startedAt = Date.parse(row.started_at);
      }
      alreadyEnded = Boolean(row?.ended_at || row?.end_reason || row?.support_mode === 'ended');
      mode = row?.support_mode === 'human' ? 'human' : 'ai';
      customerId = row?.customer_id ?? null;
      // A restart must not reset a budget: count what the conversation has already used.
      if (row && !alreadyEnded && mode === 'ai' && limitsEnabled(this.config.limits)) {
        usage = await loadUsage(this.db, conversationId);
      }
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
      phase: alreadyEnded ? 'ended' : mode === 'human' ? 'human-support' : 'active',
      resumePhase: 'active',
      ended: alreadyEnded,
      mode,
      customerId,
      agentCalls: usage.agentCalls,
      toolCalls: usage.toolCalls,
      retrievalCalls: usage.retrievalCalls,
      sessionChecksDone: false,
      globalCheckDone: false,
      identityChecks: 0,
      turnInFlight: false,
      formPending: false,
      assistantSpeaking: false,
      userSpeaking: false,
      interruptions: 0,
      shortInterruptions: 0,
      undeliveredReplies: 0,
      silenceWarnings: 0,
      // A session rebuilt after a restart has lost its counts; writing zeros would pass off a gap as "no interruptions".
      statsRecorded: alreadyEnded || mode === 'human',
    };
    this.sessions.set(conversationId, s);
    // A human conversation has no time limit and no silence timer: staff and the customer set the pace.
    if (!alreadyEnded && mode === 'ai') {
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
      if (started && s.pendingHandoff) s.pendingHandoff.sawSpeech = true;
      if (!started && s.pendingEnd?.sawSpeech) {
        void this.end(s, s.pendingEnd.reason);
        return;
      }
      if (!started && s.pendingHandoff?.sawSpeech) {
        void this.handoff(s, s.pendingHandoff.reason);
        return;
      }
    } else {
      const now = Date.now();
      // The customer began while the assistant was still talking (and was not already counted as talking).
      if (started && s.assistantSpeaking && !s.userSpeaking) {
        s.interruptions += 1;
        s.interruptStartedAt = now;
      }
      s.userSpeaking = started;
      if (!started) {
        s.userStoppedAt = now;
        if (s.interruptStartedAt !== undefined) {
          if (now - s.interruptStartedAt < SHORT_INTERRUPT_MS) s.shortInterruptions += 1;
          s.interruptStartedAt = undefined;
        }
      }
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
      s.pendingHandoff ||
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
    s.silenceWarnings += 1;
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
    await this.recordVoiceStats(s);
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

  // --- Human handoff and abuse limits ---

  /** Separate from the checks above so the compiler does not assume nothing changed across an await. */
  private isHuman(s: Session): boolean {
    return s.mode === 'human';
  }

  /** Re-read who the conversation belongs to, until the web app's link has landed. */
  private async refreshIdentity(s: Session) {
    if (s.customerId) return;
    try {
      const identity = await lookupIdentity(this.db, s.conversationId);
      if (identity?.customerId) s.customerId = identity.customerId;
      if (identity?.supportMode === 'human') s.mode = 'human';
    } catch (error) {
      logEvent('warn', 'session identity lookup failed', {
        conversation_id: s.conversationId,
        message: errorMessage(error),
      });
    }
  }

  /**
   * After an escalation was created: for a signed-in customer, let the confirmation finish playing, then move the
   * conversation to staff and hang up. Anonymous callers stay on the call (Mode A).
   */
  private async armHandoff(s: Session, reason: HandoffReason) {
    if (s.ended || s.mode === 'human' || s.pendingHandoff) return;
    await this.refreshIdentity(s);
    if (!s.customerId || s.ended || this.isHuman(s) || s.pendingHandoff) return;
    s.pendingHandoff = { reason, sawSpeech: false };
    s.pendingHandoffTimer = unref(setTimeout(() => void this.handoff(s, reason), PENDING_END_FALLBACK_MS));
  }

  /** Move the conversation to staff and hang up the call. The conversation itself stays open. */
  private async handoff(s: Session, reason: HandoffReason) {
    if (s.ended || s.mode === 'human') return;
    s.pendingHandoff = undefined;
    if (s.pendingHandoffTimer) clearTimeout(s.pendingHandoffTimer);
    s.pendingHandoffTimer = undefined;
    let applied = false;
    try {
      ({ applied } = await startHandoff(this.db, s.conversationId, { reason, notice: SESSION_TEXT.handoffNotice }));
    } catch (error) {
      // The call carries on as an AI call rather than being cut off with nowhere to go.
      logEvent('error', 'session handoff not persisted', {
        conversation_id: s.conversationId,
        reason,
        message: errorMessage(error),
      });
      return;
    }
    if (!applied) return;
    s.mode = 'human';
    s.phase = 'human-support';
    this.clearTimers(s);
    await this.recordVoiceStats(s);
    try {
      await this.control.endCall(s.call);
    } catch (error) {
      logEvent('warn', 'session hang-up failed', {
        conversation_id: s.conversationId,
        message: errorMessage(error),
      });
    }
  }

  /** Say a fixed line, then end the call (or hand it to staff) once it has been heard. Persisted like any reply. */
  private async closeAfterReply(
    s: Session,
    userMessage: string,
    text: string,
    then: { end: ConversationEndReason } | { handoff: HandoffReason },
  ): Promise<TurnDecision> {
    s.phase = 'ending';
    if ('end' in then) {
      s.pendingEnd = { reason: then.end, sawSpeech: false };
      s.pendingEndTimer = unref(setTimeout(() => void this.end(s, then.end), PENDING_END_FALLBACK_MS));
    } else {
      s.pendingHandoff = { reason: then.handoff, sawSpeech: false };
      s.pendingHandoffTimer = unref(setTimeout(() => void this.handoff(s, then.handoff), PENDING_END_FALLBACK_MS));
    }
    return this.reply(s, userMessage, text);
  }

  /**
   * The abuse checks, run when the model is about to be called. Returns a decision to answer with a fixed line
   * instead, or nothing to carry on. Enforced here so none of it depends on the browser.
   */
  private async checkLimits(s: Session, userMessage: string): Promise<TurnDecision | undefined> {
    const limits = this.config.limits;
    if (!limitsEnabled(limits)) return undefined;
    try {
      if (!s.customerId && s.identityChecks < MAX_IDENTITY_CHECKS) {
        s.identityChecks += 1;
        await this.refreshIdentity(s);
      }
      if (this.isHuman(s)) return { kind: 'reply', text: SESSION_TEXT.humanActive };

      const over = budgetExceeded(
        { agentCalls: s.agentCalls, toolCalls: s.toolCalls, retrievalCalls: s.retrievalCalls },
        limits,
      );
      if (over) {
        await this.logEvent(s, 'limit_reached', `conversation budget used up (${over.kind})`, {
          kind: over.kind,
          limit: over.limit,
          value: over.value,
        });
        if (this.config.humanHandoff && s.customerId) {
          return this.closeAfterReply(s, userMessage, SESSION_TEXT.budgetHandoff, { handoff: 'limit-reached' });
        }
        return this.closeAfterReply(s, userMessage, SESSION_TEXT.budget, { end: 'limit-reached' });
      }

      // Per-session checks run once, as soon as they can: concurrency and the customer's creation rate need the
      // customer, so they wait for the link; the global breaker does not.
      if (!s.sessionChecksDone && (s.customerId || limits.globalSessionRateMax > 0)) {
        const refused = await this.checkSessionLimits(s);
        if (refused) return this.closeAfterReply(s, userMessage, refused.text, { end: 'limit-reached' });
        s.sessionChecksDone = Boolean(s.customerId);
      }
    } catch (error) {
      // A failed check must never cost the customer their turn.
      logEvent('warn', 'session limit check failed', {
        conversation_id: s.conversationId,
        message: errorMessage(error),
      });
    }
    return undefined;
  }

  private async checkSessionLimits(s: Session): Promise<{ text: string } | undefined> {
    const limits = this.config.limits;
    const now = Date.now();

    if (limits.globalSessionRateMax > 0 && !s.globalCheckDone) {
      s.globalCheckDone = true;
      const since = new Date(now - limits.globalSessionRateWindowSeconds * 1000).toISOString();
      const total = await countAllSessions(this.db, since);
      if (total > limits.globalSessionRateMax) {
        await this.logEvent(s, 'limit_reached', 'too many new sessions overall', {
          kind: 'global_session_rate',
          limit: limits.globalSessionRateMax,
          value: total,
        });
        return { text: SESSION_TEXT.rateLimited };
      }
    }

    if (!s.customerId) return undefined;

    if (limits.maxConcurrentSessions > 0) {
      const earlier = await activeEarlierSessions(this.db, s.customerId, s.conversationId, s.startedAt, {
        maxSeconds: this.config.maxSeconds,
        now,
      });
      if (earlier.length >= limits.maxConcurrentSessions) {
        await this.logEvent(s, 'limit_reached', 'customer already has an active session', {
          kind: 'concurrent_sessions',
          limit: limits.maxConcurrentSessions,
          value: earlier.length,
        });
        return { text: SESSION_TEXT.concurrent };
      }
    }

    if (limits.sessionRateMax > 0) {
      const since = new Date(now - limits.sessionRateWindowSeconds * 1000).toISOString();
      const started = await countCustomerSessions(this.db, s.customerId, since);
      if (started > limits.sessionRateMax) {
        await this.logEvent(s, 'limit_reached', 'customer started too many sessions', {
          kind: 'session_rate',
          limit: limits.sessionRateMax,
          value: started,
        });
        return { text: SESSION_TEXT.rateLimited };
      }
    }
    return undefined;
  }

  /** One row per call with the voice-interaction counts; written once, by whichever end happens first. */
  private async recordVoiceStats(s: Session) {
    if (s.statsRecorded) return;
    s.statsRecorded = true;
    await this.logEvent(s, 'voice_stats', 'voice interaction summary', {
      interruptions: s.interruptions,
      short_interruptions: s.shortInterruptions,
      undelivered_replies: s.undeliveredReplies,
      silence_warnings: s.silenceWarnings,
    });
  }

  private clearTimers(s: Session) {
    for (const key of [
      'silenceTimer',
      'countdownTimer',
      'warningTimer',
      'hardTimer',
      'pendingEndTimer',
      'pendingHandoffTimer',
    ] as const) {
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
