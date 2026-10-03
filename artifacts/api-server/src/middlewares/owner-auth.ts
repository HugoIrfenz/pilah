import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, pilahSessions, pilahPreferences, pilahChats } from "@workspace/db";
import { liveConfigured } from "../lib/pilah/crypto";
import { currentGeneration, guardedWrite, isErasing } from "../lib/pilah/lifecycle";

const COOKIE = "pilah_session";
const MAX_AGE = 30 * 24 * 3_600_000;
const PAIRING_AGE = 15 * 60_000;
export class PairingError extends Error {}
const loginAttempts = new Map<string, { count: number; expiresAt: number }>();
function tokenHash(token: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "").update(token).digest("hex");
}
function sessionTokenHash(token: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update("PILAH browser session v3\0").update(token).digest("hex");
}
function cookieToken(req: Request): string | null {
  const token = req.cookies?.[COOKIE];
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
async function browserSession(req: Request) {
  if (!liveConfigured()) return undefined;
  const token = cookieToken(req);
  if (!token) return undefined;
  const [session] = await db.select().from(pilahSessions).where(and(eq(pilahSessions.tokenHash, sessionTokenHash(token)), gt(pilahSessions.expiresAt, new Date())));
  if (session) return session;
  // Upgrade a previously authenticated browser without ever showing its old password.
  if (!process.env.PILAH_OWNER_PASSWORD) return undefined;
  const legacyHash = createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update("PILAH owner session v2\0").update(process.env.PILAH_OWNER_PASSWORD).update("\0").update(token).digest("hex");
  const [legacy] = await db.select().from(pilahSessions).where(and(eq(pilahSessions.tokenHash, legacyHash), eq(pilahSessions.purpose, "owner"), gt(pilahSessions.expiresAt, new Date())));
  if (!legacy) return undefined;
  await guardedWrite(currentGeneration(), async () => db.update(pilahSessions).set({ tokenHash: sessionTokenHash(token) }).where(eq(pilahSessions.tokenHash, legacyHash)));
  return { ...legacy, tokenHash: sessionTokenHash(token) };
}
export async function isOwner(req: Request): Promise<boolean> {
  return (await browserSession(req))?.purpose === "owner";
}
export async function isPairing(req: Request): Promise<boolean> {
  return (await browserSession(req))?.purpose === "pairing";
}
export async function pairingState(req: Request) {
  const session = await browserSession(req);
  const active = await db.select({ purpose: pilahSessions.purpose }).from(pilahSessions).where(gt(pilahSessions.expiresAt, new Date()));
  const authenticated = session?.purpose === "owner";
  const pairingPending = session?.purpose === "pairing";
  return { authenticated, pairingPending, pairingAllowed: authenticated || (!active.some(s => s.purpose === "owner") && (pairingPending || !active.some(s => s.purpose === "pairing"))) };
}
export async function beginPairing(req: Request, res: Response): Promise<boolean> {
  if (!liveConfigured() || isErasing()) throw new PairingError("Live pairing is currently unavailable.");
  if (await isOwner(req) || await isPairing(req)) return false;
  const token = randomBytes(32).toString("hex");
  const saved = await guardedWrite(currentGeneration(), async () => {
    if (isErasing()) return false;
    await db.delete(pilahSessions).where(lt(pilahSessions.expiresAt, new Date()));
    const active = await db.select().from(pilahSessions).where(gt(pilahSessions.expiresAt, new Date()));
    if (active.length) throw new PairingError("This inbox is open in another browser. Return to that browser, or wait for its pairing attempt to expire.");
    const [pref] = await db.select().from(pilahPreferences).where(eq(pilahPreferences.id, "owner"));
    if (!pref?.ownerAccountHash) {
      const [retained] = await db.select({ id: pilahChats.chatId }).from(pilahChats).limit(1);
      if (retained) throw new PairingError("This older inbox cannot verify its original phone. Return to its original browser to clear the old data before pairing.");
    }
    await db.insert(pilahSessions).values({ tokenHash: sessionTokenHash(token), purpose: "pairing", expiresAt: new Date(Date.now() + PAIRING_AGE) });
    return true;
  });
  if (!saved) throw new PairingError("Pairing was interrupted.");
  res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", maxAge: MAX_AGE, path: "/api" });
  return true;
}
export async function pendingPairingKey(): Promise<string | null> {
  const [pending] = await db.select().from(pilahSessions).where(and(eq(pilahSessions.purpose, "pairing"), gt(pilahSessions.expiresAt, new Date())));
  return pending?.tokenHash ?? null;
}
export async function authorizeLinkedPhone(accountId: string, pendingKey: string | null, epoch: number, restoring = false): Promise<boolean> {
  if (!accountId || !liveConfigured() || isErasing()) return false;
  const fingerprint = createHmac("sha256", process.env.SESSION_SECRET ?? "").update("PILAH linked phone identity\0").update(accountId).digest("hex");
  const result = await guardedWrite(epoch, async () => db.transaction(async tx => {
    if (isErasing()) return false;
    const [pref] = await tx.select().from(pilahPreferences).where(eq(pilahPreferences.id, "owner"));
    if (pref?.ownerAccountHash && !timingSafeEqual(Buffer.from(pref.ownerAccountHash, "hex"), Buffer.from(fingerprint, "hex"))) return false;
    if (pendingKey) {
      const [pending] = await tx.select().from(pilahSessions).where(and(eq(pilahSessions.tokenHash, pendingKey), eq(pilahSessions.purpose, "pairing"), gt(pilahSessions.expiresAt, new Date())));
      if (!pending) return false;
      await tx.update(pilahSessions).set({ purpose: "owner", expiresAt: new Date(Date.now() + MAX_AGE) }).where(eq(pilahSessions.tokenHash, pendingKey));
    } else {
      const owners = await tx.select().from(pilahSessions).where(and(eq(pilahSessions.purpose, "owner"), gt(pilahSessions.expiresAt, new Date())));
      if (!owners.length && !restoring) return false;
    }
    await tx.insert(pilahPreferences).values({ id: "owner", ownerAccountHash: fingerprint })
      .onConflictDoUpdate({ target: pilahPreferences.id, set: { ownerAccountHash: fingerprint } });
    return true;
  }));
  return result === true;
}
export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const epoch = currentGeneration();
  res.setHeader("Cache-Control", "no-store");
  if (isErasing()) { res.status(409).json({ error: "Data deletion is in progress." }); return; }
  if (!(await isOwner(req)) || epoch !== currentGeneration() || isErasing()) { res.status(401).json({ error: "Owner authentication required." }); return; }
  next();
}
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  const hosts = [req.get("host"), req.get("x-forwarded-host")?.split(",")[0]?.trim(), ...(process.env.REPLIT_DOMAINS?.split(",") ?? []), process.env.REPLIT_DEV_DOMAIN].filter(Boolean);
  try {
    const url = new URL(origin ?? "");
    if (!hosts.includes(url.host) || !["https:", "http:"].includes(url.protocol) || req.get("sec-fetch-site") === "cross-site") throw new Error();
  } catch { res.status(403).json({ error: "A same-origin request is required." }); return; }
  next();
}
export function allowLogin(req: Request): boolean {
  const now = Date.now();
  for (const [key, bucket] of loginAttempts) if (bucket.expiresAt <= now) loginAttempts.delete(key);
  const keys = [tokenHash(req.ip ?? "unknown"), "global"];
  for (const key of keys) {
    const bucket = loginAttempts.get(key) ?? { count: 0, expiresAt: now + 15 * 60_000 };
    bucket.count += 1;
    loginAttempts.set(key, bucket);
    if (bucket.count > (key === "global" ? 30 : 8)) return false;
  }
  return true;
}
export async function revokeOwnerSession(req: Request, res: Response): Promise<void> {
  const session = await browserSession(req);
  if (session) await db.delete(pilahSessions).where(eq(pilahSessions.tokenHash, session.tokenHash));
  res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/api" });
}