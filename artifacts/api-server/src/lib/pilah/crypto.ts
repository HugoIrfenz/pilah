import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scryptSync } from "node:crypto";

let cachedKey: Buffer | null = null;
const managedKeys = new Map<string, Buffer>();
export function configurationError(): string | null {
  if ((process.env.SESSION_SECRET?.length ?? 0) < 32) {
    return "The server's security configuration is unavailable. Live mode is locked.";
  }
  return null;
}
export function liveConfigured(): boolean {
  return configurationError() === null;
}
function dedicatedKey(): Buffer {
  if ((process.env.PILAH_DATA_ENCRYPTION_KEY?.length ?? 0) < 32) {
    throw new Error("The original dedicated encryption key is required to read legacy data.");
  }
  cachedKey ??= scryptSync(process.env.PILAH_DATA_ENCRYPTION_KEY!, "PILAH encrypted data v1", 32);
  return cachedKey;
}
function managedKey(purpose: string): Buffer {
  if ((process.env.SESSION_SECRET?.length ?? 0) < 32) throw new Error("Server security configuration is unavailable.");
  let derived = managedKeys.get(purpose);
  if (!derived) {
    derived = Buffer.from(hkdfSync("sha256", process.env.SESSION_SECRET!, "PILAH server keys v2", purpose, 32));
    managedKeys.set(purpose, derived);
  }
  return derived;
}
function activeKey(): { version: "v1" | "v2"; key: Buffer } {
  // Keep valid pre-existing dedicated-key installations compatible. New setups
  // derive separate encryption/indexing keys from the existing server secret.
  return (process.env.PILAH_DATA_ENCRYPTION_KEY?.length ?? 0) >= 32
    ? { version: "v1", key: dedicatedKey() }
    : { version: "v2", key: managedKey("PILAH AES-256-GCM data encryption") };
}
export function encrypt(value: string): string {
  const { version, key } = activeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`pilah:${version}`));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${version}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}
export function decrypt(value: string): string {
  const [version, iv, tag, data, extra] = value.split(":");
  if (!["v1", "v2"].includes(version ?? "") || !iv || !tag || data === undefined || extra !== undefined) throw new Error("Invalid encrypted value.");
  const key = version === "v1" ? dedicatedKey() : managedKey("PILAH AES-256-GCM data encryption");
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  cipher.setAAD(Buffer.from(`pilah:${version}`));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([cipher.update(Buffer.from(data, "base64")), cipher.final()]).toString("utf8");
}
export function authKeyHash(name: string): string {
  const active = activeKey();
  const key = active.version === "v1" ? active.key : managedKey("PILAH Signal record indexing");
  return createHmac("sha256", key).update(name).digest("hex");
}
export function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}