import { ArrowLeft, CalendarClock, CheckCheck, MessageSquareQuote, ScrollText, Star, Target } from 'lucide-react';
import type { Ctx, CtxState } from './types';
import { Btn, clock, formatTime, PriorityPill, relativeTime } from './ui';

const tone = { now: ['bg-[#fbe5e1]', 'text-[#a63a2b]', 'Needs your attention'], later: ['bg-[#faefd2]', 'text-[#85590a]', 'Worth reading later'], low: ['bg-[#e8eeea]', 'text-[#52645d]', 'Low priority'] } as const;

export function Insights({ ctx, state, now, onReview, reviewPending, onImportant, onBack }: { ctx: Ctx | null; state: CtxState; now: number; onReview: () => void; reviewPending: boolean; onImportant: () => void; onBack: () => void }) {
  const item = ctx?.item ?? null;
  const t = item ? tone[item.priority] : null;
  const key = item ? new Set(item.evidenceMessageIds) : new Set<string>();
  const keyMsgs = ctx ? ctx.messages.filter(m => key.has(m.messageId)) : [];
  return <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-line bg-white" aria-label="Priority insights">
    <header className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-3">
      <button onClick={onBack} aria-label="Back to conversation" data-testid="button-back-chat" className="press mt-0.5 grid h-8 w-8 place-items-center rounded-full text-mute hover:bg-mint xl:hidden"><ArrowLeft size={17} /></button>
      <div className="min-w-0 flex-1"><h2 className="display text-[15px] font-bold tracking-tight">Priority insights</h2><p className="mt-0.5 text-[11px] leading-4 text-mute">Rules-based, not AI. Highlights derived from message text.</p></div>
    </header>
    <div className="scroll-thin min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 [overflow-wrap:anywhere]">
      {state.loading ? <div className="space-y-3"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-20 rounded-xl" /></div>
        : !ctx ? <p className="py-10 text-center text-[13px] text-mute">Select a chat to see its insights.</p>
        : <div key={ctx.chat.chatId} className="slide-in space-y-4">
          <div className={`flex items-start gap-2 rounded-xl px-3 py-3 ${t ? t[0] : 'bg-mint'}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/70 ${t ? t[1] : 'text-pine'}`}><Target size={14} /></span>
            <div className="min-w-0 flex-1"><p className={`text-[12px] font-semibold ${t ? t[1] : 'text-pine'}`}>{ctx.chat.reviewed ? 'Reviewed in PILAH' : t ? t[2] : 'No priority signal'}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-mute">{item ? `${item.needsResponse === null ? 'Reply need unclear' : item.needsResponse ? 'A reply may be needed' : 'No reply needed'}${item.latestActivity ? ', ' + relativeTime(item.latestActivity, now) : ''}` : 'This chat is not ranked right now.'}</p>
              {item && <div className="mt-1.5"><PriorityPill priority={item.priority} /></div>}
            </div>
          </div>
          {item && <section><h3 className="flex items-center gap-2 text-[13px] font-semibold"><ScrollText size={15} className="text-pine" />Why this matters</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 pr-1 text-[12px] leading-5 text-ink/85"><li>{item.reason}</li>{item.needsReview && <li>Flagged for review.</li>}{!ctx.contextComplete && <li>Based on partial context.</li>}</ul></section>}
          {item?.dueAt && <section className="rounded-xl border border-line px-3 py-2.5"><h3 className="flex items-center gap-2 text-[12px] font-semibold text-mute"><CalendarClock size={14} className="text-pine" />Detected deadline</h3><p className="display mt-1 text-[15px] font-bold">{formatTime(item.dueAt)}</p><p className="text-[11px] text-mute">Read from the message text.</p></section>}
          {keyMsgs.length > 0 && <section><h3 className="flex items-center gap-2 text-[13px] font-semibold"><MessageSquareQuote size={15} className="text-pine" />Key messages<span className="font-normal text-mute">{keyMsgs.length} relevant</span></h3>
            <ol className="mt-2 space-y-2 border-l-2 border-line pl-3">{keyMsgs.map(m => <li key={m.messageId} className="text-[12px] leading-5"><span className="flex justify-between gap-2 text-[11px] text-mute"><span className="min-w-0">{m.fromOwner ? 'You' : m.senderName}</span><span className="shrink-0">{clock(m.timestamp)}</span></span>{m.text || 'Attachment'}</li>)}</ol></section>}
          {item && <section><h3 className="flex items-center gap-2 text-[13px] font-semibold"><ScrollText size={15} className="text-pine" />Chat summary</h3><p className="mt-2 rounded-xl bg-paper px-3 py-2.5 text-[12px] leading-5">{item.summary}</p></section>}
        </div>}
    </div>
    <div className="shrink-0 border-t border-line p-3">
      <div className="flex gap-2">
        <Btn className="min-w-0 flex-1 gap-1 px-2 text-[11px] whitespace-nowrap" onClick={onReview} disabled={!ctx || reviewPending || ctx.chat.reviewed} testId="button-mark-reviewed"><CheckCheck size={13} className="shrink-0" />{ctx?.chat.reviewed ? 'Reviewed' : reviewPending ? 'Saving…' : 'Mark reviewed'}</Btn>
        <Btn kind="secondary" className="min-w-0 flex-1 gap-1 px-2 text-[11px] whitespace-nowrap" onClick={onImportant} disabled={!ctx} testId="button-important"><span key={String(ctx?.chat.important)} className="pop inline-flex shrink-0"><Star size={13} fill={ctx?.chat.important ? 'currentColor' : 'none'} className={ctx?.chat.important ? 'text-sun' : ''} /></span>{ctx?.chat.important ? 'Important' : 'Mark important'}</Btn>
      </div>
      <p className="mt-2.5 text-[11px] leading-4 text-mute">Reviewed and Important live only in PILAH. They never send a WhatsApp read receipt.</p>
    </div>
  </aside>;
}
