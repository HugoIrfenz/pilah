import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Clock3, FlaskConical, LogOut, RefreshCw, Unplug } from 'lucide-react';
import {
  getGetChatContextQueryKey, getGetChatsQueryKey, getGetConnectionStatusQueryKey, getGetInboxQueryKey, getGetOwnerSessionQueryKey,
  useConnectWhatsApp, useDisconnectWhatsApp, useGetChatContext, useGetChats, useGetConnectionStatus, useGetInbox, useGetOwnerSession,
  useHealthCheck, useLogoutOwner, useReviewChat, useSelectInboxChats, useUpdateChatPreferences, useUpdateChatSelection,
} from '@workspace/api-client-react';
import { Workspace } from './Workspace';
import { ConnectionPanel } from './connect';
import { Frame } from './Frame';
import type { Row } from './types';
import { Btn, formatTime, Notice, SkeletonList } from './ui';

const failure = (value: unknown) => value instanceof Error ? value.message : 'Something did not work. Try again.';

export default function LiveInbox() {
  const sessionQuery = useGetOwnerSession({ query: { queryKey: getGetOwnerSessionQueryKey(), refetchInterval: 2000 } });
  const session = sessionQuery.data;
  const healthQuery = useHealthCheck({ query: { enabled: !!session?.authenticated, queryKey: ['/api/healthz'], refetchInterval: 30000 } });
  const logout = useLogoutOwner();
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();
  const [selectedId, setSelectedId] = useState('');
  const queryClient = useQueryClient();
  const inboxQuery = useGetInbox({ query: { enabled: !!session?.authenticated, queryKey: getGetInboxQueryKey(), refetchInterval: 12000 } });
  const chatsQuery = useGetChats({ query: { enabled: !!session?.authenticated, queryKey: getGetChatsQueryKey() } });
  const connectionQuery = useGetConnectionStatus({ query: { enabled: !!session?.authenticated || !!session?.pairingPending, queryKey: getGetConnectionStatusQueryKey(), refetchInterval: 2000 } });
  const itemList = useMemo(() => inboxQuery.data?.items ?? [], [inboxQuery.data]);
  const chats = useMemo(() => chatsQuery.data ?? [], [chatsQuery.data]);
  const currentId = selectedId || itemList[0]?.chatId || chats.find(chat => chat.selected)?.chatId || '';
  const contextQuery = useGetChatContext(currentId, { query: { enabled: !!session?.authenticated && chats.some(chat => chat.chatId === currentId && chat.selected), queryKey: getGetChatContextQueryKey(currentId) } });
  const selectChat = useUpdateChatSelection();
  const bulkSelect = useSelectInboxChats();
  const [selectionFeedback, setSelectionFeedback] = useState('');
  const setImportant = useUpdateChatPreferences();
  const review = useReviewChat();
  const connection = session?.authenticated || session?.pairingPending ? connectionQuery.data : undefined;
  const snapshot = inboxQuery.data;
  const authed = !!session?.authenticated;
  const refreshAll = useRef(() => {});
  refreshAll.current = () => {
    void queryClient.invalidateQueries({ queryKey: getGetInboxQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetChatsQueryKey() });
    if (currentId) void queryClient.invalidateQueries({ queryKey: getGetChatContextQueryKey(currentId) });
  };
  const [live, setLive] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  useEffect(() => {
    if (!authed || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events', { withCredentials: true });
    source.onopen = () => { setLive('live'); refreshAll.current(); };
    source.addEventListener('change', () => refreshAll.current());
    source.onerror = () => setLive('reconnecting');
    return () => source.close();
  }, [authed]);
  const invalidateChat = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: getGetChatsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetInboxQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetChatContextQueryKey(id) });
  };
  const rows: Row[] = useMemo(() => chats.map(chat => ({ chatId: chat.chatId, name: chat.displayName, isGroup: chat.isGroup, important: chat.important, reviewed: chat.reviewed, selected: chat.selected, item: itemList.find(i => i.chatId === chat.chatId) ?? null, latest: chat.latestActivity })), [chats, itemList]);
  const selectMany = (mode: 'all' | 'recent10') => {
    setSelectionFeedback('');
    bulkSelect.mutate({ data: { mode } }, {
      onSuccess: result => {
        setSelectionFeedback(result.added ? `Added ${result.added} ${result.added === 1 ? 'chat' : 'chats'} to your inbox.` : 'These chats are already in your inbox.');
        refreshAll.current();
      },
      onError: error => setSelectionFeedback(failure(error)),
    });
  };

  if (sessionQuery.isLoading) return <Frame><SkeletonList /></Frame>;
  if (sessionQuery.isError) return <Frame><Notice title="Could not check your session" detail={failure(sessionQuery.error)} action={<Btn kind="secondary" onClick={() => void sessionQuery.refetch()}><RefreshCw size={14} />Try again</Btn>} /></Frame>;
  if (!session?.liveEnabled) return <Frame><Notice title="WhatsApp connection is temporarily unavailable" detail={session?.configurationError || 'The server is not ready for pairing yet.'} action={<Link href="/demo">Open the demo</Link>} /></Frame>;
  if (!authed && !session?.pairingAllowed && !session?.pairingPending) return <Frame><Notice title="Use the browser you linked from" detail="This single-owner inbox is already linked or being paired in another browser. Return to that browser, or wait for an unfinished QR attempt to expire." action={<Link href="/demo">Open the demo</Link>} /></Frame>;

  const isConnected = authed && connection?.state === 'connected';
  const selectedChat = chats.find(chat => chat.chatId === currentId);
  const context = selectedChat?.selected ? contextQuery.data : undefined;
  const signOut = () => logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); void queryClient.invalidateQueries({ queryKey: getGetOwnerSessionQueryKey() }); } });
  const anyError = connect.isError || disconnect.isError || selectChat.isError || setImportant.isError || review.isError || logout.isError;
  const notices = <>
    {authed && <section aria-label="Choose inbox chats" className="rounded-xl border border-line bg-mint px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-[13px] font-semibold text-pine">Choose chats for your inbox</h2>
          <p className="mt-1 text-[12px] text-mute">Select all, or add the 10 most recently active chats. Existing selections stay included.</p></div>
        <div className="flex flex-wrap gap-2">
          <Btn className="min-h-9 px-3 text-[12px]" disabled={!chats.length || chatsQuery.isLoading || chatsQuery.isError || bulkSelect.isPending || selectChat.isPending} onClick={() => selectMany('all')} testId="button-select-all-chats">Select all chats</Btn>
          <Btn kind="secondary" className="min-h-9 px-3 text-[12px]" disabled={!chats.length || chatsQuery.isLoading || chatsQuery.isError || bulkSelect.isPending || selectChat.isPending} onClick={() => selectMany('recent10')} testId="button-select-recent-10">Select recent 10</Btn>
        </div>
      </div>
      <p role="status" className="mt-2 text-[12px] text-pine">{bulkSelect.isPending ? 'Selecting chats…' : selectionFeedback || (chats.length ? `${chats.filter(chat => chat.selected).length} of ${chats.length} available chats selected.` : 'Waiting for chats to sync from WhatsApp…')}</p>
      {chatsQuery.isError && <p role="alert" className="mt-2 text-[12px] text-coral">Chats could not load. <button onClick={() => void chatsQuery.refetch()} className="font-semibold underline">Try again</button></p>}
    </section>}
    {anyError && <Notice title="That action could not complete" detail={failure(connect.error ?? disconnect.error ?? selectChat.error ?? setImportant.error ?? review.error ?? logout.error)} action={<Link href="/demo" className="text-[12px] font-semibold text-pine">Open synthetic demo instead</Link>} />}
    {disconnect.data?.ownerInstruction && <Notice title="Remove the linked device on your phone" detail={disconnect.data.ownerInstruction} />}
    {healthQuery.isError && <Notice title="PILAH service is having trouble" detail="Some live inbox features may be unavailable until the service reconnects." action={<Btn kind="secondary" onClick={() => void healthQuery.refetch()}>Retry</Btn>} />}
    {connectionQuery.isError && <Notice title="Connection status unavailable" detail="Your inbox may be out of date. Try refreshing the connection status." action={<Btn kind="secondary" onClick={() => void connectionQuery.refetch()}>Retry</Btn>} />}
    {isConnected && snapshot?.coverage.partial && <div role="status" className="flex items-start gap-3 rounded-xl border border-[#ecd9a8] bg-[#fbf4df] px-4 py-2.5 text-[12px] leading-5 text-[#6d5413]"><Clock3 size={15} className="mt-0.5 shrink-0" /><span><strong className="font-semibold">Still catching up.</strong> This inbox is based on a partial sync. Some selected conversations may not appear yet.</span></div>}
    {isConnected && inboxQuery.isError && <Notice title="Inbox could not load" detail={failure(inboxQuery.error)} action={<Btn kind="secondary" onClick={() => void inboxQuery.refetch()}>Try again</Btn>} />}
    {isConnected && chatsQuery.isError && <Notice title="Chat list could not load" detail={failure(chatsQuery.error)} action={<Btn kind="secondary" onClick={() => void chatsQuery.refetch()}>Try again</Btn>} />}
  </>;

  if (!isConnected) return <Frame wide>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[.15em] text-pine">Live, your WhatsApp</p><h1 className="display mt-1 text-[32px] font-extrabold tracking-[-.04em]">Connect real WhatsApp</h1></div>
      <div className="flex gap-2"><Link href="/demo" className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-[13px] font-semibold hover:border-leaf" data-testid="link-try-demo"><FlaskConical size={14} />Synthetic demo</Link>{authed && <Btn kind="quiet" onClick={signOut} disabled={logout.isPending} testId="button-sign-out"><LogOut size={14} />Sign out</Btn>}</div></div>
    <p className="mb-5 text-[14px] text-mute">Your phone is your sign-in. Scan WhatsApp’s QR once—no password, no extra keys. Keep using this browser to access your inbox.</p>
    <div className="mb-4 space-y-2">{notices}</div>
    {session?.pairingPending && connectionQuery.isLoading ? <SkeletonList rows={3} /> : <ConnectionPanel status={connection ?? { state: 'disconnected', qrDataUrl: null, error: null, selectedChats: 0, availableChats: 0, analyzedMessages: 0 }} pending={connect.isPending || disconnect.isPending} onConnect={() => connect.mutate({ data: { noticeAccepted: true } }, { onSettled: () => { void queryClient.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetOwnerSessionQueryKey() }); } })} />}
  </Frame>;

  const liveText = live === 'live' ? 'updating live' : live === 'reconnecting' ? 'live updates paused, reconnecting' : 'connecting live updates';
  const footer = <div className="rounded-xl bg-white px-3 py-3 shadow-sm">
    <p className="flex items-center gap-2 text-[12px] font-semibold text-pine"><span className="relative flex h-2 w-2"><span className={`absolute inset-0 rounded-full ${live === 'live' ? 'ping-soft bg-leaf' : ''}`} /><span className={`relative h-2 w-2 rounded-full ${live === 'reconnecting' ? 'bg-sun' : 'bg-leaf'}`} /></span>WhatsApp connected</p>
    <p className="mt-1 text-[11px] leading-4 text-mute">{snapshot?.coverage.lastSyncAt ? `Last sync ${formatTime(snapshot.coverage.lastSyncAt)}` : 'Waiting for first sync'}. {snapshot?.coverage.analyzedMessages ?? connection.analyzedMessages} messages analyzed, {liveText}. {snapshot?.coverage.selectedChats ?? connection.selectedChats} of {snapshot?.coverage.availableChats ?? connection.availableChats} chats selected.</p>
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      <Btn kind="secondary" className="min-h-8 px-3 text-[12px]" onClick={() => void inboxQuery.refetch()} disabled={inboxQuery.isFetching}><RefreshCw size={12} className={inboxQuery.isFetching ? 'animate-spin' : ''} />Refresh</Btn>
      <Btn kind="secondary" className="min-h-8 px-3 text-[12px]" onClick={() => disconnect.mutate(undefined, { onSuccess: () => refreshAll.current() })} disabled={disconnect.isPending} testId="button-disconnect-live"><Unplug size={12} />Disconnect</Btn>
      <Btn kind="quiet" className="min-h-8 px-3 text-[12px]" onClick={signOut} disabled={logout.isPending} testId="button-sign-out"><LogOut size={12} />Sign out</Btn>
    </div></div>;
  const counts = snapshot?.counts ?? { now: 0, later: 0, low: 0 };
  return <Workspace rows={rows} counts={counts} selectedId={currentId} listLoading={inboxQuery.isLoading || chatsQuery.isLoading} now={Date.now()} notices={notices} sidebarFooter={footer}
    onSelect={id => { if (bulkSelect.isPending) return; setSelectedId(id); const chat = chats.find(c => c.chatId === id); if (chat && !chat.selected) selectChat.mutate({ chatId: id, data: { selected: true } }, { onSuccess: () => invalidateChat(id) }); }}
    onToggleSelect={row => { if (bulkSelect.isPending) return; selectChat.mutate({ chatId: row.chatId, data: { selected: !row.selected } }, { onSuccess: () => { queryClient.removeQueries({ queryKey: getGetChatContextQueryKey(row.chatId) }); void queryClient.invalidateQueries({ queryKey: getGetChatsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetInboxQueryKey() }); } }); }}
    ctx={context ?? null} ctxState={{ loading: !!currentId && contextQuery.isLoading, error: contextQuery.isError ? failure(contextQuery.error) : undefined, retry: () => void contextQuery.refetch() }}
    onReview={() => review.mutate({ chatId: currentId }, { onSuccess: () => invalidateChat(currentId) })} reviewPending={review.isPending}
    onImportant={() => context && setImportant.mutate({ chatId: currentId, data: { important: !context.chat.important } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetChatsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetInboxQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetChatContextQueryKey(currentId) }); } })} />;
}
