export interface SourceMessage {
  messageId: string;
  senderName: string;
  timestamp: string;
  text: string | null;
  fromOwner: boolean;
  unsupportedContent: boolean;
  edited: boolean;
  deleted: boolean;
  quotedMessageId: string | null;
  mentionedOwner?: boolean;
}

export interface ConversationInput {
  chatId: string;
  displayName: string;
  isGroup: boolean;
  important: boolean;
  messages: SourceMessage[];
  contextComplete: boolean;
  reviewedAt?: string | null;
}

export interface PriorityResult {
  chatId: string;
  displayName: string;
  isGroup: boolean;
  priority: "now" | "later" | "low";
  summary: string;
  reason: string;
  needsResponse: boolean | null;
  dueAt: string | null;
  evidenceMessageIds: string[];
  needsReview: boolean;
  source: "rules";
  reviewed: boolean;
  latestActivity: string | null;
}

const requestPattern = /\b(tolong|mohon|please|can you|could you|would you|need you|need your|butuh|ditunggu|waiting for you|waiting for your)\b|(?:^|[.!]\s+)\s*(?:@[\w]+\s+)?(?:approve|confirm|review|cek|check|send me|kirim|konfirmasi)\b|\byour (?:approval|confirmation) (?:is )?(?:needed|required)\b/i;
const resolvedPattern = /\b(approved|confirmed|sent|done|resolved|all set|udah beres|sudah beres|sudah dikirim|beres|disetujui|selesai)\b/i;
const waitingPattern = /\b(ditunggu|menunggu|waiting|awaiting|need your|butuh persetujuan|approval|approve)\b/i;
const casualPattern = /\b(meme|lol|haha|wkwk|joke|promo|discount|diskon|sale|voucher)\b/i;
const fyiPattern = /\b(fyi|for your information|info aja|fyi aja|no action|no reply|meeting notes|catatan rapat|notulen)\b/i;
const stopwords = new Set("tolong mohon please can could would you your the this that for with from approve approval approved confirm confirmed review check send need saya sudah udah beres done sent thank thanks terima kasih sebelum before hari today besok tomorrow jam minutes menit and dan".split(" "));
function topics(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 3 && !stopwords.has(t)) ?? [];
}
function excerpt(text: string, length = 125): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

/** Only precise deadlines are returned. Bare "jam 3" is deliberately ambiguous. */
export function parseDeadline(text: string, timestamp: string): string | null {
  const source = new Date(timestamp);
  if (!Number.isFinite(source.getTime())) return null;
  const relative = text.match(/\b(?:in|within|dalam)\s+(\d{1,3})\s*(minutes?|mins?|menit|hours?|jam)\b/i)
    ?? text.match(/\b(\d{1,3})\s*(minutes?|mins?|menit|hours?|jam)\s*(?:lagi|from now|away)\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    if (amount > 0 && amount <= 168) {
      const factor = /hour|jam/i.test(relative[2]!) ? 3_600_000 : 60_000;
      return new Date(source.getTime() + amount * factor).toISOString();
    }
  }
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/);
  if (iso && Number.isFinite(Date.parse(iso[0]))) return new Date(iso[0]).toISOString();
  const clock = text.match(/(?:before|by|sebelum|pukul|jam)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|pagi|siang|sore|malam)?\b/i);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  const period = clock[3]?.toLowerCase();
  // A 24-hour clock or explicit period is evidence; a bare 1-12 hour is not.
  if (!period && !clock[2] && hour <= 12) return null;
  if (hour > 23 || minute > 59) return null;
  if (period && hour > 12) return null;
  if (/pm|siang|sore|malam/.test(period ?? "") && hour < 12) hour += 12;
  if (/am|pagi/.test(period ?? "") && hour === 12) hour = 0;
  const jakarta = new Date(source.getTime() + 7 * 3_600_000);
  let due = Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate(), hour - 7, minute);
  if (/\b(besok|tomorrow)\b/i.test(text)) due += 86_400_000;
  return new Date(due).toISOString();
}

export function normalizeMessages(messages: SourceMessage[], now = Date.now()): SourceMessage[] {
  const unique = new Map<string, SourceMessage>();
  for (const message of messages) {
    const time = Date.parse(message.timestamp);
    if (!message.messageId || !Number.isFinite(time) || time < now - 7 * 86_400_000 || time > now + 60_000) continue;
    unique.set(message.messageId, {
      ...message,
      text: message.deleted ? null : message.text?.slice(0, 6000) ?? null,
    });
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-50);
}

export function rankConversation(input: ConversationInput, now = Date.now()): PriorityResult {
  const messages = normalizeMessages(input.messages, now);
  const requests: { message: SourceMessage; dueAt: string | null; directed: boolean; resolved: boolean }[] = [];
  let resolvedEvidence: string | null = null;
  for (const message of messages) {
    if (message.deleted || !message.text || message.unsupportedContent) continue;
    const text = message.text;
    const pending = requests.filter(r => !r.resolved);
    if (resolvedPattern.test(text) && (message.fromOwner || !requestPattern.test(text))) {
      let targets = pending.filter(r => r.message.messageId === message.quotedMessageId);
      if (!targets.length) {
        const responseTopics = topics(text);
        targets = pending.filter(r => topics(r.message.text!).some(t => responseTopics.includes(t)));
      }
      if (!targets.length && pending.length === 1 && !message.quotedMessageId) targets = pending;
      for (const target of targets) {
        target.resolved = true;
        resolvedEvidence = message.messageId;
      }
    }
    const explicitRequest = requestPattern.test(text);
    if (message.fromOwner || (fyiPattern.test(text) && !explicitRequest && !text.includes("?")) || (casualPattern.test(text) && !explicitRequest)) continue;
    const directed = !input.isGroup || !!message.mentionedOwner || /@(?:you|owner)\b/i.test(text)
      || messages.some(m => m.fromOwner && m.messageId === message.quotedMessageId);
    if (requestPattern.test(text) || text.includes("?")) {
      requests.push({ message, dueAt: parseDeadline(text, message.timestamp), directed, resolved: false });
    }
  }
  const unresolved = requests.filter(r => !r.resolved);
  const urgent = unresolved.filter(r => r.directed && (
    input.important || r.message.mentionedOwner || waitingPattern.test(r.message.text!)
    || (r.dueAt !== null && Date.parse(r.dueAt) <= now + 24 * 3_600_000)
  )).sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity));
  const unknown = messages.filter(m => m.unsupportedContent || m.deleted || (!m.text && !m.fromOwner));
  const ambiguous = unresolved.some(r => !r.directed);
  const ambiguousDeadline = unresolved.some(r => !r.dueAt && /\b(sebelum|before|deadline|due|jam)\b/i.test(r.message.text!));
  const needsReview = unknown.length > 0 || !input.contextComplete || ambiguous || ambiguousDeadline;
  const focus = urgent[0] ?? unresolved.find(r => r.directed) ?? unresolved[0];
  const latest = messages.at(-1);
  const usefulUpdate = !!latest?.text && fyiPattern.test(latest.text);
  let priority: PriorityResult["priority"] = urgent.length ? "now" : focus || needsReview || usefulUpdate ? "later" : "low";
  const evidence = focus ? [...unresolved.map(r => r.message.messageId), ...unknown.map(m => m.messageId)] : resolvedEvidence ? [resolvedEvidence, ...unknown.map(m => m.messageId)] : unknown.length ? unknown.map(m => m.messageId) : latest ? [latest.messageId] : [];
  const evidenceMessages = messages.filter(m => evidence.includes(m.messageId));
  const reviewed = !!input.reviewedAt && evidenceMessages.every(m => Date.parse(m.timestamp) <= Date.parse(input.reviewedAt!));
  let summary = focus ? excerpt(focus.message.text!) : latest?.text ? excerpt(latest.text) : "No supported text is available yet.";
  let reason = focus
    ? focus.directed
      ? `“${excerpt(focus.message.text!, 95)}” contains an unanswered ${focus.dueAt ? "request with an explicit deadline" : "request or question"}${input.important ? " from a chat you marked important" : ""}.`
      : "A request is visible in this group, but the available text does not clearly identify you as its recipient."
    : resolvedEvidence ? "The visible request has a relevant reply indicating it was resolved."
      : unknown.length ? "Some available content cannot be interpreted as text and needs your review."
        : !input.contextComplete ? "Only partial recent context is available; missing history is not evidence that nothing needs you."
          : usefulUpdate ? "The source message shares an informational update without a clear request requiring an immediate reply."
            : "The available messages contain no clear outstanding request for you.";
  if (!messages.length) {
    summary = "Waiting for supported recent messages.";
    reason = "No recent text is available for this selected chat; live messages can still arrive.";
    priority = "later";
  }
  return {
    chatId: input.chatId, displayName: input.displayName, isGroup: input.isGroup,
    priority, summary, reason, needsResponse: focus?.directed ? true : needsReview ? null : false,
    dueAt: focus?.dueAt ?? null, evidenceMessageIds: evidence, needsReview: needsReview || !messages.length,
    source: "rules", reviewed, latestActivity: latest?.timestamp ?? null,
  };
}