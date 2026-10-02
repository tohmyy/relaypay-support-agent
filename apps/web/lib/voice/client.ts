import type { ErrorKind } from './state';

export interface TranscriptEvent {
  role: 'user' | 'assistant';
  text: string;
  /** False while the speech recognizer or voice is still producing the sentence. */
  final: boolean;
}

/** What a voice client reports. The session hook turns these into VoiceState and transcript turns. */
export interface VoiceClientHandlers {
  onCallStart(): void;
  onCallEnd(): void;
  onUserSpeech(active: boolean): void;
  onAssistantSpeech(active: boolean): void;
  /** Assistant output level, 0 to 1. */
  onVolume(level: number): void;
  onTranscript(event: TranscriptEvent): void;
  onError(kind: ErrorKind): void;
  /** The microphone was muted or unmuted, when the provider can tell. Never called when it cannot. */
  onMuteChange?(muted: boolean): void;
  /** How loud the room is right now (0 to 1) while the customer is not speaking, when the provider can measure it. */
  onAmbientLevel?(level: number): void;
}

/** The only surface the UI knows about the voice provider (keeps the provider swappable and testable). */
export interface VoiceClient {
  /** Starts a call. Resolves with the backend conversation id once the call exists. */
  start(handlers: VoiceClientHandlers): Promise<{ conversationId: string }>;
  stop(): Promise<void>;
  /** Types a message into the live call as if the customer had said it. */
  send(text: string): void;
}

/** Builds a client. `resumeConversationId` continues an earlier conversation on a new call (the 30 second resume). */
export type VoiceClientFactory = (options?: { resumeConversationId?: string }) => VoiceClient;
