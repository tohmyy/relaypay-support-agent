import SupportPage, { type VoiceConfig } from '@/components/SupportPage';

// Read the environment on every request so a changed assistant takes effect without a rebuild.
export const dynamic = 'force-dynamic';

function voiceConfig(previewRequested: boolean): VoiceConfig {
  // Preview mode (a scripted conversation, no microphone) is for development: ?mock=1 on the dev
  // server, or NEXT_PUBLIC_VOICE_MOCK=1 anywhere. A production server ignores the query parameter.
  if (process.env.NEXT_PUBLIC_VOICE_MOCK === '1') return { mode: 'mock' };
  if (previewRequested && process.env.NODE_ENV !== 'production') return { mode: 'mock' };
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? '';
  const assistantId = process.env.VAPI_ASSISTANT_ID ?? '';
  return publicKey && assistantId ? { mode: 'vapi', publicKey, assistantId } : { mode: 'unconfigured' };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ mock?: string }> }) {
  const { mock } = await searchParams;
  return <SupportPage config={voiceConfig(mock === '1')} />;
}
