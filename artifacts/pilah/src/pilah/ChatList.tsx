import { Check, Plus, Search, SearchX, Star } from 'lucide-react';
import type { Filter, Row, View } from './types';
import { Avatar, priorityDot, shortStamp, SkeletonList } from './ui';

type Counts = { now: number; later: number; low: number };

export function ChatList({ rows, total, counts, filter, setFilter, query, setQuery, view, selectedId, now, loading, onSelect, onToggleSelect, header }: {
  rows: Row[]; total: number; counts: Counts; filter: Filter; setFilter: (f: Filter) => void; query: string; setQuery: (q: string) => void; view: View;
  selectedId: string; now: number; loading?: boolean; onSelect: (id: string) => void; onToggleSelect?: (row: Row) => void; header: React.ReactNode;
}) {
  const chips: { id: Filter; label: string; n: number; dot?: string }[] = [
    { id: 'all', label: 'All', n: total },
    { id: 'now', label: 'Read now', n: counts.now, dot: 'bg-coral' },
    { id: 'later', label: 'Read later', n: counts.later, dot: 'bg-sun' },
    { id: 'low', label: 'Low priority', n: counts.low, dot: 'bg-[#8a9a94]' },
  ];
  return <section className="flex min-h-0 flex-col border-r border-line bg-white" aria-label="Conversations">
    <div className="px-4 pb-2 pt-4">
      {header}
      <label className="relative mt-3 block"><Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" data-testid="input-search" className="h-10 w-full rounded-full bg-paper pl-10 pr-4 text-[13px] outline-none transition focus:bg-mint focus:ring-2 focus:ring-leaf/40" /></label>
      <div className="scroll-thin -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Priority filter">
        {chips.map(c => <button key={c.id} onClick={() => setFilter(c.id)} aria-pressed={filter === c.id} data-testid={`filter-${c.id}`} className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${filter === c.id ? 'bg-pine text-white' : 'bg-paper text-mute hover:bg-mint'}`}>
          {c.dot && <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />}{c.label}<span className={filter === c.id ? 'text-white/75' : 'text-mute/70'}>{c.n}</span></button>)}
      </div>
    </div>
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {loading ? <SkeletonList /> : !rows.length ? <div className="page-in flex flex-col items-center px-8 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-mint text-pine">{query ? <SearchX size={20} /> : <Check size={20} />}</span>
        <p className="mt-4 text-[14px] font-semibold">{query ? 'No chats match your search' : total ? 'Nothing here' : 'No chats yet'}</p>
        <p className="mt-1 text-[12px] leading-5 text-mute">{query ? 'Try a different name.' : view === 'important' ? 'Star a chat from its insights to pin it here.' : total ? 'Everything in this view has been reviewed, or no chat matches this filter.' : 'Chats appear here once they are available.'}</p>
      </div> : rows.map((r, i) => {
        const open = r.item && !r.reviewed;
        const active = selectedId === r.chatId;
        return <div key={r.chatId} style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }} className={`page-in group relative flex items-center transition-colors ${active ? 'bg-mint' : 'hover:bg-[#f4f8f6]'}`}>
          {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-pine" />}
          <button onClick={() => onSelect(r.chatId)} aria-current={active ? 'true' : undefined} data-testid={`button-chat-${r.chatId}`} className="press flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
            <Avatar name={r.name} group={r.isGroup} />
            <span className="min-w-0 flex-1 border-b border-line/70 pb-3 -mb-3 group-last:border-0">
              <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[14px] font-semibold">{r.name}</span><span className={`shrink-0 text-[11px] ${open && r.item?.priority === 'now' ? 'font-semibold text-coral' : 'text-mute'}`}>{shortStamp(r.latest, now)}</span></span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mute">
                {open && r.item && <span className={`h-2 w-2 shrink-0 rounded-full ${priorityDot(r.item.priority)}`} />}
                {r.reviewed && <Check size={12} className="shrink-0 text-leaf" />}
                {r.important && <Star size={11} className="shrink-0 text-sun" fill="currentColor" />}
                <span className="truncate">{r.item ? r.item.summary : r.selected ? 'Nothing needs you here' : 'Not in your inbox'}</span>
              </span>
            </span>
          </button>
          {onToggleSelect && <button onClick={() => onToggleSelect(r)} aria-pressed={r.selected} aria-label={`${r.selected ? 'Remove' : 'Add'} ${r.name} ${r.selected ? 'from' : 'to'} inbox`} data-testid={`button-select-${r.chatId}`} className={`press mr-3 grid h-8 w-8 shrink-0 place-items-center rounded-full ${r.selected ? 'bg-pine text-white' : 'border border-line text-mute hover:border-leaf hover:text-pine'}`}>{r.selected ? <Check size={14} /> : <Plus size={14} />}</button>}
        </div>;
      })}
    </div>
  </section>;
}
