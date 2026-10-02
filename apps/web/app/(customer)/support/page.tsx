import SupportPage, { type VoiceConfig } from '@/components/SupportPage';
import { requireCustomer } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

// Same rules as the public page: preview mode (a scripted conversation, no microphone) is for development only.
function voiceConfig(previewRequested: boolean): VoiceConfig {
  if (process.env.NEXT_PUBLIC_VOICE_MOCK === '1') return { mode: 'mock' };
  if (previewRequested && process.env.NODE_ENV !== 'production') return { mode: 'mock' };
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? '';
  const assistantId = process.env.VAPI_ASSISTANT_ID ?? '';
  return publicKey && assistantId ? { mode: 'vapi', publicKey, assistantId } : { mode: 'unconfigured' };
}

/** The voice experience inside the signed-in shell; each real call is tied to this customer once it has an id. */
export default async function CustomerSupportPage({ searchParams }: { searchParams: Promise<{ mock?: string }> }) {
  await requireCustomer('/support');
  const { mock } = await searchParams;
  return <SupportPage config={voiceConfig(mock === '1')} embedded linkIdentity />;
}
