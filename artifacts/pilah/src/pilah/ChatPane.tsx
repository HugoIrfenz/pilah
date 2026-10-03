import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, FileWarning, Lock, MessageCircle, PanelRight, Pencil, Ban } from 'lucide-react';
import type { ConversationMessage } from '@workspace/api-client-react';
import type { Ctx, CtxState } from './types';
import { Avatar, Btn, clock, dayLabel, Notice, sameDay } from './ui';

function Bubble({ m, quoted, evidence, showSender, first }: { m: ConversationMessage; quoted?: ConversationMessage; evidence: boolean; showSender: boolean; first: boolean }) {
  const text = m.deleted ? null : m.text;
  return <div className={`flex ${m.fromOwner ? 'justify-end' : 'justify-start'} ${first ? 'mt-2.5' : 'mt-0.5'}`}>
    <div className={`${m.fromOwner ? 'bubble-out' : 'bubble-in'} max-w-[82%] px-3 py-1.5 md:max-w-[68%] ${evidence ? 'ring-2 ring-leaf/50' : ''}`}>
      {showSender && !m.fromOwner && <p className="text-[12px] font-semibold text-pine">{m.senderName}</p>}
      {quoted && <div className="mb-1 mt-0.5 rounded-md border-l-[3px] border-leaf bg-black/5 px-2 py-1 text-[11.5px] text-mute"><span className="font-semibold">{quoted.fromOwner ? 'You' : quoted.senderName}</span><p className="line-clamp-2">{quoted.text || 'Message content unavailable'}</p></div>}
      {m.deleted ? <p className="flex items-center gap-1.5 text-[13px] italic text-mute"><Ban size={12} />This message was deleted.</p>
        : text ? <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.4]">{text}</p>
        : <p className="flex items-center gap-1.5 text-[13px] italic text-mute">{m.unsupportedContent && <FileWarning size={13} />}{m.unsupportedContent ? 'Attachment, not analyzed by PILAH.' : 'Message text unavailable.'}</p>}
      <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-mute">
        {evidence && <span className="rounded bg-leaf/15 px-1 font-semibold text-pine">Evidence</span>}
        {m.edited && <span className="flex items-center gap-0.5"><Pencil size={9} />Edited</span>}
        {clock(m.timestamp)}
      </p>
    </div>
  </div>;
}

export function ChatPane({ ctx, state, hasSelection, isGroup, now, onBack, onInsights }: { ctx: Ctx | null; state: CtxState; hasSelection: boolean; isGroup: boolean; now: number; onBack: () => void; onInsights: () => void }) {
  const map = useMemo(() => new Map((ctx?.messages ?? []).map(m => [m.messageId, m])), [ctx?.messages]);
  const evidence = useMemo(() => new Set(ctx?.item?.evidenceMessageIds ?? []), [ctx?.item]);
  const end = useRef<HTMLDivElement>(null);
  const count = ctx?.messages.length ?? 0;
  const chatId = ctx?.chat.chatId;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chatId, count]);
  if (!hasSelection) return <section className="wallpaper grid min-h-0 place-items-center p-8 text-center" aria-label="Conversation">
    <div className="page-in max-w-[320px] rounded-2xl bg-white/85 px-8 py-10 shadow-sm backdrop-blur"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-mint text-pine"><MessageCircle size={24} /></span>
      <h2 className="display mt-5 text-[20px] font-bold tracking-tight">Pick a chat</h2><p className="mt-2 text-[13px] leading-5 text-mute">Open a conversation to read its recent messages and see why PILAH ranked it.</p></div>
  </section>;
  return <section className="flex min-h-0 flex-col" aria-label="Conversation">
    <header className="flex items-center gap-3 border-b border-line bg-white px-3 py-2.5 md:px-4">
      <button onClick={onBack} aria-label="Back to chats" data-testid="button-back-chats" className="press grid h-9 w-9 place-items-center rounded-full text-mute hover:bg-mint lg:hidden"><ArrowLeft size={18} /></button>
      {ctx && <><Avatar name={ctx.chat.displayName} group={ctx.chat.isGroup} size={40} /><div className="min-w-0 flex-1"><h2 className="truncate text-[15px] font-semibold leading-tight">{ctx.chat.displayName}</h2><p className="text-[11.5px] text-mute">{ctx.chat.isGroup ? 'Group' : 'Personal'} chat, {ctx.chat.retainedMessageCount} retained {ctx.chat.retainedMessageCount === 1 ? 'message' : 'messages'}</p></div></>}
      {!ctx && <div className="min-w-0 flex-1"><div className="skeleton h-3.5 w-32 rounded-full" /></div>}
      <button onClick={onInsights} data-testid="button-open-insights" className="press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-mint px-3 text-[12px] font-semibold text-pine xl:hidden"><PanelRight size={14} />Insights</button>
    </header>
    <div className="wallpaper scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-[7%]">
      {state.loading ? <div className="space-y-3">{[60, 40, 70, 30].map((w, i) => <div key={i} className={`skeleton h-10 rounded-xl ${i % 2 ? 'ml-auto' : ''}`} style={{ width: `${w}%` }} />)}</div>
        : state.error ? <Notice title="Could not load messages" detail={state.error} action={state.retry && <Btn kind="secondary" onClick={state.retry}>Retry</Btn>} />
        : !ctx || !ctx.messages.length ? <div className="mx-auto mt-10 max-w-[280px] rounded-xl bg-white/90 px-5 py-6 text-center text-[13px] text-mute">No retained message context is available for this chat yet.</div>
        : <>
          {!ctx.contextComplete && <p className="mx-auto mb-3 w-fit rounded-lg bg-[#fbf4df] px-3 py-1.5 text-[11.5px] text-[#7a5a10]">Partial context. Earlier messages are not retained.</p>}
          {ctx.messages.map((m, i) => {
            const prev = ctx.messages[i - 1];
            const newDay = !prev || !sameDay(prev.timestamp, m.timestamp);
            const first = newDay || prev.fromOwner !== m.fromOwner || prev.senderName !== m.senderName;
            return <div key={m.messageId}>
              {newDay && <div className="my-3 flex justify-center"><span className="rounded-lg bg-white/90 px-3 py-1 text-[11.5px] font-medium text-mute shadow-sm">{dayLabel(m.timestamp, now)}</span></div>}
              <Bubble m={m} first={first} showSender={isGroup && first} evidence={evidence.has(m.messageId)} quoted={m.quotedMessageId ? map.get(m.quotedMessageId) : undefined} />
            </div>;
          })}
          <div ref={end} />
        </>}
    </div>
    <footer className="flex items-center gap-2.5 border-t border-line bg-[#f7f5ef] px-4 py-3 text-[12.5px] text-mute" data-testid="text-readonly-footer"><Lock size={14} className="shrink-0 text-pine" /><span>Read-only view. PILAH never sends messages or read receipts.</span></footer>
  </section>;
}
