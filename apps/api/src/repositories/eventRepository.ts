import db from "../db/knex.js";

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
  visibility: "public" | "private";
  timezone: string;
}

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
): Promise<Event> {
  const [id] = await db("events").insert({
    creator_id: input.creatorId,
    title: input.title,
    description: input.description,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    location: input.location,
    visibility: input.visibility,
    timezone: input.timezone,
  });

  const event = await findEventById(String(id));

  if (!event) {
    throw new Error(
      "Event was created but could not be retrieved",
    );
  }

  return event;
}

export async function findEventById(
  id: string,
): Promise<Event | null> {
  const row = await db("events")
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

  return mapEvent(row as EventRow);
}