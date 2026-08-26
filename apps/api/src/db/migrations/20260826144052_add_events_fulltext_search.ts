import type { Knex } from "knex";

/**
 * FULLTEXT(title, description, location) — the index D022 designed and
 * benchmarked before any search code existed.
 *
 * Raw SQL rather than knex.schema: FULLTEXT is MySQL-specific DDL, and the
 * exact index definition IS the decision here. Spelling it out keeps the thing
 * being argued about visible in the file that creates it.
 *
 * Why not LIKE '%term%', measured on 202,148 rows (D022):
 *
 *   page of 20, composed with the tag filter the endpoint actually applies
 *     LIKE,     date order        rare 31.6ms   common 28.8ms
 *     FULLTEXT, relevance order   rare  0.10ms  common  7.4ms
 *
 * LIKE is genuinely fast on a COMMON term alone — it walks idx_events_starts_at
 * in sort order and stops at 20 matches. The tag EXISTS join removes that early
 * exit, and then FULLTEXT wins in both regimes.
 *
 * It is also the only index that has ever helped the pager's COUNT, which D018
 * established is ~99% of a listing request's cost: 210ms -> 0.07ms on a rare
 * term.
 *
 * Write cost is a non-issue for THIS application's access pattern: ~3x on a
 * 20,000-row bulk INSERT, but unmeasurable across 500 single-row inserts
 * (4.10ms/row vs 4.15ms/row), and the API inserts one event per request.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE events
      ADD FULLTEXT INDEX ft_events_search (title, description, location)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE events DROP INDEX ft_events_search`);
}
