import express from "express";
import db from "./db/knex.js";
import cookieParser from "cookie-parser";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRouter from "./routes/auth.js";
import eventsRouter from "./routes/events.js";

const app = express();

app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/events", eventsRouter);

app.get("/api/v1/health", async (_req, res) => {
  try {
    await db.raw("SELECT 1").timeout(2000);
    return res.status(200).json({
      status: "ok",
    });
  } catch (error) {
    console.error("Health check failed:", error);

    return res.status(503).json({
      status: "unavailable",
    });
  }
});

// 404 MUST come after all routes.
app.use(notFoundHandler);

// Error handler MUST be last.
app.use(errorHandler);

export default app;
