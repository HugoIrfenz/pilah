import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(/\/chats\/[^/]+/, "/chats/:chatId"),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: "16kb" }));

app.use("/api", router);
app.use((_req, res) => { res.status(404).json({ error: "Endpoint not found." }); });
app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ errorType: error.name }, "Request failed.");
  if (res.headersSent) { res.end(); return; }
  res.status(error instanceof SyntaxError ? 400 : 503).json({ error: error instanceof SyntaxError ? "Invalid JSON request." : "The server could not complete this request. Try again." });
});

export default app;
