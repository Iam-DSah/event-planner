import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE events
      ADD FULLTEXT INDEX ft_events_search (title, description, location)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE events DROP INDEX ft_events_search`);
}
