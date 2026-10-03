import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { FlaskConical, Shield } from 'lucide-react';
import { Brand } from './ui';

export function Frame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className="min-h-[100dvh] bg-paper">
    <header className="mx-auto flex max-w-[1100px] items-center justify-between px-5 py-5 md:px-8">
      <Brand />
      <nav className="flex items-center gap-1 text-[13px]">
        <Link href="/demo" className="press inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-semibold text-mute hover:bg-mint hover:text-pine" data-testid="link-demo"><FlaskConical size={14} />Demo</Link>
        <Link href="/privacy" className="press inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-semibold text-mute hover:bg-mint hover:text-pine" data-testid="link-privacy"><Shield size={14} />Privacy</Link>
      </nav>
    </header>
    <div className={`page-in mx-auto px-5 pb-16 md:px-8 ${wide ? 'max-w-[1100px]' : 'max-w-[760px]'}`}>{children}</div>
  </main>;
}
