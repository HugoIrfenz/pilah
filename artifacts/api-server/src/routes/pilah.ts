import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pilahChats, pilahPreferences } from "@workspace/db";
import {
  GetOwnerSessionResponse, GetInboxResponse, GetChatsResponse,
  UpdateChatSelectionBody, SelectInboxChatsBody, SelectInboxChatsResponse, UpdateChatPreferencesBody, GetChatContextResponse,
  ConnectWhatsAppBody, GetConnectionStatusResponse, UpdateAiConsentBody, DeleteOwnerDataBody,
} from "@workspace/api-zod";
import { allowLogin, beginPairing, isOwner, isPairing, pairingState, PairingError, requireOwner, requireSameOrigin, revokeOwnerSession } from "../middlewares/owner-auth";
import { configurationError, liveConfigured } from "../lib/pilah/crypto";
import { analyzeChat, chatView, eraseAllData, getInbox, getMessages, listChats, markReviewed, selectInboxChats, setImportant, setSelection } from "../lib/pilah/store";
import { bindStoredOwner, connectionSnapshot, connectWhatsApp, disconnectWhatsApp, requestSelectedHistory, runtimeAllowed } from "../lib/pilah/whatsapp";
import { inboxEvents, notifyChange } from "../lib/pilah/events";
import { beginErasure, endErasure, isErasing, serialWrite } from "../lib/pilah/lifecycle";

const router: IRouter = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.use(requireSameOrigin);

router.get("/owner/session", async (req, res) => {
  res.json(GetOwnerSessionResponse.parse({ ...await pairingState(req), liveEnabled: liveConfigured(), configurationError: configurationError() }));
});
router.post("/owner/login", (_req, res) => {
  res.status(410).json({ error: "Passwords are no longer used. Open Connect WhatsApp and scan the QR." });
});
router.post("/owner/logout", async (req, res) => {
  await revokeOwnerSession(req, res);
  res.json({ ...await pairingState(req), liveEnabled: liveConfigured(), configurationError: configurationError() });
});

async function browserConnection(req: import("express").Request) {
  if (await isOwner(req)) return statusWithCoverage();
  return GetConnectionStatusResponse.parse({ ...connectionSnapshot(), availableChats: 0, selectedChats: 0, analyzedMessages: 0 });
}
router.get("/connection", async (req, res) => {
  if (!(await isOwner(req)) && !(await isPairing(req))) { res.status(401).json({ error: "Start QR pairing in this browser first." }); return; }
  res.json(await browserConnection(req));
});
router.post("/connection/connect", async (req, res) => {
  const input = ConnectWhatsAppBody.safeParse(req.body);
  if (!input.success || !input.data.noticeAccepted) { res.status(400).json({ error: "Accept the linked-device notice before connecting." }); return; }
  if (!runtimeAllowed()) { res.status(503).json({ error: "WhatsApp pairing is enabled on the other app runtime. Use the active runtime to scan your phone." }); return; }
  if (!allowLogin(req)) { res.setHeader("Retry-After", "900"); res.status(429).json({ error: "Too many pairing attempts. Try again in 15 minutes." }); return; }
  try {
    // Preserve the original account identity before replacing any legacy device credentials.
    await bindStoredOwner();
    const fresh = await beginPairing(req, res);
    if (fresh && connectionSnapshot().state !== "disconnected") await disconnectWhatsApp();
    await connectWhatsApp();
  } catch (error) {
    res.status(error instanceof PairingError ? 409 : 503).json({ error: error instanceof PairingError ? error.message : "The WhatsApp connection could not start. Please retry." }); return;
  }
  res.json(await browserConnection(req));
});
router.post("/connection/disconnect", async (req, res) => {
  const owner = await isOwner(req);
  if (!owner && !(await isPairing(req))) { res.status(401).json({ error: "This browser does not own the connection." }); return; }
  const result = await disconnectWhatsApp();
  if (!owner) await revokeOwnerSession(req, res);
  res.json(result);
});
router.use(requireOwner);

router.get("/inbox", async (_req, res) => {
  const snapshot = await getInbox();
  snapshot.coverage.lastSyncAt = connectionSnapshot().lastSyncAt;
  res.json(GetInboxResponse.parse(snapshot));
});
router.get("/chats", async (_req, res) => { res.json(GetChatsResponse.parse(await listChats())); });
router.post("/chats/selection", async (req, res) => {
  const input = SelectInboxChatsBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose all or recent10." }); return; }
  const ids = await selectInboxChats(input.data.mode);
  if (!ids) { res.status(409).json({ error: "Selection was interrupted by data deletion." }); return; }
  notifyChange();
  res.json(SelectInboxChatsResponse.parse({ added: ids.length }));
  void (async () => {
    for (const id of ids) {
      if (isErasing()) break;
      await requestSelectedHistory(id);
    }
  })().catch(() => { req.log.warn({ subsystem: "whatsapp" }, "Selected chat history could not be requested."); });
});
router.patch("/chats/:chatId/selection", async (req, res) => {
  const input = UpdateChatSelectionBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "selected must be a boolean." }); return; }
  const chat = await setSelection(String(req.params.chatId), input.data.selected);
  if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  notifyChange();
  res.json(await chatView(chat));
  if (chat.selected) void requestSelectedHistory(chat.chatId);
});
router.patch("/chats/:chatId/preferences", async (req, res) => {
  const input = UpdateChatPreferencesBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "important must be a boolean." }); return; }
  const chat = await setImportant(String(req.params.chatId), input.data.important);
  if (!chat) { res.status(404).json({ error: "Chat not found." }); return; }
  notifyChange();
  res.json(await chatView(chat));
});
router.post("/chats/:chatId/review", async (req, res) => {
  const chat = await markReviewed(String(req.params.chatId));
  if (!chat?.selected) { res.status(404).json({ error: "Selected chat not found." }); return; }
  notifyChange();
  res.json(await chatView(chat));
});
router.get("/chats/:chatId/context", async (req, res) => {
  const [chat] = await db.select().from(pilahChats).where(eq(pilahChats.chatId, String(req.params.chatId)));
  if (!chat?.selected) { res.status(404).json({ error: "Selected chat not found." }); return; }
  res.json(GetChatContextResponse.parse({ chat: await chatView(chat), item: await analyzeChat(chat), messages: await getMessages(chat.chatId), contextComplete: false }));
});
async function statusWithCoverage() {
  const chats = await listChats();
  return GetConnectionStatusResponse.parse({
    ...connectionSnapshot(), availableChats: chats.length, selectedChats: chats.filter(c => c.selected).length,
    analyzedMessages: chats.reduce((n, c) => n + c.retainedMessageCount, 0),
  });
}
router.get("/ai-consent", async (_req, res) => {
  const [pref] = await db.select().from(pilahPreferences).where(eq(pilahPreferences.id, "owner"));
  res.json({ enabled: false, provider: null, updatedAt: pref?.updatedAt.toISOString() ?? null });
});
router.put("/ai-consent", async (req, res) => {
  const input = UpdateAiConsentBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Invalid AI consent preference." }); return; }
  if (input.data.enabled) { res.status(503).json({ error: "No external AI provider is configured. Rules-based analysis remains available and no external AI calls are made." }); return; }
  const updatedAt = new Date();
  await serialWrite(async () => {
    await db.insert(pilahPreferences).values({ id: "owner", aiEnabled: false, aiProvider: null, updatedAt }).onConflictDoUpdate({
      target: pilahPreferences.id, set: { aiEnabled: false, aiProvider: null, updatedAt },
    });
  });
  res.json({ enabled: false, provider: null, updatedAt: updatedAt.toISOString() });
});
router.delete("/data", async (req, res) => {
  const input = DeleteOwnerDataBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Type DELETE to confirm deletion of all application-held live data." }); return; }
  beginErasure();
  try {
    const disconnect = await disconnectWhatsApp();
    await eraseAllData();
    await revokeOwnerSession(req, res);
    res.json({ deleted: true, remoteLogoutSucceeded: disconnect.remoteLogoutSucceeded, ownerInstruction: disconnect.ownerInstruction });
  } finally { endErasure(); }
});

let streamCount = 0;
router.get("/events", (req, res) => {
  if (streamCount >= 10) { res.status(429).json({ error: "Too many live update streams." }); return; }
  streamCount += 1;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": PILAH authenticated updates\n\n");
  const change = () => {
    void isOwner(req).then(owner => {
      if (res.writableEnded) return;
      if (!owner) { res.end(); return; }
      res.write("event: change\ndata: {}\n\n");
    }).catch(() => res.end());
  };
  inboxEvents.on("change", change);
  const timer = setInterval(() => {
    void isOwner(req).then(owner => {
      if (res.writableEnded) return;
      if (!owner) res.end();
      else res.write(": heartbeat\n\n");
    }).catch(() => res.end());
  }, 15_000);
  timer.unref();
  res.on("close", () => { clearInterval(timer); inboxEvents.off("change", change); streamCount -= 1; });
});
export default router;