import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Users } from 'lucide-react';

export type Priority = 'now' | 'later' | 'low';

export const priorityText = (p: Priority) => (p === 'now' ? 'Read now' : p === 'later' ? 'Read later' : 'Low priority');
export const priorityDot = (p: Priority) => (p === 'now' ? 'bg-coral' : p === 'later' ? 'bg-sun' : 'bg-[#8a9a94]');

const TZ = 'Asia/Jakarta';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
}
export function clock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(date);
}
export function shortStamp(value: string | null, now: number) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (Date.parse(dayKey(new Date(now))) - Date.parse(dayKey(date))) / 86400000;
  if (diff <= 0) return clock(value);
  if (diff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(date);
}
export function dayLabel(value: string, now: number) {
  const date = new Date(value);
  const diff = (Date.parse(dayKey(new Date(now))) - Date.parse(dayKey(date))) / 86400000;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'long' }).format(date);
}
export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));
export function relativeTime(value: string | null, now: number) {
  if (!value) return '';
  const mins = Math.round((now - Date.parse(value)) / 60000);
  if (mins <= 0) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
  return `${Math.floor(mins / 1440)} d ago`;
}

export function Logo({ size = 32 }: { size?: number }) {
  return <span className="grid shrink-0 place-items-center rounded-[10px] bg-pine text-white" style={{ width: size, height: size }}>
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" stroke="#7be0b0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>;
}
export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Pilah home" data-testid="link-brand">
    <Logo />
    <span><span className={`display block text-[21px] font-extrabold leading-none tracking-[-.04em] ${light ? 'text-white' : 'text-ink'}`}>pilah</span><span className={`block text-[10px] leading-4 ${light ? 'text-white/65' : 'text-mute'}`}>Less noise. More you.</span></span>
  </Link>;
}

const AV = ['#0a5c4a', '#2d7d6b', '#8a6a2f', '#5b5f97', '#a1504a', '#3b7a96', '#6b7a2e'];
export function Avatar({ name, group = false, size = 44 }: { name: string; group?: boolean; size?: number }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const hash = [...name].reduce((n, c) => n + c.charCodeAt(0), 0);
  return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: group ? '#6b8a80' : AV[hash % AV.length], fontSize: size * 0.34 }}>
    {group ? <Users size={size * 0.46} /> : letters}
  </span>;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const tone = priority === 'now' ? 'bg-[#fbe5e1] text-[#a63a2b]' : priority === 'later' ? 'bg-[#faefd2] text-[#85590a]' : 'bg-[#e8eeea] text-[#52645d]';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}><span className={`h-1.5 w-1.5 rounded-full ${priorityDot(priority)}`} />{priorityText(priority)}</span>;
}

type Kind = 'primary' | 'secondary' | 'quiet' | 'danger';
export function Btn({ children, onClick, className = '', disabled, kind = 'primary', type = 'button', testId }: { children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean; kind?: Kind; type?: 'button' | 'submit'; testId?: string }) {
  const tone = kind === 'primary' ? 'bg-pine text-white hover:bg-pine-deep' : kind === 'danger' ? 'border border-[#e5c3bd] bg-[#fff8f6] text-[#9a3f33] hover:bg-[#fbebe7]' : kind === 'secondary' ? 'border border-line bg-white text-ink hover:border-leaf hover:text-pine' : 'text-mute hover:bg-mint';
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`press inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${tone} ${className}`}>{children}</button>;
}

export function Notice({ title, detail, action, tone = 'warn' }: { title: string; detail: string; action?: ReactNode; tone?: 'warn' | 'info' }) {
  return <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${tone === 'info' ? 'border-[#bfe0cf] bg-mint' : 'border-[#ecd9a8] bg-[#fbf4df]'}`}>
    <div><p className="text-[13px] font-semibold text-ink">{title}</p><p className="mt-0.5 max-w-[640px] text-[12px] leading-5 text-mute">{detail}</p></div>{action}
  </div>;
}

export function SkeletonList({ rows = 7 }: { rows?: number }) {
  return <div className="space-y-1 p-3" aria-label="Loading content">{Array.from({ length: rows }).map((_, i) => <div key={i} className="flex gap-3 rounded-xl p-2"><div className="skeleton h-11 w-11 shrink-0 rounded-full" /><div className="flex-1 space-y-2 pt-1.5"><div className="skeleton h-3 w-2/5 rounded-full" /><div className="skeleton h-2.5 w-4/5 rounded-full" /></div></div>)}</div>;
}
