import type { Knex } from "knex";

import { LIKE_ESCAPE, likePattern, planSearch } from "../lib/searchQuery.js";
import db from "../db/knex.js";
import { findTagsForEvents } from "./tagRepository.js";
import type { UpdateEventInput } from "@event-planner/shared";

export interface Event {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string;
  visibility: "public" | "private";
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An event plus its tags. Kept separate from `Event` on purpose: loading tags
 * costs a second query, and it must not happen until the caller has decided
 * the viewer is allowed to see the event at all. See `attachTags`.
 */
export interface EventWithTags extends Event {
  tags: string[];
}

interface EventRow {
  id: number | string;
  creator_id: number | string;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  location: string;
  visibility: "public" | "private";
  timezone: string;
  created_at: Date;
  updated_at: Date;
}

interface InsertEventInput {
  creatorId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string;
  visibility?: "public" | "private";
  timezone: string;
}

const eventColumns = [
  "id",
  "creator_id",
  "title",
  "description",
  "starts_at",
  "ends_at",
  "location",
  "visibility",
  "timezone",
  "created_at",
  "updated_at",
] as const;

function mapEvent(row: EventRow): Event {
  return {
    id: String(row.id),
    creatorId: String(row.creator_id),
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    visibility: row.visibility,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertEvent(
  input: InsertEventInput,
  trx: Knex.Transaction,
): Promise<Event> {
  const [id] = await trx("events").insert({
    creator_id: input.creatorId,
    title: input.title,
    description: input.description,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    location: input.location,
    visibility: input.visibility,
    timezone: input.timezone,
  });

  const event = await findEventById(String(id), trx);

  if (!event) {
    throw new Error("Event was created but could not be retrieved");
  }

  return event;
}

export async function findEventById(
  id: string,
  executor: Knex | Knex.Transaction,
): Promise<Event | null> {
  const row = await executor("events")
    .select(eventColumns)
    .where("id", id)
    .first();

  if (!row) {
    return null;
  }

  return mapEvent(row);
}

/**
 * Loads an event's tags. Call this only AFTER the viewer has been authorized.
 *
 * Doing it inside `findEventById` made an event that exists cost two queries
 * while a missing id cost one, and that difference is observable: a private
 * event answered 404 in a median 3.93ms against 2.80ms for an id that never
 * existed, with non-overlapping quartiles. The bodies were byte-identical and
 * the stopwatch still told you which ids exist — exactly what the 404 hides.
 */
export async function attachTags(
  event: Event,
  executor: Knex | Knex.Transaction,
): Promise<EventWithTags> {
  const tagsByEvent = await findTagsForEvents([event.id], executor);

  return { ...event, tags: tagsByEvent.get(event.id) ?? [] };
}

type EventSort = "startsAt" | "createdAt" | "relevance";

export interface EventListWhereFilters {
  viewerId: string;
  now: Date;
  visibility?: "public" | "private";
  when?: "upcoming" | "past";
  tags: string[];
  mine: boolean;
  q?: string;
}

export interface EventListQuery extends EventListWhereFilters {
  sort: EventSort;
  order: "asc" | "desc";
  limit: number;
  offset: number;
}

/**
 * Only the column-backed sorts. "relevance" is deliberately absent: it is an
 * expression, not a column, so a Record<EventSort, ...> would force a fake
 * entry here and the compiler would stop objecting when someone indexes into
 * it with "relevance" and gets a column name that means nothing.
 */
const sortColumns: Record<
  "startsAt" | "createdAt",
  "starts_at" | "created_at"
> = {
  startsAt: "starts_at",
  createdAt: "created_at",
};

/**
 * Written once and used by BOTH the WHERE and the ORDER BY. MySQL reuses a
 * single FULLTEXT scan only when the two expressions are identical, and a
 * constant is also the only way to guarantee they cannot drift apart later.
 */
const SEARCH_MATCH =
  "MATCH(events.title, events.description, events.location) " +
  "AGAINST(? IN BOOLEAN MODE)";

function applyEventListFilters(
  query: Knex.QueryBuilder,
  filters: EventListWhereFilters,
): Knex.QueryBuilder {
  // The ownership clause is UNCONDITIONAL and grouped. Grouped, because a bare
  // OR would swallow every AND below it and hand back the whole table;
  // unconditional, so that no later filter — including `mine` — can be the
  // reason it was skipped. When mine is set this makes the predicate
  // (public OR creator = me) AND creator = me, which is redundant but cannot
  // be wrong; narrowing it would trade a safety invariant for nothing.
  query.where(function () {
    this.where("visibility", "public").orWhere("creator_id", filters.viewerId);
  });

  if (filters.mine) {
    query.where("creator_id", filters.viewerId);
  }

  // THE TRAP D022 named: this belongs in applyEventListFilters, the single
  // WHERE builder that findEvents AND countEvents both call. Adding it to only
  // the row query leaves `total` counting unsearched rows — the pager reports
  // a number the list can never reach, and nothing errors.
  if (filters.q !== undefined) {
    const plan = planSearch(filters.q);

    // Indexable tokens still go through the FULLTEXT index even when the query
    // ALSO contains a short one: "AI Conference" narrows on `Conference` here
    // and filters the survivors with LIKE below, rather than abandoning the
    // index for the whole query the way a mode switch would.
    if (plan.fulltext !== "") {
      query.whereRaw(SEARCH_MATCH, [plan.fulltext]);
    }

    // One grouped OR per short token, ANDed together — the same "every term
    // required, any order" semantics as the FULLTEXT half, so which path a
    // query takes is invisible in its results.
    for (const token of plan.like) {
      const pattern = likePattern(token);

      query.where(function () {
        this.whereRaw(`events.title LIKE ? ESCAPE '${LIKE_ESCAPE}'`, [pattern])
          .orWhereRaw(`events.description LIKE ? ESCAPE '${LIKE_ESCAPE}'`, [
            pattern,
          ])
          .orWhereRaw(`events.location LIKE ? ESCAPE '${LIKE_ESCAPE}'`, [
            pattern,
          ]);
      });
    }

    // A query of pure punctuation leaves nothing to match on. This used to be
    // free — AGAINST('') returns no rows — but with the plan split, adding no
    // predicate at all would return EVERYTHING to someone who searched.
    if (plan.fulltext === "" && plan.like.length === 0) {
      query.whereRaw("1 = 0");
    }
  }

  if (filters.visibility !== undefined) {
    query.where("visibility", filters.visibility);
  }

  if (filters.when === "upcoming") {
    query.where("starts_at", ">=", filters.now);
  } else if (filters.when === "past") {
    query.where("starts_at", "<", filters.now);
  }

  for (const tag of filters.tags) {
    query.whereExists(function () {
      this.select(db.raw("1"))
        .from("event_tags")
        .join("tags", "tags.id", "event_tags.tag_id")
        .whereRaw("event_tags.event_id = events.id")
        .where("tags.name", tag);
    });
  }

  return query;
}

export async function findEvents(
  filters: EventListQuery,
): Promise<EventWithTags[]> {
  const query = db("events").select(eventColumns);

  applyEventListFilters(query, filters);

  if (filters.sort === "relevance") {
    // orderByRaw because the sort key is an expression. `direction` is mapped
    // from a validated enum rather than interpolated from input, and the
    // search text stays a bound parameter.
    const direction = filters.order === "desc" ? "desc" : "asc";

    const fulltext = planSearch(filters.q ?? "").fulltext;

    if (fulltext === "") {
      // Nothing indexable to rank — an all-LIKE query scores 0 for every row,
      // so ordering by it would be ordering by a constant. Fall back to the
      // list's normal ordering rather than pretending to rank.
      query.orderBy("starts_at", filters.order);
    } else {
      query.orderByRaw(`${SEARCH_MATCH} ${direction}`, [fulltext]);
    }
  } else {
    query.orderBy(sortColumns[filters.sort], filters.order);
  }

  /**
   * The `id` tiebreaker is kept for relevance too, and it is NOT free.
   * Measured on 415 matching rows:
   *
   *   ORDER BY relevance DESC, id DESC   Using filesort                 3.93ms
   *   ORDER BY relevance DESC            Ft_hints: sorted, limit = 20   1.78ms
   *
   * Without a second key MySQL pushes the sort AND the limit into the FULLTEXT
   * scan. With one it materialises every match and sorts — which is precisely
   * the 4.2ms vs 66ms gap D022 measured at 200k rows.
   *
   * Kept anyway: relevance scores tie constantly, MySQL guarantees no order
   * among ties, and offset pagination over an unstable sort silently repeats
   * and skips rows between pages. A user sees that; they do not see 60ms.
   * Dropping it only for relevance would also make this the one sort in the
   * app without a deterministic key.
   *
   * The upgrade that removes the trade-off entirely is keyset pagination on
   * (score, id) rather than OFFSET — the same conclusion D018 reached about
   * offset paging generally, and the same reason it was not built.
   */
  query
    .orderBy("id", filters.order)
    .limit(filters.limit)
    .offset(filters.offset);

  const rows = await query;

  if (rows.length === 0) {
    return [];
  }

  const events = rows.map((row) => mapEvent(row));

  const eventIds = events.map((event) => event.id);

  const tagsByEventId = await findTagsForEvents(eventIds, db);

  return events.map((event) => ({
    ...event,
    tags: tagsByEventId.get(event.id) ?? [],
  }));
}

export async function countEvents(
  filters: EventListWhereFilters,
): Promise<number> {
  const query = db("events").count<{ count: string }[]>({
    count: "*",
  });

  applyEventListFilters(query, filters);

  const row = await query.first();

  return Number(row?.count ?? 0);
}

export async function updateEvent(
  id: string,
  input: UpdateEventInput,
  trx: Knex.Transaction,
): Promise<Event> {
  const updates: Record<string, unknown> = {};

  if (input.title !== undefined) {
    updates.title = input.title;
  }

  if (input.description !== undefined) {
    updates.description = input.description;
  }

  if (input.startsAt !== undefined) {
    updates.starts_at = new Date(input.startsAt);
  }

  if (input.endsAt !== undefined) {
    updates.ends_at = input.endsAt === null ? null : new Date(input.endsAt);
  }

  if (input.location !== undefined) {
    updates.location = input.location;
  }

  if (input.visibility !== undefined) {
    updates.visibility = input.visibility;
  }

  if (input.timezone !== undefined) {
    updates.timezone = input.timezone;
  }

  if (Object.keys(updates).length > 0) {
    await trx("events").where("id", id).update(updates);
  }

  const event = await findEventById(id, trx);

  if (!event) {
    throw new Error("Event was updated but could not be retrieved");
  }

  return event;
}

export async function deleteEvent(id: string): Promise<void> {
  await db("events").where("id", id).del();
}

export async function touchEvent(
  id: string,
  trx: Knex.Transaction,
): Promise<void> {
  await trx("events")
    .where("id", id)
    .update({
      updated_at: trx.fn.now(3),
    });
}
