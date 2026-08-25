import type { LoginInput, RegisterInput } from "@event-planner/shared";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  createUser,
  findUserForLoginByEmail,
  type User,
} from "../repositories/userRepository.js";
import { UnauthorizedError } from "../errors/domainErrors.js";
import { randomUUID } from "node:crypto";
import {
  REFRESH_GRACE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../lib/tokenTtl.js";
import { generateRefreshToken, hashRefreshToken } from "../lib/refreshToken.js";
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  markRefreshTokenUsed,
  revokeRefreshTokenFamily,
} from "../repositories/refreshTokenRepository.js";
import { signToken } from "../lib/jwt.js";
import type { Knex } from "knex";
import db from "../db/knex.js";

const DUMMY_HASH = await hashPassword("dummy-password-for-login-timing");

export async function registerUser(input: RegisterInput): Promise<User> {
  const passwordHash = await hashPassword(input.password);

  return createUser({
    name: input.name,
    email: input.email,
    passwordHash,
  });
}

export async function authenticateUser(input: LoginInput): Promise<User> {
  const user = await findUserForLoginByEmail(input.email);

  if (!user) {
    await verifyPassword(DUMMY_HASH, input.password);

    console.warn("Authentication failed: unknown email");

    throw new UnauthorizedError();
  }

  const valid = await verifyPassword(user.passwordHash, input.password);

  if (!valid) {
    console.warn("Authentication failed: invalid password");

    throw new UnauthorizedError();
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

/**
 * Internal control-flow signal, deliberately NOT in domainErrors.ts: everything
 * in that file has an HTTP mapping in errorHandler, and this must never reach
 * a client. It only means "another request won the compare-and-set".
 */
class RefreshTokenRotationRaceError extends Error {
  constructor() {
    super("Refresh token rotation race");
    this.name = "RefreshTokenRotationRaceError";
  }
}

export interface SessionTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Mints one refresh token inside an existing family and stores its hash.
 * Used by both the normal rotation and the grace path, so the two cannot
 * drift in how they compute expiry or what they store.
 */
async function issueTokenInFamily(
  userId: string,
  familyId: string,
  now: Date,
  executor: Knex | Knex.Transaction,
): Promise<{ id: string; refreshToken: string; refreshExpiresAt: Date }> {
  const refreshToken = generateRefreshToken();

  // Sliding: every issued token gets a full TTL from now.
  const refreshExpiresAt = new Date(
    now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
  );

  const id = await insertRefreshToken(
    {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
    },
    executor,
  );

  return { id, refreshToken, refreshExpiresAt };
}

function sessionFor(
  userId: string,
  issued: { refreshToken: string; refreshExpiresAt: Date },
): SessionTokens {
  return {
    userId,
    accessToken: signToken(userId),
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt,
  };
}

export async function rotateSession(
  presentedRefreshToken: string,
): Promise<SessionTokens> {
  const tokenHash = hashRefreshToken(presentedRefreshToken);

  const token = await findRefreshTokenByHash(tokenHash, db);

  const now = new Date();

  // Every rejection below throws the SAME error. The reason goes to the log
  // only: four distinct messages would tell whoever holds a stolen token
  // whether it is unknown, expired, revoked or already burned.
  if (!token) {
    console.warn("Refresh rejected: no such token");

    throw new UnauthorizedError();
  }

  // Expiry and the grace window are both measured against this one Node clock.
  if (token.expiresAt <= now) {
    console.warn("Refresh rejected: token expired");

    throw new UnauthorizedError();
  }

  if (token.revokedAt !== null) {
    console.warn("Refresh rejected: token revoked");

    throw new UnauthorizedError();
  }

  if (token.usedAt !== null) {
    const ageSeconds = (now.getTime() - token.usedAt.getTime()) / 1000;

    if (ageSeconds > REFRESH_GRACE_SECONDS) {
      // Reuse. Revoke the family FIRST and let it commit, then reject.
      // Doing this inside a transaction that then throws would roll the
      // revocation back and leave the attacker a live family — the failure
      // is silent, and a test asserting 401 still passes.
      console.warn(
        `Refresh rejected: token reuse detected, revoking family ${token.familyId}`,
      );

      await revokeRefreshTokenFamily(token.familyId, db);

      throw new UnauthorizedError();
    }

    // Used within the window: a concurrent refresh, not an attack. The
    // original successor's plaintext is not recoverable — only its hash was
    // stored — so issue a sibling in the same family instead.
    return sessionFor(
      token.userId,
      await issueTokenInFamily(token.userId, token.familyId, now, db),
    );
  }

  try {
    return await db.transaction(async (trx) => {
      const successor = await issueTokenInFamily(
        token.userId,
        token.familyId,
        now,
        trx,
      );

      const affectedRows = await markRefreshTokenUsed(
        token.id,
        successor.id,
        trx,
      );

      // Another request won the compare-and-set between our read and this
      // update. Roll back so the successor we just inserted is discarded.
      if (affectedRows !== 1) {
        throw new RefreshTokenRotationRaceError();
      }

      return sessionFor(token.userId, successor);
    });
  } catch (error) {
    if (!(error instanceof RefreshTokenRotationRaceError)) {
      throw error;
    }

    // Losing the compare-and-set means the token was used during this very
    // request, which is inside the grace window by construction — no re-read
    // needed to establish that.
    console.warn("Refresh: lost rotation race, issuing sibling token");

    return sessionFor(
      token.userId,
      await issueTokenInFamily(token.userId, token.familyId, new Date(), db),
    );
  }
}

export async function issueSession(userId: string): Promise<SessionTokens> {
  const familyId = randomUUID();
  const now = new Date();

  const token = await issueTokenInFamily(userId, familyId, now, db);

  return sessionFor(userId, token);
}

export async function revokeSession(presentedToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken);

  const token = await findRefreshTokenByHash(tokenHash, db);

  if (!token) {
    return;
  }

  await revokeRefreshTokenFamily(token.familyId, db);
}
