import app from "./app";
import { logger } from "./lib/logger";
import { disconnectWhatsApp, resumeStoredConnection } from "./lib/pilah/whatsapp";
import { pool } from "@workspace/db";
import { pruneExpired } from "./lib/pilah/store";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, "0.0.0.0", (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void resumeStoredConnection().catch(() => logger.warn("WhatsApp session restoration was unavailable."));
});
const retentionTimer = setInterval(() => {
  void pruneExpired().catch(() => logger.warn("Retention cleanup could not complete."));
}, 60_000);
retentionTimer.unref();
void pruneExpired().catch(() => logger.warn("Initial retention cleanup could not complete."));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(retentionTimer);
    void disconnectWhatsApp(false).finally(async () => {
      server.close();
      await pool.end();
      process.exit(0);
    });
  });
}
