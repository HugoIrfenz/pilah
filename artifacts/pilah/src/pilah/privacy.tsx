import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, Clock3, LockKeyhole, Shield, Trash2, Wifi } from 'lucide-react';
import { getGetAiConsentQueryKey, getGetConnectionStatusQueryKey, useDeleteOwnerData, useDisconnectWhatsApp, useGetAiConsent, useGetOwnerSession } from '@workspace/api-client-react';
import { Frame } from './Frame';
import { RetentionList } from './notices';
import { Btn } from './ui';

function Card({ icon, title, children, tone = 'mint' }: { icon: React.ReactNode; title: string; children: React.ReactNode; tone?: 'mint' | 'sun' }) {
  return <section className="rounded-2xl border border-line bg-white p-5 shadow-sm md:p-6"><div className="flex items-start gap-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone === 'mint' ? 'bg-mint text-pine' : 'bg-[#faefd2] text-[#85590a]'}`}>{icon}</span><div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold">{title}</h2>{children}</div></div></section>;
}

export default function PrivacyPage() {
  const sessionQuery = useGetOwnerSession();
  const session = sessionQuery.data;
  const consentQuery = useGetAiConsent({ query: { enabled: !!session?.authenticated, queryKey: getGetAiConsentQueryKey() } });
  const consent = consentQuery.data;
  const deleteData = useDeleteOwnerData();
  const disconnect = useDisconnectWhatsApp();
  const queryClient = useQueryClient();
  const [deleteText, setDeleteText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const callError = (value: unknown) => value instanceof Error ? value.message : 'Please try again.';
  return <Frame>
    <Link href="/" className="press inline-flex items-center gap-2 text-[13px] font-semibold text-mute hover:text-pine" data-testid="link-back-home"><ArrowLeft size={14} /> Back to PILAH</Link>
    <p className="mt-8 text-[11px] font-semibold uppercase tracking-[.15em] text-pine">Your data, your call</p>
    <h1 className="display mt-3 text-[clamp(2.5rem,7vw,4rem)] font-extrabold leading-[.98] tracking-[-.045em]">Privacy, plainly.</h1>
    <p className="mt-5 max-w-[620px] text-[15px] leading-7 text-mute">PILAH is a read-only personal inbox, not an assistant that writes back. It reads the chats you select to surface what may need your attention. You stay in control of what is connected and retained.</p>
    <div className="mt-8 space-y-4">
      <Card icon={<Shield size={18} />} title="AI analysis">
        <p className="mt-2 text-[13px] leading-6 text-mute">PILAH currently ranks with deterministic rules only. No AI provider is integrated, so no message text is ever sent to one. Opting in to AI is not available yet; if it ships, it will be off until you turn it on.</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4"><div><p className="text-[13px] font-semibold">Ranking method: Rules-based</p><p className="mt-1 text-[11px] text-mute">{session?.authenticated ? consentQuery.isLoading ? 'Checking saved consent…' : consent?.enabled ? 'A saved consent exists but is not used. Nothing is sent to an AI provider.' : 'AI consent: off' : 'Sign in to see saved consent.'}</p></div>
          <button disabled aria-disabled="true" className="inline-flex min-h-10 cursor-not-allowed items-center rounded-full border border-line px-4 text-[13px] font-semibold text-mute/60" data-testid="button-ai-unavailable">AI opt-in unavailable</button></div>
      </Card>
      <Card icon={<Clock3 size={18} />} title="What PILAH keeps" tone="sun"><RetentionList /><p className="mt-3 text-[13px] leading-6 text-mute">Linking is unofficial and not affiliated with WhatsApp or Meta. WhatsApp does not scope a linked device to selected chats. Use a dedicated test account. Deleting PILAH data cannot revoke the linked device inside WhatsApp; remove it from Linked devices on your phone if the app cannot.</p></Card>
      <Card icon={<Wifi size={18} />} title="Disconnect WhatsApp" tone="sun">
        <p className="mt-2 text-[13px] leading-6 text-mute">Stop ingestion and reconnect attempts, and attempt device logout. If logout cannot be confirmed, remove PILAH manually in your phone's Linked devices settings.</p>
        {session?.authenticated ? <Btn kind="secondary" className="mt-4" onClick={() => { setMessage(''); setError(''); disconnect.mutate(undefined, { onSuccess: result => { setMessage(result.ownerInstruction || 'WhatsApp disconnected from PILAH.'); void queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); }, onError: value => setError(callError(value)) }); }} disabled={disconnect.isPending} testId="button-privacy-disconnect">{disconnect.isPending ? 'Disconnecting…' : 'Disconnect WhatsApp'}</Btn> : <p className="mt-4 text-[12px] text-mute">Sign in on the <Link href="/live" className="font-semibold text-pine">live inbox</Link> to manage your connection.</p>}
      </Card>
      <section className="rounded-2xl border border-[#e5c3bd] bg-[#fff8f6] p-5 md:p-6"><div className="flex items-start gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fbe5e1] text-coral"><Trash2 size={18} /></span><div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-[#6f2f27]">Disconnect and delete my data</h2><p className="mt-2 text-[13px] leading-6 text-[#8a5a53]">This stops processing and permanently deletes PILAH's stored auth, selected-chat text, summaries, preferences and sessions. Type <strong>DELETE</strong> to confirm. This action cannot be undone.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={deleteText} onChange={event => setDeleteText(event.target.value)} placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm data deletion" className="h-11 flex-1 rounded-xl border border-[#e5c3bd] bg-white px-4 text-[13px] outline-none focus:ring-2 focus:ring-coral/30" data-testid="input-confirm-delete" />
          <Btn kind="danger" disabled={deleteText !== 'DELETE' || deleteData.isPending || !session?.authenticated} onClick={() => { setError(''); setMessage(''); deleteData.mutate({ data: { confirmation: 'DELETE' } }, { onSuccess: result => { setMessage(result.ownerInstruction || 'PILAH owner data deleted.'); setDeleteText(''); queryClient.clear(); }, onError: value => setError(callError(value)) }); }} testId="button-delete-data">{deleteData.isPending ? 'Deleting…' : 'Disconnect and delete'}</Btn></div>
        {!session?.authenticated && <p className="mt-2 text-[11px] text-[#98706a]">Sign in to delete live owner data.</p>}</div></div></section>
    </div>
    {message && <p role="status" className="page-in mt-4 rounded-xl border border-[#bfe0cf] bg-mint px-4 py-3 text-[13px] text-pine">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-[#e5c3bd] bg-[#fff8f6] px-4 py-3 text-[13px] text-[#9a3f33]">{error}</p>}
    <div className="mt-8 flex items-center gap-2 text-[11px] text-mute"><LockKeyhole size={13} /> This privacy page never loads demo data into your live inbox.</div>
  </Frame>;
}
