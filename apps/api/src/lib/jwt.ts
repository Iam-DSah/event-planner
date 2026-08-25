import jwt from "jsonwebtoken";
import { requireEnv } from "./env.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./tokenTtl.js";

const JWT_SECRET = requireEnv("JWT_SECRET", 32);

const JWT_ALGORITHM = "HS256" as const;

export function signToken(userId: string): string {
  return jwt.sign({}, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    subject: userId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
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
