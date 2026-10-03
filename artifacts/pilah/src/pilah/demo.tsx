import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, FlaskConical, RefreshCw } from 'lucide-react';
import type { Chat, ConversationMessage } from '@workspace/api-client-react';
import { normalizeMessages, rankConversation } from '@workspace/pilah-core';
import type { SourceMessage } from '@workspace/pilah-core';
import { Workspace } from './Workspace';
import type { Row } from './types';
import { Btn } from './ui';

const DEMO_COPY = {
  rani: { id: 'rani', name: 'Rani Putri · Kopi Senja', group: false },
  launch: { id: 'launch', name: 'Tim Peluncuran', group: true },
  sync: { id: 'sync', name: 'Weekly sync notes', group: true },
  dika: { id: 'dika', name: 'Dika', group: false },
  promo: { id: 'promo', name: 'TokoRasa Promo', group: false },
  wulan: { id: 'wulan', name: 'Bu Wulan', group: false },
};
function dm(id: string, sender: string, start: number, minsAgo: number, text: string, extra: Partial<SourceMessage> = {}): SourceMessage {
  return { messageId: id, senderName: sender, timestamp: new Date(start - minsAgo * 60000).toISOString(), text, fromOwner: false, unsupportedContent: false, edited: false, deleted: false, quotedMessageId: null, ...extra };
}
function buildDemoMessages(start: number): Record<string, SourceMessage[]> {
  return {
    rani: [
      dm('rani-1', 'Rani Putri', start, 190, 'Selamat siang kak, desain label kemasan sudah kami revisi.'),
      dm('rani-2', 'Rani Putri', start, 42, 'Mohon approve desain final packaging sebelum kami kirim ke percetakan ya. Ditunggu konfirmasinya, kak.'),
    ],
    launch: [
      dm('launch-1', 'Bagas', start, 120, 'Draft deck sudah masuk folder bersama.'),
      dm('launch-2', 'Sekar', start, 25, '@you tolong kirim slide final sebelum 17:00 hari ini ya, klien presentasi jam 17:30.', { mentionedOwner: true }),
    ],
    sync: [
      dm('sync-1', 'Nadia', start, 300, 'FYI meeting notes: launch review dipindah ke minggu ketiga. No action needed, info aja.'),
    ],
    dika: [
      dm('dika-1', 'Dika', start, 75, 'wkwk liat meme ini, muka kamu pas deploy hari Jumat lol'),
      dm('dika-2', 'Dika', start, 74, 'haha another meme for the group chat'),
    ],
    promo: [
      dm('promo-1', 'TokoRasa', start, 600, 'Diskon 40% semua kopi dan voucher gratis ongkir, promo sale berakhir Minggu!'),
    ],
    wulan: [
      dm('wulan-1', 'Bu Wulan', start, 320, 'Please confirm jadwal pengiriman bahan baku untuk minggu depan.'),
      dm('wulan-2', 'You', start, 295, 'Sudah dikirim jadwalnya ke email, confirmed untuk Selasa pagi.', { fromOwner: true, quotedMessageId: 'wulan-1' }),
    ],
  };
}
const simulatedRequest = (now: number): SourceMessage => dm('sync-sim', 'Nadia', now, 0, 'Please approve the revised vendor budget, I need your answer in 30 minutes. @you', { mentionedOwner: true, timestamp: new Date(now).toISOString() });
const priorityOrder = { now: 0, later: 1, low: 2 } as const;

export default function DemoInbox() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const [messages, setMessages] = useState(() => buildDemoMessages(start));
  const [important, setImportant] = useState<Record<string, boolean>>({ rani: false });
  const [reviewedAt, setReviewedAt] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState('rani');
  const [simulated, setSimulated] = useState(false);
  const [flash, setFlash] = useState('');
  const [tick, setTick] = useState(0);
  const chats = Object.values(DEMO_COPY);
  const items = useMemo(() => chats.map(chat => rankConversation({ chatId: chat.id, displayName: chat.name, isGroup: chat.group, important: !!important[chat.id], messages: messages[chat.id] ?? [], contextComplete: true, reviewedAt: reviewedAt[chat.id] ?? null }, now))
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || Date.parse(b.latestActivity ?? '0') - Date.parse(a.latestActivity ?? '0')), [messages, important, reviewedAt, now]);
  const open = items.filter(item => !item.reviewed);
  const counts = { now: open.filter(i => i.priority === 'now').length, later: open.filter(i => i.priority === 'later').length, low: open.filter(i => i.priority === 'low').length };
  const item = items.find(value => value.chatId === selected) ?? null;
  const chatMeta = DEMO_COPY[selected as keyof typeof DEMO_COPY];
  const normalized = useMemo(() => normalizeMessages(messages[selected] ?? [], now), [messages, selected, now]);
  const context = item && chatMeta ? { chat: { chatId: selected, displayName: chatMeta.name, isGroup: chatMeta.group, selected: true, important: !!important[selected], reviewed: item.reviewed, latestActivity: item.latestActivity, retainedMessageCount: normalized.length } as Chat, item, messages: normalized as ConversationMessage[], contextComplete: true } : null;
  const rows: Row[] = chats.map(c => {
    const it = items.find(i => i.chatId === c.id) ?? null;
    return { chatId: c.id, name: c.name, isGroup: c.group, important: !!important[c.id], reviewed: !!it?.reviewed, selected: true, item: it, latest: it?.latestActivity ?? null };
  });
  const simulate = () => {
    if (simulated) return;
    const stamp = Date.now();
    setSimulated(true); setNow(stamp);
    setMessages(old => ({ ...old, sync: [...old.sync!, simulatedRequest(stamp)] }));
    setSelected('sync'); setTick(t => t + 1);
    setFlash('New message from Nadia in Weekly sync notes. It was ranked by the same rules as everything else.');
  };
  const banner = <div className="border-b border-[#e6d49a] bg-[#fbf1cf] px-3 py-2">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#6d4f0a]"><FlaskConical size={14} />Synthetic demo</span>
      <span className="text-[12px] text-[#7a6320]">Six fictional chats. No network calls, nothing touches WhatsApp. Refresh to reset.</span>
      <span className="ml-auto flex items-center gap-2">
        <Btn kind="secondary" className="min-h-8 px-3 text-[12px]" onClick={simulate} disabled={simulated} testId="button-simulate-message"><RefreshCw size={13} />{simulated ? 'Message simulated' : 'Simulate incoming message'}</Btn>
        <Link href="/live" className="press inline-flex min-h-8 items-center gap-1.5 rounded-full bg-pine px-3 text-[12px] font-semibold text-white hover:bg-pine-deep" data-testid="link-connect-whatsapp">Connect real WhatsApp <ArrowRight size={13} /></Link>
      </span>
    </div>
    {flash && <p role="status" className="page-in mt-1.5 text-[12px] text-pine">{flash}</p>}
  </div>;
  const footer = <div className="rounded-xl bg-white px-3 py-3 shadow-sm"><p className="flex items-center gap-2 text-[12px] font-semibold text-[#6d4f0a]"><span className="h-2 w-2 rounded-full bg-[#d9a520]" />Demo data</p><p className="mt-1 text-[11px] leading-4 text-mute">Fictional chats. Timestamps are relative to when you opened this page. Not connected to WhatsApp.</p></div>;
  return <Workspace rows={rows} counts={counts} selectedId={selected} onSelect={setSelected} ctx={context} ctxState={{ loading: false }} now={now} openSignal={tick} banner={banner} sidebarFooter={footer}
    onReview={() => setReviewedAt(old => ({ ...old, [selected]: new Date(Date.now()).toISOString() }))} reviewPending={false}
    onImportant={() => setImportant(old => ({ ...old, [selected]: !old[selected] }))} />;
}
