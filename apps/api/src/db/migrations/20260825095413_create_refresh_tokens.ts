import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("refresh_tokens", (table) => {
    table.charset("utf8mb4");
    table.collate("utf8mb4_0900_ai_ci");

    table.bigIncrements("id").unsigned().primary();

    table
      .bigInteger("user_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");

    // SHA-256 hash of the opaque refresh token.
    // The token itself is never stored in the database.
    table.string("token_hash", 64).notNullable().unique();

    // All tokens issued by one login/rotation chain share a family_id.
    // Used to revoke the entire family when token reuse is detected.

    table.uuid("family_id").notNullable();

    table.dateTime("expires_at", { precision: 3 }).notNullable();

    // Set when this token is exchanged for a new one. Distinct from
    // revoked_at: "used normally" and "killed because the family was
    // compromised" are different facts, and reuse detection plus the grace
    // window both measure from this one.
    table.dateTime("used_at", { precision: 3 }).nullable();

    // Set by logout, and by family revocation on detected reuse.
    table.dateTime("revoked_at", { precision: 3 }).nullable();

    // Plain column intentionally: the service owns all writes to this
    // relationship, so a self-referencing FK is unnecessary.
    table.bigInteger("replaced_by_id").unsigned().nullable();

    table
      .dateTime("created_at", { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));

    // Needed for revoke-family:
    // WHERE family_id = ?
    table.index(["family_id"], "idx_refresh_tokens_family_id");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("refresh_tokens");
}
