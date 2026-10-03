import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import type { SourceMessage } from "@workspace/pilah-core";
import type { SignalDataSet } from "@whiskeysockets/baileys";
import type { Request, Response } from "express";

// Override credentials in this test process only. Never read real security secrets.
process.env.PILAH_OWNER_PASSWORD = "synthetic-owner-test-password";
process.env.PILAH_DATA_ENCRYPTION_KEY = "synthetic-encryption-key-for-isolated-tests-only";
process.env.SESSION_SECRET = "synthetic-session-secret-for-isolated-tests-only";
const schema = `pilah_test_${randomBytes(8).toString("hex")}`;
// PostgreSQL ignores nonexistent search_path schemas; never add "public" as a fallback.
process.env.PGOPTIONS = `-c search_path=${schema}`;

test("PILAH durable storage and cancellation (isolated temporary database schema)", async t => {
  const storage = await import("./store");
  const { databaseAuthState } = await import("./auth-store");
  const { encrypt, decrypt } = await import("./crypto");
  const lifecycle = await import("./lifecycle");
  const { db, pool, pilahMessages, pilahAuth, pilahChats, pilahAnalysis, pilahPreferences, pilahSessions } = await import("@workspace/db");
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    const check = await pool.query<{ schema: string }>("SELECT current_schema() AS schema");
    assert.equal(check.rows[0]?.schema, schema, "Refuse tests unless all unqualified queries are isolated.");
    const migrationDir = new URL("../../../../../lib/db/drizzle/", import.meta.url);
    const migrations = (await readdir(migrationDir)).filter(name => name.endsWith(".sql")).sort();
    assert.ok(migrations.length);
    for (const name of migrations) {
      const sql = (await readFile(new URL(name, migrationDir), "utf8")).replaceAll('"public".', `"${schema}".`);
      await pool.query(sql);
    }
    await t.test("phone-authorized browser sessions are private, exclusive, rate-limited and origin-checked", async () => {
      const auth = await import("../../middlewares/owner-auth");
      let token = "", options: Record<string, unknown> = {};
      const response = { cookie: (_name: string, value: string, settings: Record<string, unknown>) => { token = value; options = settings; }, clearCookie: () => {} } as unknown as Response;
      const freshRequest = { cookies: {} } as unknown as Request;
      await db.insert(pilahChats).values({ chatId: "synthetic-legacy", nameEncrypted: (await import("./crypto")).encrypt("Synthetic legacy chat") });
      await assert.rejects(auth.beginPairing(freshRequest, response), /original browser/, "A new phone cannot claim legacy data with unknown ownership.");
      await db.delete(pilahChats).where(eq(pilahChats.chatId, "synthetic-legacy"));
      assert.equal(await auth.authorizeLinkedPhone("synthetic-owner@s.whatsapp.net", null, lifecycle.currentGeneration(), true), true);
      assert.equal(await auth.isOwner(freshRequest), false, "Restoring durable phone credentials never authorizes an anonymous browser.");
      await auth.beginPairing(freshRequest, response);
      assert.equal(options.httpOnly, true);
      assert.equal(options.secure, true);
      assert.equal(options.sameSite, "strict");
      assert.equal(options.path, "/api");
      const pairedRequest = { cookies: { pilah_session: token } } as unknown as Request;
      assert.equal(await auth.isPairing(pairedRequest), true);
      assert.equal(await auth.isOwner(pairedRequest), false, "Starting QR pairing does not grant access to data.");
      await assert.rejects(auth.beginPairing(freshRequest, response), /another browser/);
      const pendingKey = await auth.pendingPairingKey();
      assert.ok(pendingKey);
      assert.equal(await auth.authorizeLinkedPhone("synthetic-owner@s.whatsapp.net", pendingKey, lifecycle.currentGeneration()), true);
      assert.equal(await auth.isOwner(pairedRequest), true);
      assert.equal(await auth.isPairing(pairedRequest), false);
      process.env.PILAH_OWNER_PASSWORD = "synthetic-changed-owner-password";
      try {
        assert.equal(await auth.isOwner(pairedRequest), true, "No owner password is needed after phone authorization.");
      } finally { process.env.PILAH_OWNER_PASSWORD = "synthetic-owner-test-password"; }
      await auth.revokeOwnerSession(pairedRequest, response);
      assert.equal(await auth.isOwner(pairedRequest), false);
      await auth.beginPairing(freshRequest, response);
      const expiredKey = await auth.pendingPairingKey();
      assert.ok(expiredKey);
      await db.update(pilahSessions).set({ expiresAt: new Date(0) }).where(eq(pilahSessions.tokenHash, expiredKey));
      assert.equal(await auth.authorizeLinkedPhone("synthetic-owner@s.whatsapp.net", expiredKey, lifecycle.currentGeneration()), false, "Expired QR attempts cannot become owner sessions.");
      await auth.beginPairing(freshRequest, response);
      const recovery = { cookies: { pilah_session: token } } as unknown as Request;
      const recoveryKey = await auth.pendingPairingKey();
      assert.equal(await auth.authorizeLinkedPhone("different-synthetic-phone@s.whatsapp.net", recoveryKey, lifecycle.currentGeneration()), false, "Another phone cannot claim an existing owner's data.");
      assert.equal(await auth.isOwner(recovery), false);
      assert.equal(await auth.authorizeLinkedPhone("synthetic-owner@s.whatsapp.net", recoveryKey, lifecycle.currentGeneration()), true);
      assert.equal(await auth.isOwner(recovery), true);
      assert.equal(await auth.isOwner({ cookies: {} } as Request), false);
      assert.equal(await auth.isOwner({ cookies: { pilah_session: "a".repeat(64) } } as unknown as Request), false);
      let code = 0, passed = false;
      const errorResponse = { setHeader: () => {}, status: (value: number) => { code = value; return errorResponse; }, json: () => {} } as unknown as Response;
      await auth.requireOwner({ cookies: {} } as Request, errorResponse, () => { passed = true; });
      assert.equal(code, 401);
      assert.equal(passed, false);
      const request = (origin: string) => ({ method: "POST", get: (header: string) => ({ origin, host: "pilah.invalid", "sec-fetch-site": "same-origin" } as Record<string,string>)[header] }) as Request;
      auth.requireSameOrigin(request("https://untrusted.invalid"), errorResponse, () => { passed = true; });
      assert.equal(code, 403);
      assert.equal(passed, false);
      auth.requireSameOrigin(request("https://pilah.invalid"), errorResponse, () => { passed = true; });
      assert.equal(passed, true);
      const limited = { ip: "synthetic-test-ip" } as Request;
      for (let i = 0; i < 8; i++) assert.equal(auth.allowLogin(limited), true);
      assert.equal(auth.allowLogin(limited), false);
    });
    await t.test("AES-GCM round-trip, randomized ciphertext, and tamper rejection", () => {
      const text = "synthetic private text";
      const a = encrypt(text), b = encrypt(text);
      assert.equal(decrypt(a), text);
      assert.notEqual(a, b);
      assert.ok(!a.includes(text));
      const parts = a.split(":"); parts[2] = Buffer.alloc(16).toString("base64");
      assert.throws(() => decrypt(parts.join(":")));
    });
    await t.test("automatic encryption needs no dedicated key and restores Signal credentials", async () => {
      const crypto = await import("./crypto");
      const legacy = encrypt("synthetic legacy data");
      const legacyHash = crypto.authKeyHash("creds");
      process.env.PILAH_DATA_ENCRYPTION_KEY = "short-test-placeholder";
      try {
        assert.equal(crypto.configurationError(), null);
        const text = "synthetic automatically encrypted text";
        const cipher = encrypt(text);
        assert.ok(cipher.startsWith("v2:"));
        assert.equal(decrypt(cipher), text);
        assert.notEqual(encrypt(text), cipher);
        const parts = cipher.split(":"); parts[2] = Buffer.alloc(16).toString("base64");
        assert.throws(() => decrypt(parts.join(":")));
        assert.throws(() => decrypt(legacy), /original dedicated encryption key/);
        assert.notEqual(crypto.authKeyHash("creds"), legacyHash);
        assert.equal(crypto.authKeyHash("creds"), crypto.authKeyHash("creds"));
        const first = await databaseAuthState();
        first.state.creds.registered = true;
        await first.saveCreds();
        await first.state.keys.set({ session: { fake: Buffer.from("synthetic managed session") } });
        const restored = await databaseAuthState();
        assert.equal(restored.state.creds.registered, true);
        assert.deepEqual(restored.state.creds.noiseKey, first.state.creds.noiseKey);
        assert.deepEqual((await restored.state.keys.get("session", ["fake"])).fake, Buffer.from("synthetic managed session"));
        assert.ok((await db.select().from(pilahAuth)).every(row => row.valueEncrypted.startsWith("v2:")));
        delete process.env.PILAH_DATA_ENCRYPTION_KEY;
        assert.equal(crypto.configurationError(), null);
        assert.equal(decrypt(cipher), text);
        delete process.env.PILAH_OWNER_PASSWORD;
        assert.equal(crypto.configurationError(), null, "QR-only setup requires no owner password.");
        process.env.PILAH_OWNER_PASSWORD = "short";
        assert.equal(crypto.configurationError(), null, "An unused legacy password cannot block QR pairing.");
      } finally {
        await db.delete(pilahAuth);
        process.env.PILAH_DATA_ENCRYPTION_KEY = "synthetic-encryption-key-for-isolated-tests-only";
        process.env.PILAH_OWNER_PASSWORD = "synthetic-owner-test-password";
      }
      assert.equal(decrypt(legacy), "synthetic legacy data");
    });
    await t.test("credentials and every current Signal key category survive restoration", async () => {
      const first = await databaseAuthState();
      first.state.creds.registered = true;
      await first.saveCreds();
      const fixtures = {
        "pre-key": { fake: { private: Buffer.from("private"), public: Buffer.from("public") } },
        session: { fake: Buffer.from("session") }, "sender-key": { fake: Buffer.from("sender") },
        "sender-key-memory": { fake: { synthetic: true } },
        "app-state-sync-key": { fake: { keyData: Buffer.from("state") } },
        "app-state-sync-version": { fake: { version: 1, hash: Buffer.alloc(128), indexValueMap: {} } },
        "lid-mapping": { fake: "synthetic-lid" }, "device-list": { fake: ["0"] },
        tctoken: { fake: { token: Buffer.from("token") } }, "identity-key": { fake: Buffer.from("identity") },
      } as unknown as SignalDataSet;
      await first.state.keys.set(fixtures);
      const restored = await databaseAuthState();
      assert.equal(restored.state.creds.registered, true);
      assert.deepEqual(restored.state.creds.noiseKey, first.state.creds.noiseKey);
      for (const type of Object.keys(fixtures) as (keyof SignalDataSet)[]) {
        const result = await restored.state.keys.get(type, ["fake"]);
        assert.ok(result.fake, `${type} must be restored`);
      }
      assert.equal((await restored.state.keys.get("lid-mapping", ["fake"])).fake, "synthetic-lid");
      await restored.state.keys.set({ session: { fake: null } });
      assert.equal((await restored.state.keys.get("session", ["fake"])).fake, undefined);
      const rows = await db.select().from(pilahAuth);
      assert.ok(rows.length >= 10);
      assert.ok(rows.every(row => row.valueEncrypted.startsWith("v1:") && !row.valueEncrypted.includes("synthetic-lid")));
    });
    const epoch = lifecycle.currentGeneration();
    const now = Date.now();
    function msg(id: string, offset = 0, owner = false): SourceMessage {
      return { messageId: id, senderName: owner ? "You" : "Synthetic", text: `FYI synthetic ${id}`, timestamp: new Date(now + offset).toISOString(), fromOwner: owner, unsupportedContent: false, edited: false, deleted: false, quotedMessageId: null };
    }
    await t.test("unselected bodies are never stored; selection, batch dedupe and retention work", async () => {
      await storage.upsertChat("synthetic-chat", "Synthetic chat", false, epoch);
      await storage.ingestMessages("synthetic-chat", [msg("unselected")], epoch);
      assert.equal((await db.select().from(pilahMessages)).length, 0);
      await storage.setSelection("synthetic-chat", true);
      const batch = Array.from({ length: 65 }, (_, i) => msg(`m${i}`, -i * 1000, i === 0));
      batch.push(batch[0]!, msg("expired", -8 * 86_400_000));
      await storage.ingestMessages("synthetic-chat", batch, epoch);
      const messages = await storage.getMessages("synthetic-chat");
      assert.equal(messages.length, 50);
      assert.equal(new Set(messages.map(m => m.messageId)).size, 50);
      assert.ok(messages.some(m => m.fromOwner));
      assert.ok(messages.every((m, i) => !i || m.timestamp >= messages[i - 1]!.timestamp));
      assert.ok(!messages.some(m => m.messageId === "unselected" || m.messageId === "expired"));
      const raw = await db.select().from(pilahMessages);
      assert.ok(raw.every(row => row.bodyEncrypted?.startsWith("v1:") && !row.bodyEncrypted.includes("FYI synthetic")));
      await storage.getInbox();
      const analysis = await db.select().from(pilahAnalysis);
      assert.equal(analysis.length, 1);
      assert.ok(analysis[0]!.valueEncrypted.startsWith("v1:"));
    });
    await t.test("edits and deletions invalidate summaries; deselecting purges retained text", async () => {
      await storage.ingestMessages("synthetic-chat", [{ ...msg("m0", 0, true), text: "Corrected synthetic text", edited: true }], epoch, true);
      assert.equal((await storage.getMessages("synthetic-chat")).find(m => m.messageId === "m0")?.text, "Corrected synthetic text");
      assert.equal((await db.select().from(pilahAnalysis)).length, 0);
      await storage.deleteMessages("synthetic-chat", ["m0"], epoch);
      assert.ok(!(await storage.getMessages("synthetic-chat")).some(m => m.messageId === "m0"));
      await storage.setSelection("synthetic-chat", false);
      assert.equal((await db.select().from(pilahMessages)).length, 0);
      await storage.setSelection("synthetic-chat", true);
    });
    await t.test("bulk selection adds the latest ten or all chats without removing existing data", async () => {
      const reviewedAt = new Date();
      await db.update(pilahChats).set({ reviewedAt }).where(eq(pilahChats.chatId, "synthetic-chat"));
      const retainedBefore = (await db.select().from(pilahMessages)).length;
      await db.insert(pilahChats).values([
        ...Array.from({ length: 12 }, (_, i) => ({ chatId: `bulk-${i + 1}`, nameEncrypted: encrypt("Synthetic bulk chat"), latestActivity: new Date(now + (i + 1) * 1000) })),
        { chatId: "bulk-unknown-activity", nameEncrypted: encrypt("Synthetic unknown activity"), latestActivity: null },
      ]);
      const recent = await storage.selectInboxChats("recent10");
      assert.equal(recent?.length, 10);
      assert.deepEqual(new Set(recent), new Set(Array.from({ length: 10 }, (_, i) => `bulk-${i + 3}`)));
      assert.deepEqual(await storage.selectInboxChats("recent10"), [], "Repeated selection is idempotent.");
      const all = await storage.selectInboxChats("all");
      assert.equal(all?.length, 3, "All includes older and unknown-activity chats.");
      assert.ok((await db.select().from(pilahChats)).every(chat => chat.selected));
      assert.deepEqual(await storage.selectInboxChats("all"), []);
      const [original] = await db.select().from(pilahChats).where(eq(pilahChats.chatId, "synthetic-chat"));
      assert.equal(original?.reviewedAt?.getTime(), reviewedAt.getTime(), "Existing reviews are preserved.");
      assert.equal((await db.select().from(pilahMessages)).length, retainedBefore, "Bulk selection never deletes retained messages.");
    });
    await t.test("in-flight and queued writes cannot recreate deleted data", async () => {
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { started = resolve; });
      const first = lifecycle.guardedWrite(epoch, async () => {
        started(); await gate;
        await db.insert(pilahPreferences).values({ id: "in-flight", aiEnabled: false });
      });
      await ready;
      lifecycle.beginErasure();
      const erase = storage.eraseAllData();
      const stale = storage.ingestMessages("synthetic-chat", [msg("stale")], epoch);
      const bulkDuringErasure = storage.selectInboxChats("all");
      release();
      await Promise.all([first, erase, stale, bulkDuringErasure]);
      assert.equal(await bulkDuringErasure, undefined, "Bulk selection is blocked during erasure.");
      lifecycle.endErasure();
      for (const table of [pilahMessages, pilahAuth, pilahChats, pilahAnalysis, pilahPreferences, pilahSessions]) {
        assert.equal((await db.select().from(table)).length, 0);
      }
    });
  } finally {
    lifecycle.endErasure();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});