import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("events", (table) => {
    table.index(["starts_at"], "idx_events_starts_at");
    table.index(["created_at"], "idx_events_created_at");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("events", (table) => {
    table.dropIndex(["starts_at"], "idx_events_starts_at");
    table.dropIndex(["created_at"], "idx_events_created_at");
  });
}
