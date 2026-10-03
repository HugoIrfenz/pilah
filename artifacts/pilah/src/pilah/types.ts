import type { Chat, ConversationMessage, InboxItem } from '@workspace/api-client-react';

export type Row = { chatId: string; name: string; isGroup: boolean; important: boolean; reviewed: boolean; selected: boolean; item: InboxItem | null; latest: string | null };
export type Ctx = { chat: Chat; item: InboxItem | null; messages: ConversationMessage[]; contextComplete: boolean };
export type CtxState = { loading: boolean; error?: string; retry?: () => void };
export type View = 'chats' | 'priority' | 'important';
export type Filter = 'all' | 'now' | 'later' | 'low';
