import type { Knex } from "knex";

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

interface RefreshTokenRow {
  id: number | string;
  user_id: number | string;
  token_hash: string;
  family_id: string;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  replaced_by_id: number | string | null;
  created_at: Date;
}

export interface InsertRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

function mapRefreshToken(row: RefreshTokenRow): RefreshToken {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: row.token_hash,
    familyId: row.family_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    replacedById:
      row.replaced_by_id === null ? null : String(row.replaced_by_id),
    createdAt: row.created_at,
  };
}

const refreshTokenColumns = [
  "id",
  "user_id",
  "token_hash",
  "family_id",
  "expires_at",
  "used_at",
  "revoked_at",
  "replaced_by_id",
  "created_at",
] as const;

export async function insertRefreshToken(
  input: InsertRefreshTokenInput,
  executor: Knex | Knex.Transaction,
): Promise<string> {
  const [id] = await executor("refresh_tokens").insert({
    user_id: input.userId,
    token_hash: input.tokenHash,
    family_id: input.familyId,
    expires_at: input.expiresAt,
  });

  if (id === undefined) {
    throw new Error("Refresh token was inserted but no id was returned");
  }

  return String(id);
}

export async function findRefreshTokenByHash(
  hash: string,
  executor: Knex | Knex.Transaction,
): Promise<RefreshToken | null> {
  // Deliberately do NOT filter by expires_at, used_at, or revoked_at.
  // The service needs the complete row to distinguish:
  // valid, expired, used, and revoked tokens.
  const row = await executor("refresh_tokens")
    .select(refreshTokenColumns)
    .where("token_hash", hash)
    .first();

  if (!row) {
    return null;
  }

  return mapRefreshToken(row);
}

export async function markRefreshTokenUsed(
  id: string,
  replacedById: string,
  executor: Knex | Knex.Transaction,
): Promise<number> {
  // Atomic compare-and-set:
  // exactly one concurrent rotation can change used_at from NULL.
  const affectedRows = await executor("refresh_tokens")
    .where("id", id)
    .whereNull("used_at")
    .update({
      used_at: executor.fn.now(3),
      replaced_by_id: replacedById,
    });

  return affectedRows;
}

export async function revokeRefreshTokenFamily(
  familyId: string,
  executor: Knex | Knex.Transaction,
): Promise<number> {
  return executor("refresh_tokens")
    .where("family_id", familyId)
    .whereNull("revoked_at")
    .update({
      revoked_at: executor.fn.now(3),
    });
}

export async function revokeRefreshToken(
  id: string,
  executor: Knex | Knex.Transaction,
): Promise<number> {
  return executor("refresh_tokens")
    .where("id", id)
    .whereNull("revoked_at")
    .update({
      revoked_at: executor.fn.now(3),
    });
}

export async function findRefreshTokenById(
  id: string,
  executor: Knex | Knex.Transaction,
): Promise<RefreshToken | null> {
  const row = await executor("refresh_tokens")
    .select(refreshTokenColumns)
    .where("id", id)
    .first();

  if (!row) {
    return null;
  }

  return mapRefreshToken(row);
}
