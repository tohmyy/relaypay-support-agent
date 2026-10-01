import { notFound } from 'next/navigation';
import StatesGallery from '@/components/dev/StatesGallery';

// Visual review page. Not available in production unless explicitly enabled.
export const dynamic = 'force-dynamic';

export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_STATES !== '1') notFound();
  return <StatesGallery />;
}
