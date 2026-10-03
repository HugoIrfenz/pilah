import { pgTable, text, boolean, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const pilahChats = pgTable("pilah_chats", {
  chatId: text("chat_id").primaryKey(),
  nameEncrypted: text("name_encrypted").notNull(),
  isGroup: boolean("is_group").notNull().default(false),
  selected: boolean("selected").notNull().default(false),
  important: boolean("important").notNull().default(false),
  disappearing: boolean("disappearing").notNull().default(false),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  latestActivity: timestamp("latest_activity", { withTimezone: true }),
  historyMessageId: text("history_message_id"),
  historyFromOwner: boolean("history_from_owner").notNull().default(false),
  historyTimestamp: integer("history_timestamp"),
});
export const pilahMessages = pgTable("pilah_messages", {
  chatId: text("chat_id").notNull().references(() => pilahChats.chatId, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  senderEncrypted: text("sender_encrypted").notNull(),
  bodyEncrypted: text("body_encrypted"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  fromOwner: boolean("from_owner").notNull(),
  unsupportedContent: boolean("unsupported_content").notNull().default(false),
  mentionedOwner: boolean("mentioned_owner").notNull().default(false),
  edited: boolean("edited").notNull().default(false),
  deleted: boolean("deleted").notNull().default(false),
  quotedMessageId: text("quoted_message_id"),
}, t => [primaryKey({ columns: [t.chatId, t.messageId] })]);
export const pilahAuth = pgTable("pilah_auth", {
  keyHash: text("key_hash").primaryKey(),
  valueEncrypted: text("value_encrypted").notNull(),
});
export const pilahAnalysis = pgTable("pilah_analysis", {
  chatId: text("chat_id").primaryKey().references(() => pilahChats.chatId, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  valueEncrypted: text("value_encrypted").notNull(),
});
export const pilahSessions = pgTable("pilah_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  purpose: text("purpose").$type<"owner" | "pairing">().notNull().default("owner"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const pilahPreferences = pgTable("pilah_preferences", {
  id: text("id").primaryKey(),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  aiProvider: text("ai_provider"),
  ownerAccountHash: text("owner_account_hash"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertPilahChatSchema = createInsertSchema(pilahChats);
export const insertPilahMessageSchema = createInsertSchema(pilahMessages);
export type PilahChat = typeof pilahChats.$inferSelect;
export type PilahMessage = typeof pilahMessages.$inferSelect;