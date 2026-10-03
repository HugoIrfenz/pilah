import { eq } from "drizzle-orm";
import { db, pilahAuth } from "@workspace/db";
import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";
import { authKeyHash, decrypt, encrypt } from "./crypto";
import { currentGeneration, guardedWrite } from "./lifecycle";

export async function databaseAuthState() {
  const epoch = currentGeneration();
  async function read(name: string): Promise<unknown | null> {
    const [row] = await db.select().from(pilahAuth).where(eq(pilahAuth.keyHash, authKeyHash(name)));
    return row ? JSON.parse(decrypt(row.valueEncrypted), BufferJSON.reviver) : null;
  }
  const creds = (await read("creds") ?? initAuthCreds()) as AuthenticationState["creds"];
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const values: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let value = await read(`${type}:${id}`);
          if (value && type === "app-state-sync-key") value = proto.Message.AppStateSyncKeyData.create(value as proto.Message.IAppStateSyncKeyData);
          if (value !== null) values[id] = value as SignalDataTypeMap[T];
        }
        return values;
      },
      set: async data => {
        await guardedWrite(epoch, async () => db.transaction(async tx => {
          for (const [type, values] of Object.entries(data)) {
            for (const [id, value] of Object.entries(values ?? {})) {
              const keyHash = authKeyHash(`${type}:${id}`);
              if (value === null) await tx.delete(pilahAuth).where(eq(pilahAuth.keyHash, keyHash));
              else {
                const valueEncrypted = encrypt(JSON.stringify(value, BufferJSON.replacer));
                await tx.insert(pilahAuth).values({ keyHash, valueEncrypted }).onConflictDoUpdate({ target: pilahAuth.keyHash, set: { valueEncrypted } });
              }
            }
          }
        }));
      },
    },
  };
  return {
    state,
    saveCreds: async () => {
      await guardedWrite(epoch, async () => {
        const valueEncrypted = encrypt(JSON.stringify(creds, BufferJSON.replacer));
        await db.insert(pilahAuth).values({ keyHash: authKeyHash("creds"), valueEncrypted }).onConflictDoUpdate({ target: pilahAuth.keyHash, set: { valueEncrypted } });
      });
    },
  };
}