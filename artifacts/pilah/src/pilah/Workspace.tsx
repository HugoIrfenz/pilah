import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { BellRing, MessageSquare, Menu, Shield, Star, X } from 'lucide-react';
import { ChatList } from './ChatList';
import { ChatPane } from './ChatPane';
import { Insights } from './Insights';
import type { Ctx, CtxState, Filter, Row, View } from './types';
import { Brand } from './ui';

const rank = (r: Row) => (r.item && !r.reviewed ? { now: 0, later: 1, low: 2 }[r.item.priority] : 3);

export function Workspace({ rows, counts, selectedId, onSelect, onToggleSelect, ctx, ctxState, onReview, reviewPending, onImportant, now, banner, notices, sidebarFooter, listLoading, openSignal = 0 }: {
  rows: Row[]; counts: { now: number; later: number; low: number }; selectedId: string; onSelect: (id: string) => void; onToggleSelect?: (row: Row) => void;
  ctx: Ctx | null; ctxState: CtxState; onReview: () => void; reviewPending: boolean; onImportant: () => void; now: number;
  banner?: ReactNode; notices?: ReactNode; sidebarFooter: ReactNode; listLoading?: boolean; openSignal?: number;
}) {
  const [view, setView] = useState<View>('chats');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'list' | 'chat' | 'insights'>('list');
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (openSignal) setPanel('chat'); }, [openSignal]);

  const sorted = useMemo(() => [...rows].sort((a, b) => rank(a) - rank(b) || Date.parse(b.latest ?? '0') - Date.parse(a.latest ?? '0')), [rows]);
  const open = (r: Row) => !!r.item && !r.reviewed;
  const navCounts = { chats: rows.length, priority: rows.filter(open).length, important: rows.filter(r => r.important).length };
  const q = query.trim().toLowerCase();
  const visible = sorted.filter(r => (view === 'priority' ? open(r) : view === 'important' ? r.important : true)
    && (filter === 'all' || (open(r) && r.item?.priority === filter)) && (!q || r.name.toLowerCase().includes(q)));
  const nav: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'chats', label: 'Chats', icon: <MessageSquare size={17} /> },
    { id: 'priority', label: 'Priority', icon: <BellRing size={17} /> },
    { id: 'important', label: 'Important', icon: <Star size={17} /> },
  ];
  const selectedRow = rows.find(r => r.chatId === selectedId);
  const pick = (id: string) => { onSelect(id); setPanel('chat'); };

  const header = <div className="flex items-center justify-between">
    <div className="flex items-center gap-2"><h1 className="display text-[22px] font-bold tracking-tight">{nav.find(n => n.id === view)?.label}</h1><span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-semibold text-pine">{navCounts[view]}</span></div>
    <button onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-label={menu ? 'Close menu' : 'Open menu'} data-testid="button-menu" className="press grid h-9 w-9 place-items-center rounded-full text-mute hover:bg-mint lg:hidden">{menu ? <X size={18} /> : <Menu size={18} />}</button>
  </div>;

  return <div className="flex h-[100dvh] flex-col bg-paper">
    {banner}
    {notices && <div className="space-y-2 px-3 pt-2">{notices}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[208px_minmax(300px,350px)_minmax(0,1fr)] xl:grid-cols-[208px_minmax(300px,350px)_minmax(0,1fr)_300px]">
      <nav className="hidden flex-col justify-between bg-[#eef3ef] px-3 py-4 lg:flex" aria-label="Main">
        <div><div className="px-2 pb-5"><Brand /></div>
          <div className="space-y-1">{nav.map(n => <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined} data-testid={`nav-${n.id}`} className={`press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold ${view === n.id ? 'bg-white text-pine shadow-sm' : 'text-mute hover:bg-white/60'}`}>{n.icon}<span className="flex-1 text-left">{n.label}</span><span className={`rounded-full px-1.5 text-[11px] ${view === n.id ? 'bg-pine text-white' : 'text-mute'}`}>{navCounts[n.id]}</span></button>)}</div>
        </div>
        <div className="space-y-3">
          {sidebarFooter}
          <Link href="/privacy" className="press flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-mute hover:bg-white/60" data-testid="link-privacy"><Shield size={14} />Privacy and data</Link>
          <p className="px-3 text-[22px] leading-6 text-pine/70" style={{ fontFamily: 'Caveat, cursive' }}>Don't read everything. Know what needs you.</p>
        </div>
      </nav>
      <div className={`${panel === 'list' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
        {menu && <div className="page-in space-y-3 border-b border-line bg-[#eef3ef] p-3 lg:hidden">
          <div className="flex gap-1.5">{nav.map(n => <button key={n.id} onClick={() => { setView(n.id); setMenu(false); }} aria-current={view === n.id ? 'page' : undefined} className={`press flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[12px] font-semibold ${view === n.id ? 'bg-white text-pine shadow-sm' : 'text-mute'}`}>{n.icon}{n.label}</button>)}</div>
          {sidebarFooter}
          <Link href="/privacy" className="flex items-center gap-2 text-[12px] text-mute" data-testid="link-privacy-mobile"><Shield size={14} />Privacy and data</Link>
        </div>}
        <ChatList rows={visible} total={rows.length} counts={counts} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} view={view} selectedId={selectedId} now={now} loading={listLoading} onSelect={pick} onToggleSelect={onToggleSelect} header={header} />
      </div>
      <div className={`${panel === 'chat' ? 'flex' : panel === 'insights' ? 'hidden xl:flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-col [&>section]:flex-1`}>
        <ChatPane ctx={ctx} state={ctxState} hasSelection={!!selectedId && !!selectedRow} isGroup={selectedRow?.isGroup ?? false} now={now} onBack={() => setPanel('list')} onInsights={() => setPanel('insights')} />
      </div>
      <div className={`${panel === 'insights' ? 'flex' : 'hidden xl:flex'} min-h-0 min-w-0 flex-col [&>aside]:flex-1`}>
        <Insights ctx={ctx} state={ctxState} now={now} onReview={onReview} reviewPending={reviewPending} onImportant={onImportant} onBack={() => setPanel('chat')} />
      </div>
    </div>
  </div>;
}
