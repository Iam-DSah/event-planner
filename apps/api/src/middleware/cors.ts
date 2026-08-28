import cors from "cors";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

export const corsMiddleware = cors({
  origin: WEB_ORIGIN,

  credentials: true,

  maxAge: 600,
});
