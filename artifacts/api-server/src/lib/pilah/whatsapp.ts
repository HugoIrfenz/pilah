import makeWASocket, { BufferJSON, Browsers, DisconnectReason, jidNormalizedUser, normalizeMessageContent, proto, type WASocket, type WAMessage } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { eq } from "drizzle-orm";
import { db, pool, pilahAuth, pilahChats, pilahMessages, pilahAnalysis, type PoolClient } from "@workspace/db";
import type { SourceMessage } from "@workspace/pilah-core";
import { databaseAuthState } from "./auth-store";
import { authKeyHash, decrypt, liveConfigured } from "./crypto";
import { currentGeneration, guardedWrite, invalidateWork, isErasing, serialWrite } from "./lifecycle";
import { notifyChange } from "./events";
import { deleteMessages, ingestMessages, mergeChatAlias, selectedChatIds, setHistoryCursor, upsertChat } from "./store";
import { logger } from "../logger";
import { authorizeLinkedPhone, pendingPairingKey } from "../../middlewares/owner-auth";

type State = "disconnected" | "connecting" | "awaiting_scan" | "syncing" | "connected" | "reconnecting" | "error";
const LOCK = 746_192_503;
let socket: WASocket | null = null;
let lease: PoolClient | null = null;
let stopped = true;
let starting: Promise<void> | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let qrTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
const status: { state: State; qrDataUrl: string | null; lastSyncAt: string | null; error: string | null } = { state: "disconnected", qrDataUrl: null, lastSyncAt: null, error: null };

export function runtimeAllowed(): boolean {
  const runtime = process.env.NODE_ENV === "production" ? "production" : "development";
  return (process.env.PILAH_LIVE_RUNTIME ?? "development") === runtime;
}
export function connectionSnapshot() { return { ...status }; }
function setState(state: State, error: string | null = null): void {
  status.state = state;
  status.error = error;
  if (state !== "awaiting_scan") status.qrDataUrl = null;
  notifyChange();
}
function safeTask(epoch: number, task: () => Promise<void>): void {
  if (stopped || epoch !== currentGeneration()) return;
  void task().catch(() => {
    // Do not log WhatsApp objects, keys, bodies, identifiers, QR data, or raw errors.
    logger.warn({ subsystem: "whatsapp" }, "A WhatsApp update could not be processed.");
    status.error = "A WhatsApp update could not be processed. Coverage may be incomplete.";
    notifyChange();
  });
}
async function canonicalJid(jid: string, alternate?: string | null): Promise<string> {
  const normal = jidNormalizedUser(jid);
  const alt = alternate ? jidNormalizedUser(alternate) : null;
  if (normal.endsWith("@lid")) return normal;
  if (alt?.endsWith("@lid")) return alt;
  if (normal.endsWith("@s.whatsapp.net") && socket) {
    const lid = await socket.signalRepository.lidMapping.getLIDForPN(normal);
    if (lid) return jidNormalizedUser(lid);
  }
  return normal;
}
function eligible(jid: string): boolean {
  return jid.endsWith("@g.us") || jid.endsWith("@lid") || jid.endsWith("@s.whatsapp.net");
}
function excludedContent(message: proto.IMessage | null | undefined): boolean {
  if (!message) return false;
  if (message.ephemeralMessage || message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return true;
  if (message.extendedTextMessage?.contextInfo?.expiration) return true;
  return message.deviceSentMessage?.message ? excludedContent(message.deviceSentMessage.message) : false;
}
async function normalizeIncoming(raw: WAMessage, chatId: string): Promise<SourceMessage | null> {
  const timestamp = Number(raw.messageTimestamp ?? 0);
  if (!raw.key.id || !timestamp || timestamp * 1000 < Date.now() - 7 * 86_400_000 || excludedContent(raw.message)) return null;
  const content = normalizeMessageContent(raw.message);
  if (!content || content.protocolMessage || raw.messageStubType) return null;
  const text = content.conversation ?? content.extendedTextMessage?.text ?? null;
  const info = content.extendedTextMessage?.contextInfo;
  const ownerIds = [socket?.user?.id, socket?.user?.lid].filter((id): id is string => !!id);
  const owners = new Set(await Promise.all(ownerIds.map(id => canonicalJid(id))));
  const mentioned = await Promise.all((info?.mentionedJid ?? []).map(id => canonicalJid(id)));
  return {
    messageId: raw.key.id,
    senderName: raw.key.fromMe ? "You" : raw.pushName || (raw.key.participant ? jidNormalizedUser(raw.key.participant) : chatId),
    timestamp: new Date(timestamp * 1000).toISOString(), text,
    fromOwner: !!raw.key.fromMe, unsupportedContent: text === null,
    mentionedOwner: mentioned.some(id => owners.has(id)), edited: false, deleted: false,
    quotedMessageId: info?.stanzaId ?? null,
  };
}
async function handleMessages(messages: WAMessage[], epoch: number): Promise<void> {
  // Selection is checked before inspecting message bodies, and again inside the write transaction.
  const selected = await selectedChatIds();
  const byChat = new Map<string, SourceMessage[]>();
  for (const raw of messages) {
    if (stopped || epoch !== currentGeneration()) return;
    const jid = raw.key.remoteJid;
    if (!jid) continue;
    const chatId = await canonicalJid(jid, raw.key.remoteJidAlt);
    if (!eligible(chatId)) continue;
    await upsertChat(chatId, chatId.endsWith("@g.us") || raw.key.fromMe ? undefined : raw.pushName || undefined, chatId.endsWith("@g.us"), epoch);
    if (raw.key.id && Number(raw.messageTimestamp ?? 0)) await setHistoryCursor(chatId, raw.key.id, !!raw.key.fromMe, Number(raw.messageTimestamp), epoch);
    if (!selected.has(chatId)) continue;
    const [chat] = await db.select({ disappearing: pilahChats.disappearing }).from(pilahChats).where(eq(pilahChats.chatId, chatId));
    if (chat?.disappearing || excludedContent(raw.message)) continue;
    const protocol = raw.message?.protocolMessage;
    if (protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE && protocol.key?.id) {
      await deleteMessages(chatId, [protocol.key.id], epoch);
      continue;
    }
    if (protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.key?.id && protocol.editedMessage) {
      const [existing] = await db.select().from(pilahMessages).where(eq(pilahMessages.messageId, protocol.key.id));
      if (existing?.chatId === chatId) {
        const editedRaw = { ...raw, key: { ...raw.key, id: protocol.key.id, fromMe: existing.fromOwner }, message: protocol.editedMessage, messageTimestamp: Math.floor(existing.timestamp.getTime() / 1000) } as WAMessage;
        const normalized = await normalizeIncoming(editedRaw, chatId);
        if (normalized) await ingestMessages(chatId, [{ ...normalized, edited: true }], epoch, true);
      }
      continue;
    }
    const normalized = await normalizeIncoming(raw, chatId);
    if (!normalized) continue;
    const batch = byChat.get(chatId) ?? [];
    batch.push(normalized);
    byChat.set(chatId, batch);
  }
  for (const [chatId, batch] of byChat) await ingestMessages(chatId, batch, epoch);
  status.lastSyncAt = new Date().toISOString();
  notifyChange();
}
async function acquireLease(): Promise<void> {
  if (lease) return;
  const client = await pool.connect();
  const result = await client.query<{ acquired: boolean }>(`SELECT pg_try_advisory_lock(${LOCK}) AS acquired`);
  if (!result.rows[0]?.acquired) {
    client.release();
    throw new Error("This account is already connected by another PILAH process. Stop it before connecting here.");
  }
  lease = client;
  client.on("error", () => {
    if (lease !== client || stopped) return;
    invalidateWork();
    stopped = true;
    socket?.end(new Error("Connection ownership was lost."));
    socket = null;
    setState("error", "Connection ownership was lost. Reconnect only after the other runtime has stopped.");
  });
  heartbeat = setInterval(() => {
    void lease?.query("SELECT 1").catch(() => {
      if (lease !== client || stopped) return;
      invalidateWork();
      stopped = true;
      socket?.end(new Error("Connection ownership was lost."));
      socket = null;
      setState("error", "Connection ownership was lost.");
    });
  }, 15_000);
  heartbeat.unref();
}
async function releaseLease(): Promise<void> {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  const client = lease;
  lease = null;
  if (!client) return;
  await client.query(`SELECT pg_advisory_unlock(${LOCK})`).catch(() => undefined);
  client.release();
}
async function startSocket(): Promise<void> {
  const epoch = currentGeneration();
  const auth = await databaseAuthState();
  if (stopped || epoch !== currentGeneration()) return;
  const restoring = !!auth.state.creds.registered;
  const pendingKey = await pendingPairingKey();
  let verified = false;
  let verification: Promise<boolean> | null = null;
  const ownedTask = (task: () => Promise<void>) => safeTask(epoch, async () => {
    if (verification) await verification;
    if (!verified || socket !== sock) return;
    await task();
  });
  // Baileys' internal logger can contain private message/key objects; intentionally silent.
  const sock = makeWASocket({
    auth: auth.state, logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("PILAH"), markOnlineOnConnect: false,
    syncFullHistory: false, shouldSyncHistoryMessage: () => true,
    getMessage: async () => undefined,
  });
  socket = sock;
  sock.ev.on("creds.update", () => safeTask(epoch, auth.saveCreds));
  sock.ev.on("connection.update", update => safeTask(epoch, async () => {
    if (socket !== sock) return;
    if (update.qr) {
      const data = await QRCode.toDataURL(update.qr, { margin: 2, width: 280 });
      if (stopped || epoch !== currentGeneration() || socket !== sock) return;
      setState("awaiting_scan");
      status.qrDataUrl = data;
      if (qrTimer) clearTimeout(qrTimer);
      qrTimer = setTimeout(() => {
        status.qrDataUrl = null;
        if (status.state === "awaiting_scan") status.error = "QR expired. Wait for a refreshed QR or reconnect.";
        notifyChange();
      }, 45_000);
      qrTimer.unref();
      notifyChange();
    }
    if (update.connection === "open") {
      const accountId = sock.user?.id ? jidNormalizedUser(sock.user.id) : "";
      verification = authorizeLinkedPhone(accountId, pendingKey, epoch, restoring).catch(() => false);
      verified = await verification;
      if (stopped || socket !== sock || epoch !== currentGeneration()) return;
      if (!verified) {
        await disconnectWhatsApp();
        setState("error", "Pairing could not be verified. Retry with the WhatsApp account originally linked here.");
        return;
      }
      reconnectAttempts = 0;
      setState("syncing");
      const settle = setTimeout(() => {
        if (!stopped && socket === sock && epoch === currentGeneration() && status.state === "syncing") setState("connected");
      }, 15_000);
      settle.unref();
    }
    if (verified && update.receivedPendingNotifications && (status.state === "syncing" || status.state === "connected")) setState("connected");
    if (update.connection !== "close") return;
    socket = null;
    const error = update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
    const code = error?.output?.statusCode;
    if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
      stopped = true;
      invalidateWork();
      await serialWrite(async () => { await db.delete(pilahAuth); });
      await releaseLease();
      setState("disconnected", "The linked session ended. Remove any remaining PILAH device in WhatsApp, then link again.");
      return;
    }
    if (code === DisconnectReason.connectionReplaced) {
      stopped = true;
      invalidateWork();
      await releaseLease();
      setState("error", "Another connection replaced this session. Stop the other runtime before reconnecting.");
      return;
    }
    if (code !== DisconnectReason.restartRequired) reconnectAttempts += 1;
    if (reconnectAttempts > 5) {
      stopped = true;
      await releaseLease();
      setState("error", "Reconnect attempts stopped after five failures. Try reconnecting manually.");
      return;
    }
    setState("reconnecting");
    const delay = code === DisconnectReason.restartRequired ? 1000 : Math.min(30_000, 1000 * 2 ** reconnectAttempts);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped && epoch === currentGeneration()) void startSocket().catch(async () => {
        stopped = true;
        await releaseLease();
        setState("error", "The connection could not restart. Try reconnecting manually.");
      });
    }, delay);
    reconnectTimer.unref();
  }));
  sock.ev.on("messaging-history.set", data => ownedTask(async () => {
    for (const mapping of data.lidPnMappings ?? []) await mergeChatAlias(jidNormalizedUser(mapping.pn), jidNormalizedUser(mapping.lid), epoch);
    for (const chat of data.chats) {
      if (!chat.id) continue;
      const chatId = await canonicalJid(chat.id);
      if (eligible(chatId)) await upsertChat(chatId, chat.name || undefined, chatId.endsWith("@g.us"), epoch);
      if (eligible(chatId) && chat.ephemeralExpiration) await excludeDisappearing(chatId, true, epoch);
    }
    for (const contact of data.contacts) {
      const chatId = await canonicalJid(contact.id, contact.lid);
      if (eligible(chatId)) await upsertChat(chatId, contact.name || contact.notify || undefined, false, epoch);
    }
    await handleMessages(data.messages, epoch);
    if (data.isLatest) setState("connected");
  }));
  sock.ev.on("chats.upsert", chats => ownedTask(async () => {
    for (const chat of chats) {
      if (!chat.id) continue;
      const chatId = await canonicalJid(chat.id);
      if (!eligible(chatId)) continue;
      await upsertChat(chatId, chat.name || undefined, chatId.endsWith("@g.us"), epoch);
      if (chat.ephemeralExpiration) await excludeDisappearing(chatId, true, epoch);
    }
    notifyChange();
  }));
  sock.ev.on("chats.update", chats => ownedTask(async () => {
    for (const chat of chats) {
      if (!chat.id) continue;
      const chatId = await canonicalJid(chat.id);
      if (!eligible(chatId)) continue;
      await upsertChat(chatId, chat.name || undefined, chatId.endsWith("@g.us"), epoch);
      if (chat.ephemeralExpiration !== undefined) await excludeDisappearing(chatId, !!chat.ephemeralExpiration, epoch);
    }
    notifyChange();
  }));
  sock.ev.on("contacts.upsert", contacts => ownedTask(async () => {
    for (const contact of contacts) {
      const chatId = await canonicalJid(contact.id, contact.lid);
      if (eligible(chatId)) await upsertChat(chatId, contact.name || contact.notify || undefined, false, epoch);
    }
    notifyChange();
  }));
  sock.ev.on("contacts.update", contacts => ownedTask(async () => {
    for (const contact of contacts) {
      if (!contact.id) continue;
      const chatId = await canonicalJid(contact.id, contact.lid);
      if (eligible(chatId)) await upsertChat(chatId, contact.name || contact.notify || undefined, chatId.endsWith("@g.us"), epoch);
    }
    notifyChange();
  }));
  sock.ev.on("groups.update", groups => ownedTask(async () => {
    for (const group of groups) if (group.id && group.subject) await upsertChat(group.id, group.subject, true, epoch);
    notifyChange();
  }));
  sock.ev.on("lid-mapping.update", mapping => ownedTask(() => mergeChatAlias(jidNormalizedUser(mapping.pn), jidNormalizedUser(mapping.lid), epoch)));
  sock.ev.on("messages.upsert", batch => ownedTask(() => handleMessages(batch.messages, epoch)));
  sock.ev.on("messages.delete", event => ownedTask(async () => {
    if ("keys" in event) {
      for (const key of event.keys) if (key.remoteJid && key.id) await deleteMessages(await canonicalJid(key.remoteJid, key.remoteJidAlt), [key.id], epoch);
    } else await deleteMessages(await canonicalJid(event.jid), null, epoch);
  }));
  sock.ev.on("messages.update", updates => ownedTask(async () => {
    for (const { key, update } of updates) {
      if (!key.remoteJid || !key.id) continue;
      const chatId = await canonicalJid(key.remoteJid, key.remoteJidAlt);
      if (update.message === null) { await deleteMessages(chatId, [key.id], epoch); continue; }
      if (!update.message) continue;
      const [existing] = await db.select().from(pilahMessages).where(eq(pilahMessages.messageId, key.id));
      if (existing?.chatId !== chatId) continue;
      const raw = { key: { ...key, fromMe: existing.fromOwner }, message: update.message, messageTimestamp: Math.floor(existing.timestamp.getTime() / 1000) } as WAMessage;
      const normalized = await normalizeIncoming(raw, chatId);
      if (normalized) await ingestMessages(chatId, [{ ...normalized, edited: true }], epoch, true);
    }
  }));
}
async function excludeDisappearing(chatId: string, disappearing: boolean, epoch: number): Promise<void> {
  await guardedWrite(epoch, async () => db.transaction(async tx => {
    await tx.update(pilahChats).set({ disappearing }).where(eq(pilahChats.chatId, chatId));
    if (disappearing) {
      await tx.delete(pilahMessages).where(eq(pilahMessages.chatId, chatId));
      await tx.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, chatId));
    }
  }));
}
export async function connectWhatsApp(): Promise<void> {
  if (!liveConfigured() || !runtimeAllowed()) throw new Error("Live mode is not enabled for this runtime.");
  if (isErasing()) throw new Error("Data deletion is in progress.");
  if (starting) return starting;
  if (!stopped) return;
  const epoch = currentGeneration();
  starting = (async () => {
    await acquireLease();
    if (epoch !== currentGeneration() || isErasing()) { await releaseLease(); return; }
    stopped = false;
    reconnectAttempts = 0;
    setState("connecting");
    try { await startSocket(); }
    catch {
      stopped = true;
      await releaseLease();
      setState("error", "The WhatsApp connection could not start. Check the runtime configuration and reconnect.");
      throw new Error("The WhatsApp connection could not start.");
    }
  })().finally(() => { starting = null; });
  return starting;
}
export async function requestSelectedHistory(chatId: string): Promise<void> {
  const sock = socket;
  if (!sock || stopped || !["connected", "syncing"].includes(status.state)) return;
  const [chat] = await db.select().from(pilahChats).where(eq(pilahChats.chatId, chatId));
  if (!chat?.selected || !chat.historyMessageId || !chat.historyTimestamp || chat.disappearing) return;
  try {
    await sock.fetchMessageHistory(50, { remoteJid: chatId, id: chat.historyMessageId, fromMe: chat.historyFromOwner }, chat.historyTimestamp);
  } catch {
    status.error = "Recent history was unavailable. New selected-chat messages can still arrive; coverage is partial.";
    notifyChange();
  }
}
export async function disconnectWhatsApp(remoteLogout = true) {
  stopped = true;
  if (remoteLogout) invalidateWork();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (qrTimer) clearTimeout(qrTimer);
  reconnectTimer = null;
  qrTimer = null;
  status.qrDataUrl = null;
  const sock = socket;
  socket = null;
  let remoteLogoutSucceeded = false;
  if (sock && remoteLogout) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([sock.logout(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Logout timed out.")), 5000); })]);
      remoteLogoutSucceeded = true;
    } catch { /* Local disconnection still completes; require manual unlinking. */ }
    finally { if (timeout) clearTimeout(timeout); }
  }
  sock?.end(new Error("PILAH connection stopped."));
  if (!remoteLogout) {
    // Persist queued Signal key updates before a graceful restart, then reject late handlers.
    await serialWrite(async () => undefined);
    invalidateWork();
  }
  if (remoteLogout) await serialWrite(async () => { await db.delete(pilahAuth); });
  await releaseLease();
  setState("disconnected");
  return {
    state: "disconnected" as const, remoteLogoutSucceeded,
    ownerInstruction: remoteLogoutSucceeded ? null : "Open WhatsApp → Settings → Linked devices and remove PILAH manually. PILAH cannot confirm remote unlinking.",
  };
}
export async function bindStoredOwner(): Promise<boolean> {
  if (!liveConfigured() || isErasing()) throw new Error("Live pairing is currently unavailable.");
  const epoch = currentGeneration();
  const [stored] = await db.select().from(pilahAuth).where(eq(pilahAuth.keyHash, authKeyHash("creds")));
  if (!stored) return false;
  const creds = JSON.parse(decrypt(stored.valueEncrypted), BufferJSON.reviver) as { registered?: boolean; me?: { id?: string } };
  if (!creds.registered) return false;
  if (!creds.me?.id || !(await authorizeLinkedPhone(jidNormalizedUser(creds.me.id), null, epoch, true))) {
    throw new Error("The stored phone identity could not be verified.");
  }
  return true;
}
export async function resumeStoredConnection(): Promise<void> {
  if (!liveConfigured() || !runtimeAllowed()) return;
  if (!(await bindStoredOwner())) return;
  try { await connectWhatsApp(); }
  catch { logger.warn({ subsystem: "whatsapp" }, "Stored WhatsApp connection was not resumed."); }
}