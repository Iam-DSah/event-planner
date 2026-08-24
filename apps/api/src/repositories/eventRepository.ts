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

function mapEvent(row: EventRow, tags: string[]): Event {
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
    tags,
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
    .select(
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
    )
    .where("id", id)
    .first();

  if (!row) {
    return null;
  }

  const tagsByEvent = await findTagsForEvents([id], executor);

  return mapEvent(row, tagsByEvent.get(id) ?? []);
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
