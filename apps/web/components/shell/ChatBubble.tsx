import type { ThreadMessage } from '@/hooks/useChatThread';
import type { ChatLogLabels } from './ChatLog';

function formatStamp(at: string): string | null {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(11, 16);
}

/**
 * One row in the specialist chat: who said it, when, the body, and sending/retry/seen marks. Shared by the customer
 * and staff logs so both sides read the same conversation the same way.
 */
export default function ChatBubble({
  message,
  own,
  labels,
  seen,
  onRetry,
  onDiscard,
}: {
  message: ThreadMessage;
  own: boolean;
  labels: ChatLogLabels;
  seen: boolean;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}) {
  const stamp = formatStamp(message.at);
  if (message.sender === 'system') {
    return (
      <li className="text-center text-sm text-ink-muted">
        <p>{message.body}</p>
        {stamp && <p className="mt-1 text-xs">{stamp}</p>}
      </li>
    );
  }
  return (
    <li className="text-sm text-ink">
      <p className="text-xs font-medium text-ink-secondary">
        {own ? labels.you : labels.other(message)}
        {stamp ? <span className="ml-2 font-normal text-ink-muted">{stamp}</span> : null}
      </p>
      <p className={`whitespace-pre-wrap ${message.status === 'sending' ? 'text-ink-secondary' : ''}`}>{message.body}</p>
      {message.status === 'sending' && <p className="text-xs text-ink-muted">{labels.sending}</p>}
      {message.status === 'failed' && message.clientId && (
        <p className="text-xs text-danger">
          {labels.notSent}{' '}
          <button type="button" onClick={() => onRetry(message.clientId as string)} className="font-medium underline">
            {labels.retry}
          </button>{' '}
          <button type="button" onClick={() => onDiscard(message.clientId as string)} className="font-medium underline">
            {labels.remove}
          </button>
        </p>
      )}
      {own && !message.status && seen && <p className="text-xs text-ink-muted">{labels.seen}</p>}
    </li>
  );
}
