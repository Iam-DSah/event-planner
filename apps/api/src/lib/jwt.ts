import jwt from "jsonwebtoken";
import { requireEnv } from "./env.js";

const JWT_SECRET = requireEnv("JWT_SECRET", 32);

const JWT_ALGORITHM = "HS256" as const;
const JWT_EXPIRES_IN = "15m";

export function signToken(userId: string): string {
  return jwt.sign(
    {},
    JWT_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      subject: userId,
      expiresIn: JWT_EXPIRES_IN,
    },
  );
}

export function verifyToken(token: string): { sub: string } {
  const payload = jwt.verify(token, JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
  });

  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid JWT payload");
  }

  return {
    sub: payload.sub,
  };
}