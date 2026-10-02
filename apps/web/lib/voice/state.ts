/** Single source of truth for what the voice interaction is doing. UI never infers this on its own. */
export type VoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'user-speaking'
  | 'processing'
  | 'assistant-speaking'
  | 'ending'
  | 'ended'
  | 'error';

export type ErrorKind =
  | 'connection'
  | 'microphone'
  | 'no-microphone'
  | 'service'
  | 'unsupported'
  | 'unavailable';

export type VoiceEvent =
  | { type: 'START' }
  /** A start that was stopped before any call existed (for example by a conversation limit): back to idle. */
  | { type: 'ABORT' }
  /** A resume that could not be carried out (the window passed, the conversation could not be reopened): back to the ended screen. */
  | { type: 'RESUME_FAILED' }
  | { type: 'CALL_STARTED' }
  | { type: 'USER_SPEECH_START' }
  | { type: 'USER_SPEECH_END' }
  | { type: 'ASSISTANT_SPEECH_START' }
  | { type: 'ASSISTANT_SPEECH_END' }
  | { type: 'END_REQUESTED' }
  | { type: 'CALL_ENDED' }
  | { type: 'ERROR'; kind: ErrorKind };

export interface VoiceModel {
  state: VoiceState;
  error?: ErrorKind;
}

export const initialVoiceModel: VoiceModel = { state: 'idle' };

/** States in which a call exists (or is being set up) and can be ended by the customer. */
export const ACTIVE_STATES: readonly VoiceState[] = [
  'connecting',
  'listening',
  'user-speaking',
  'processing',
  'assistant-speaking',
];

export function isActive(state: VoiceState): boolean {
  return ACTIVE_STATES.includes(state);
}

const LIVE: readonly VoiceState[] = ['listening', 'user-speaking', 'processing', 'assistant-speaking'];

export function voiceReducer(model: VoiceModel, event: VoiceEvent): VoiceModel {
  const { state } = model;
  switch (event.type) {
    case 'START':
      return state === 'idle' || state === 'ended' || state === 'error' ? { state: 'connecting' } : model;
    case 'ABORT':
      return state === 'connecting' ? { state: 'idle' } : model;
    case 'RESUME_FAILED':
      return state === 'connecting' ? { state: 'ended' } : model;
    case 'CALL_STARTED':
      return state === 'connecting' ? { state: 'listening' } : model;
    case 'USER_SPEECH_START':
      // Customers may talk over the assistant, so this is allowed from any live state.
      return LIVE.includes(state) ? { state: 'user-speaking' } : model;
    case 'USER_SPEECH_END':
      return state === 'user-speaking' ? { state: 'processing' } : model;
    case 'ASSISTANT_SPEECH_START':
      return LIVE.includes(state) ? { state: 'assistant-speaking' } : model;
    case 'ASSISTANT_SPEECH_END':
      return state === 'assistant-speaking' ? { state: 'listening' } : model;
    case 'END_REQUESTED':
      return isActive(state) ? { state: 'ending' } : model;
    case 'CALL_ENDED':
      // An error stays visible even if the call then reports that it ended.
      return state === 'idle' || state === 'error' || state === 'ended' ? model : { state: 'ended' };
    case 'ERROR':
      return state === 'ended' ? model : { state: 'error', error: event.kind };
  }
}
