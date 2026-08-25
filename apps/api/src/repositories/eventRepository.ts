import type { Knex } from "knex";
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

type EventSort = "startsAt" | "createdAt";

export interface EventListWhereFilters {
  viewerId: string;
  now: Date;
  visibility?: "public" | "private";
  when?: "upcoming" | "past";
  tags: string[];
}

export interface EventListQuery extends EventListWhereFilters {
  sort: EventSort;
  order: "asc" | "desc";
  limit: number;
  offset: number;
}

const sortColumns: Record<EventSort, "starts_at" | "created_at"> = {
  startsAt: "starts_at",
  createdAt: "created_at",
};

function applyEventListFilters(
  query: Knex.QueryBuilder,
  filters: EventListWhereFilters,
): Knex.QueryBuilder {
  query.where(function () {
    this.where("visibility", "public").orWhere("creator_id", filters.viewerId);
  });

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

  const sortColumn = sortColumns[filters.sort];

  query
    .orderBy(sortColumn, filters.order)
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
