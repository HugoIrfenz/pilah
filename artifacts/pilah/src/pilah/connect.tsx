import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Wifi } from 'lucide-react';
import { getGetConnectionStatusQueryKey, getGetOwnerSessionQueryKey, useDisconnectWhatsApp } from '@workspace/api-client-react';
import { Btn } from './ui';
import { LinkNotice } from './notices';

export function ConnectionPanel({ status, pending, onConnect }: { status: { state: string; qrDataUrl: string | null; error: string | null; selectedChats: number; availableChats: number; analyzedMessages: number }; pending: boolean; onConnect: () => void }) {
  const disconnect = useDisconnectWhatsApp();
  const queryClient = useQueryClient();
  const [ack, setAck] = useState(false);
  const [feedback, setFeedback] = useState('');
  const isError = status.state === 'error';
  const label = ({ disconnected: 'Not connected', connecting: 'Starting connection', awaiting_scan: 'Scan to connect', syncing: 'Syncing conversations', reconnecting: 'Reconnecting', error: 'Connection needs attention' } as Record<string, string>)[status.state] ?? status.state;
  return <section className="page-in mx-auto w-full max-w-[720px] rounded-2xl border border-line bg-white p-5 shadow-sm md:p-7" aria-label="WhatsApp connection">
    <div className="flex items-start gap-4">
      <span className={`relative mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full ${isError ? 'bg-[#fbe5e1] text-coral' : 'bg-mint text-pine'}`}>{(status.state === 'syncing' || status.state === 'connecting' || status.state === 'reconnecting') && <span className="ping-soft absolute inset-0 rounded-full bg-leaf/40" />}<Wifi size={19} className="relative" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="display text-[22px] font-bold tracking-tight">{label}</h2><span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] text-mute">{status.state.replace('_', ' ')}</span></div>
        <p className="mt-1.5 max-w-[520px] text-[13px] leading-5 text-mute">{status.error || (status.state === 'awaiting_scan' ? 'Open WhatsApp on your phone, go to Linked devices, and scan this code.' : status.state === 'syncing' ? `${status.analyzedMessages} messages analyzed so far. Your inbox will fill in as sync continues.` : 'Link a real WhatsApp account to see a private, prioritized view of the chats you select. This is separate from the synthetic demo.')}</p>
        {(status.state === 'syncing' || status.state === 'reconnecting') && <div className="mt-4 flex gap-1.5" aria-label="Synchronization in progress"><span className="skeleton h-1.5 w-20 rounded-full" /><span className="skeleton h-1.5 w-10 rounded-full" /></div>}
      </div>
    </div>
    {status.qrDataUrl && <div className="mt-6 flex justify-center">
      <img src={status.qrDataUrl} alt="WhatsApp connection QR code" className="aspect-square w-full max-w-[320px] rounded-2xl border border-line bg-white p-3 object-contain" />
    </div>}
    {(status.state === 'disconnected' || isError) && <div className="mt-5"><LinkNotice ack={ack} setAck={setAck} /></div>}
    <div className="mt-5 flex flex-wrap gap-2">
      {status.state === 'disconnected' || isError ? <Btn onClick={onConnect} disabled={pending || !ack} testId="button-connect-device">{pending ? 'Connecting…' : 'Link WhatsApp'} <ArrowRight size={14} /></Btn> : null}
      {status.state !== 'disconnected' && <Btn kind="secondary" onClick={() => disconnect.mutate(undefined, { onSuccess: result => { setFeedback(result.ownerInstruction || 'Pairing cancelled.'); void queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetOwnerSessionQueryKey() }); }, onError: error => setFeedback(error instanceof Error ? error.message : 'Disconnect could not complete.') })} disabled={disconnect.isPending} testId="button-disconnect">{disconnect.isPending ? 'Stopping…' : 'Cancel connection'}</Btn>}
    </div>
    {feedback && <p role="status" className="mt-3 text-[12px] leading-5 text-[#7a5a10]">{feedback}</p>}
  </section>;
}
