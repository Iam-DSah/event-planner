import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // 1. Users
  await knex.schema.createTable("users", (table) => {
    // Stated explicitly rather than inherited from the database default.
    // utf8mb4_0900_ai_ci is case-insensitive,
    // which is what makes UNIQUE(email) reject "Alice@x.com" when
    // "alice@x.com" exists. Inheriting it would mean the schema behaves
    // differently on a differently-configured MySQL.
    table.charset("utf8mb4");
    table.collate("utf8mb4_0900_ai_ci");

    table.bigIncrements("id").unsigned().primary();

    table.string("name", 100).notNullable();

    table.string("email", 255).notNullable().unique();

    table.string("password_hash", 255).notNullable();

    table
      .dateTime("created_at", { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));

    table
      .dateTime("updated_at", { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
  });

  // 2. Tags
  await knex.schema.createTable("tags", (table) => {
    table.charset("utf8mb4");
    table.collate("utf8mb4_0900_ai_ci");

    table.bigIncrements("id").unsigned().primary();

    table.string("name", 50).notNullable().unique();

    table
      .dateTime("created_at", { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));
  });

  // 3. Events
  await knex.schema.createTable("events", (table) => {
    table.charset("utf8mb4");
    table.collate("utf8mb4_0900_ai_ci");

    table.bigIncrements("id").unsigned().primary();

    table
      .bigInteger("creator_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");

    table.string("title", 200).notNullable();

    table.text("description").nullable();

    table.dateTime("starts_at").notNullable();

    table.dateTime("ends_at").nullable();

    table.string("location", 255).notNullable();

    table
      .enum("visibility", ["public", "private"])
      .notNullable()
      .defaultTo("public");

    table.string("timezone", 64).notNullable();

    table
      .dateTime("created_at", { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));

    table
      .dateTime("updated_at", { precision: 3 })
      .notNullable()
      .defaultTo(knex.raw("CURRENT_TIMESTAMP(3)"));

    table.check(
      "ends_at IS NULL OR ends_at > starts_at",
      [],
      "chk_events_ends_at",
    );

    // Indexes.
    //
    // Rule: equality columns first, then the range/sort column. A composite
    // index on (a, b) is sorted by a, and by b within each a — so an equality
    // match on a lands on a contiguous block already sorted by b, and the
    // range filter and the ORDER BY both come free.
    //
    // The main browse query: public events, upcoming or past, in date order.
    table.index(["visibility", "starts_at"], "idx_events_visibility_starts_at");

    // "My events": filtered by owner, sorted by date. Note InnoDB already
    // creates an index on creator_id to enforce the foreign key; this one
    // supersedes it for queries that also sort by date.
    table.index(["creator_id", "starts_at"], "idx_events_creator_starts_at");
  });

  await knex.schema.createTable("event_tags", (table) => {
    table
      .bigInteger("event_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("events")
      .onDelete("CASCADE");

    table
      .bigInteger("tag_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("tags")
      .onDelete("CASCADE");

    table.primary(["event_id", "tag_id"]);

    table.index(["tag_id"], "idx_event_tags_tag_id");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("event_tags");
  await knex.schema.dropTableIfExists("events");
  await knex.schema.dropTableIfExists("tags");
  await knex.schema.dropTableIfExists("users");
}
