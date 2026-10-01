import Image from 'next/image';
import { COPY } from '@/lib/copy';

export default function Header() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Image src="/logo.png" alt="RelayPay" width={824} height={183} priority className="h-7 w-auto" />
        <p className="text-sm font-medium text-ink-secondary">
          <span className="hidden sm:inline">{COPY.headerLabel}</span>
          <span className="sm:hidden">{COPY.headerLabelCompact}</span>
        </p>
      </div>
    </header>
  );
}
