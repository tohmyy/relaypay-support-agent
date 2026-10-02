'use client';

import { COPY } from '@/lib/copy';
import Composer from './shell/Composer';

/**
 * The text box under the voice panel: an alternative way to say the same thing. Enter sends, Shift+Enter makes a new
 * line, and the text stays in the box when sending fails.
 */
export default function TypedComposer({
  onSend,
  sending = false,
  disabled = false,
  error = null,
}: {
  onSend(text: string): Promise<boolean>;
  sending?: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  const t = COPY.typed;
  return (
    <Composer
      label={t.label}
      placeholder={t.placeholder}
      sendLabel={t.send}
      sendingLabel={t.sending}
      sending={sending}
      disabled={disabled}
      errorText={error}
      tooLongText={t.tooLong}
      onSend={onSend}
    />
  );
}
