import { notFound } from 'next/navigation';
import VoiceLab from '@/components/dev/VoiceLab';

// Developer workbench for the pause/resume investigation. It drives the real assistant, so, like /dev/states, it is
// not available in production unless explicitly enabled.
export const dynamic = 'force-dynamic';

export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_STATES !== '1') notFound();
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? '';
  const assistantId = process.env.VAPI_ASSISTANT_ID ?? '';
  if (!publicKey || !assistantId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-xl font-semibold text-ink">Voice lab</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Needs NEXT_PUBLIC_VAPI_PUBLIC_KEY and VAPI_ASSISTANT_ID in .env.local.
        </p>
      </main>
    );
  }
  return <VoiceLab publicKey={publicKey} assistantId={assistantId} />;
}
