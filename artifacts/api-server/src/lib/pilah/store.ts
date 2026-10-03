import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, pilahAnalysis, pilahAuth, pilahChats, pilahMessages, pilahPreferences, pilahSessions, type PilahChat } from "@workspace/db";
import { normalizeMessages, rankConversation, type SourceMessage, type PriorityResult } from "@workspace/pilah-core";
import { contentHash, decrypt, encrypt } from "./crypto";
import { currentGeneration, guardedWrite, isErasing, serialWrite } from "./lifecycle";
import { notifyChange } from "./events";

export async function upsertChat(chatId: string, name: string | undefined, isGroup: boolean, epoch: number): Promise<void> {
  await guardedWrite(epoch, async () => {
    const [existing] = await db.select().from(pilahChats).where(eq(pilahChats.chatId, chatId));
    if (!existing) {
      await db.insert(pilahChats).values({ chatId, nameEncrypted: encrypt(name || chatId), isGroup }).onConflictDoNothing();
    } else if (name) {
      await db.update(pilahChats).set({ nameEncrypted: encrypt(name) }).where(eq(pilahChats.chatId, chatId));
    }
  });
}
export async function setHistoryCursor(chatId: string, messageId: string, fromOwner: boolean, timestamp: number, epoch: number): Promise<void> {
  await guardedWrite(epoch, async () => {
    const [chat] = await db.select().from(pilahChats).where(eq(pilahChats.chatId, chatId));
    if (!chat || (chat.historyTimestamp ?? 0) > timestamp) return;
    await db.update(pilahChats).set({ historyMessageId: messageId, historyFromOwner: fromOwner, historyTimestamp: timestamp, latestActivity: new Date(timestamp * 1000) }).where(eq(pilahChats.chatId, chatId));
  });
}
export async function selectedChatIds(): Promise<Set<string>> {
  const chats = await db.select({ id: pilahChats.chatId }).from(pilahChats).where(eq(pilahChats.selected, true));
  return new Set(chats.map(c => c.id));
}
export async function ingestMessages(chatId: string, incoming: SourceMessage[], epoch: number, edited = false): Promise<void> {
  await guardedWrite(epoch, async () => {
    await db.transaction(async tx => {
      const [chat] = await tx.select().from(pilahChats).where(eq(pilahChats.chatId, chatId));
      if (!chat?.selected || chat.disappearing) return;
      const messages = normalizeMessages(incoming);
      for (const message of messages) {
        const values = {
          chatId, messageId: message.messageId, senderEncrypted: encrypt(message.senderName),
          bodyEncrypted: message.text === null ? null : encrypt(message.text),
          timestamp: new Date(message.timestamp), fromOwner: message.fromOwner,
          unsupportedContent: message.unsupportedContent, mentionedOwner: !!message.mentionedOwner,
          edited: message.edited || edited, deleted: message.deleted, quotedMessageId: message.quotedMessageId,
        };
        if (edited) {
          await tx.insert(pilahMessages).values(values).onConflictDoUpdate({
            target: [pilahMessages.chatId, pilahMessages.messageId],
            set: { bodyEncrypted: values.bodyEncrypted, edited: true, unsupportedContent: values.unsupportedContent, deleted: values.deleted },
          });
        } else {
          await tx.insert(pilahMessages).values(values).onConflictDoNothing();
        }
      }
      const all = await tx.select({ id: pilahMessages.messageId }).from(pilahMessages).where(eq(pilahMessages.chatId, chatId)).orderBy(desc(pilahMessages.timestamp), desc(pilahMessages.messageId));
      const excess = all.slice(50).map(m => m.id);
      if (excess.length) await tx.delete(pilahMessages).where(and(eq(pilahMessages.chatId, chatId), inArray(pilahMessages.messageId, excess)));
      await tx.delete(pilahMessages).where(and(eq(pilahMessages.chatId, chatId), lt(pilahMessages.timestamp, new Date(Date.now() - 7 * 86_400_000))));
      await tx.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, chatId));
    });
  });
  notifyChange();
}
export async function deleteMessages(chatId: string, ids: string[] | null, epoch: number): Promise<void> {
  await guardedWrite(epoch, async () => {
    const where = ids ? and(eq(pilahMessages.chatId, chatId), inArray(pilahMessages.messageId, ids)) : eq(pilahMessages.chatId, chatId);
    await db.transaction(async tx => {
      await tx.delete(pilahMessages).where(where);
      await tx.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, chatId));
    });
  });
  notifyChange();
}
export async function mergeChatAlias(pn: string, lid: string, epoch: number): Promise<void> {
  if (pn === lid) return;
  await guardedWrite(epoch, async () => {
    await db.transaction(async tx => {
      const [old] = await tx.select().from(pilahChats).where(eq(pilahChats.chatId, pn));
      if (!old) return;
      const [canonical] = await tx.select().from(pilahChats).where(eq(pilahChats.chatId, lid));
      if (!canonical) await tx.insert(pilahChats).values({ ...old, chatId: lid });
      else await tx.update(pilahChats).set({ selected: old.selected || canonical.selected, important: old.important || canonical.important }).where(eq(pilahChats.chatId, lid));
      const rows = await tx.select().from(pilahMessages).where(eq(pilahMessages.chatId, pn));
      for (const row of rows) await tx.insert(pilahMessages).values({ ...row, chatId: lid }).onConflictDoNothing();
      await tx.delete(pilahChats).where(eq(pilahChats.chatId, pn));
      await tx.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, lid));
    });
  });
  notifyChange();
}
export async function pruneExpired(): Promise<void> {
  await serialWrite(async () => {
    const affected = await db.delete(pilahMessages).where(lt(pilahMessages.timestamp, new Date(Date.now() - 7 * 86_400_000))).returning({ chatId: pilahMessages.chatId });
    if (affected.length) await db.delete(pilahAnalysis).where(inArray(pilahAnalysis.chatId, affected.map(m => m.chatId)));
  });
}
export async function getMessages(chatId: string): Promise<SourceMessage[]> {
  const rows = await db.select().from(pilahMessages).where(and(eq(pilahMessages.chatId, chatId), lt(pilahMessages.timestamp, new Date(Date.now() + 60_000)))).orderBy(asc(pilahMessages.timestamp));
  return rows.filter(row => row.timestamp.getTime() >= Date.now() - 7 * 86_400_000).map(row => ({
    messageId: row.messageId, senderName: decrypt(row.senderEncrypted), timestamp: row.timestamp.toISOString(),
    text: row.bodyEncrypted === null ? null : decrypt(row.bodyEncrypted), fromOwner: row.fromOwner,
    unsupportedContent: row.unsupportedContent, edited: row.edited, deleted: row.deleted,
    quotedMessageId: row.quotedMessageId, mentionedOwner: row.mentionedOwner,
  }));
}
export async function analyzeChat(chat: PilahChat): Promise<PriorityResult | null> {
  const epoch = currentGeneration();
  const messages = await getMessages(chat.chatId);
  const input = { chatId: chat.chatId, displayName: decrypt(chat.nameEncrypted), isGroup: chat.isGroup, important: chat.important, messages, contextComplete: false, reviewedAt: chat.reviewedAt?.toISOString() ?? null };
  const minute = Math.floor(Date.now() / 60_000);
  const hash = contentHash({ ...input, minute });
  const [cached] = await db.select().from(pilahAnalysis).where(eq(pilahAnalysis.chatId, chat.chatId));
  const result = cached?.contentHash === hash ? JSON.parse(decrypt(cached.valueEncrypted)) as PriorityResult : rankConversation(input);
  const valid = await guardedWrite(epoch, async () => {
    // Recheck the selected chat after an asynchronous read, before persisting a result.
    const [current] = await db.select().from(pilahChats).where(eq(pilahChats.chatId, chat.chatId));
    if (!current?.selected || current.reviewedAt?.getTime() !== chat.reviewedAt?.getTime() || current.important !== chat.important) return false;
    const latest = await getMessages(chat.chatId);
    if (contentHash({ ...input, messages: latest, minute }) !== hash) return false;
    if (cached?.contentHash === hash) return true;
    await db.insert(pilahAnalysis).values({ chatId: chat.chatId, contentHash: hash, valueEncrypted: encrypt(JSON.stringify(result)) }).onConflictDoUpdate({
      target: pilahAnalysis.chatId, set: { contentHash: hash, valueEncrypted: encrypt(JSON.stringify(result)) },
    });
    return true;
  });
  return valid ? result : null;
}
export async function chatView(chat: PilahChat) {
  const messages = await getMessages(chat.chatId);
  const item = chat.selected ? rankConversation({ chatId: chat.chatId, displayName: decrypt(chat.nameEncrypted), isGroup: chat.isGroup, important: chat.important, reviewedAt: chat.reviewedAt?.toISOString(), messages, contextComplete: false }) : null;
  return { chatId: chat.chatId, displayName: decrypt(chat.nameEncrypted), isGroup: chat.isGroup, selected: chat.selected, important: chat.important, reviewed: item?.reviewed ?? false, latestActivity: chat.latestActivity?.toISOString() ?? messages.at(-1)?.timestamp ?? null, retainedMessageCount: messages.length };
}
export async function listChats() {
  await pruneExpired();
  const chats = await db.select().from(pilahChats).orderBy(desc(pilahChats.latestActivity)).limit(2000);
  return Promise.all(chats.map(chatView));
}
export async function getInbox() {
  await pruneExpired();
  const all = await db.select().from(pilahChats);
  const selected = all.filter(c => c.selected);
  const items = [];
  for (const chat of selected) {
    const item = await analyzeChat(chat);
    if (item) items.push(item);
  }
  return {
    items, counts: { now: items.filter(i => i.priority === "now").length, later: items.filter(i => i.priority === "later").length, low: items.filter(i => i.priority === "low").length },
    coverage: { availableChats: all.length, selectedChats: selected.length, analyzedMessages: (await db.select().from(pilahMessages)).length, lastSyncAt: null as string | null, partial: true },
  };
}
export async function setSelection(chatId: string, selected: boolean) {
  return serialWrite(async () => db.transaction(async tx => {
    const [chat] = await tx.update(pilahChats).set({ selected, reviewedAt: null }).where(eq(pilahChats.chatId, chatId)).returning();
    if (!chat) return null;
    await tx.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, chatId));
    if (!selected) await tx.delete(pilahMessages).where(eq(pilahMessages.chatId, chatId));
    return chat;
  }));
}
export async function selectInboxChats(mode: "all" | "recent10") {
  const epoch = currentGeneration();
  return guardedWrite(epoch, async () => {
    if (isErasing()) return undefined;
    return db.transaction(async tx => {
      const recent = mode === "recent10" ? await tx.select({ id: pilahChats.chatId }).from(pilahChats)
        .orderBy(sql`${pilahChats.latestActivity} DESC NULLS LAST`, asc(pilahChats.chatId)).limit(10) : null;
      if (recent && !recent.length) return [];
      const changed = await tx.update(pilahChats).set({ selected: true, reviewedAt: null })
        .where(recent ? and(eq(pilahChats.selected, false), inArray(pilahChats.chatId, recent.map(c => c.id))) : eq(pilahChats.selected, false))
        .returning({ id: pilahChats.chatId });
      const ids = changed.map(c => c.id);
      if (ids.length) await tx.delete(pilahAnalysis).where(inArray(pilahAnalysis.chatId, ids));
      return ids;
    });
  });
}
export async function setImportant(chatId: string, important: boolean) {
  return serialWrite(async () => {
    const [chat] = await db.update(pilahChats).set({ important }).where(eq(pilahChats.chatId, chatId)).returning();
    await db.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, chatId));
    return chat ?? null;
  });
}
export async function markReviewed(chatId: string) {
  return serialWrite(async () => {
    const [chat] = await db.update(pilahChats).set({ reviewedAt: new Date() }).where(eq(pilahChats.chatId, chatId)).returning();
    await db.delete(pilahAnalysis).where(eq(pilahAnalysis.chatId, chatId));
    return chat ?? null;
  });
}
export async function eraseAllData(): Promise<void> {
  await serialWrite(async () => db.transaction(async tx => {
    await tx.delete(pilahChats);
    await tx.delete(pilahAuth);
    await tx.delete(pilahPreferences);
    await tx.delete(pilahSessions);
  }));
  notifyChange();
}