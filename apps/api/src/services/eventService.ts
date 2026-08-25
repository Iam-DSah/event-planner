import type {
  CreateEventInput,
  UpdateEventInput,
  EventListQueryInput,
} from "@event-planner/shared";
import type { Knex } from "knex";

import {
  findOrCreateTags,
  replaceEventTags,
} from "../repositories/tagRepository.js";

import {
  insertEvent,
  findEventById,
  attachTags,
  findEvents,
  countEvents,
  updateEvent as updateEventRepository,
  deleteEvent as deleteEventRepository,
} from "../repositories/eventRepository.js";
import type {
  EventListQuery,
  EventWithTags,
} from "../repositories/eventRepository.js";

import {
  NotFoundError,
  ForbiddenError,
  EventValidationError,
} from "../errors/domainErrors.js";

import db from "../db/knex.js";

export async function createEvent(input: CreateEventInput, userId: string) {
  return db.transaction(async (trx) => {
    const event = await insertEvent(
      {
        creatorId: userId,
        title: input.title,
        description: input.description,
        startsAt: new Date(input.startsAt),
        endsAt:
          input.endsAt === null || input.endsAt === undefined
            ? null
            : new Date(input.endsAt),
        location: input.location,
        visibility: input.visibility,
        timezone: input.timezone,
      },
      trx,
    );

    if (input.tags !== undefined) {
      const tagIds = await findOrCreateTags(input.tags, trx);

      await replaceEventTags(event.id, tagIds, trx);
    }

    const result = await findEventById(event.id, trx);

    if (!result) {
      throw new Error("Event was created but could not be retrieved");
    }

    return attachTags(result, trx);
  });
}

const EVENT_NOT_FOUND_MESSAGE = "Event not found";

export async function getEvent(id: string, userId: string) {
  const event = await findEventById(id, db);

  if (!event) {
    throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE);
  }

  if (event.visibility === "private" && event.creatorId !== userId) {
    throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE);
  }

  // Tags load only now. Before the guards above, the extra query made an event
  // that exists measurably slower than one that does not — see attachTags.
  return attachTags(event, db);
}

async function getEventForMutation(
  id: string,
  userId: string,
  executor: Knex | Knex.Transaction,
) {
  const event = await findEventById(id, executor);

  if (!event) {
    throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE);
  }

  // Never reveal the existence of another user's private event.
  if (event.visibility === "private" && event.creatorId !== userId) {
    throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE);
  }

  if (event.creatorId !== userId) {
    throw new ForbiddenError();
  }

  return event;
}

export async function updateEvent(
  id: string,
  input: UpdateEventInput,
  userId: string,
) {
  return db.transaction(async (trx) => {
    const event = await getEventForMutation(id, userId, trx);

    const nextStartsAt =
      input.startsAt !== undefined ? new Date(input.startsAt) : event.startsAt;

    const nextEndsAt =
      input.endsAt !== undefined
        ? input.endsAt === null
          ? null
          : new Date(input.endsAt)
        : event.endsAt;

    if (nextEndsAt !== null && nextEndsAt <= nextStartsAt) {
      throw new EventValidationError("endsAt must be after startsAt", "endsAt");
    }

    const updatedEvent = await updateEventRepository(id, input, trx);

    if (input.tags !== undefined) {
      const tagIds = await findOrCreateTags(input.tags, trx);

      await replaceEventTags(id, tagIds, trx);
    }

    const result = await findEventById(id, trx);

    if (!result) {
      throw new Error("Event was updated but could not be retrieved");
    }

    return attachTags(result, trx);
  });
}

export async function deleteEvent(id: string, userId: string): Promise<void> {
  // Same not-found / view / edit guards as update, so a second DELETE of the
  // same event answers 404 exactly as a GET of it would.
  await getEventForMutation(id, userId, db);

  await deleteEventRepository(id);
}

export async function listEvents(
  query: EventListQueryInput,
  userId: string,
): Promise<{ events: EventWithTags[]; total: number }> {
  const now = new Date();
  const offset = (query.page - 1) * query.limit;

  const repositoryQuery: EventListQuery = {
    viewerId: userId,
    now,
    visibility: query.visibility,
    when: query.when === "all" ? undefined : query.when,
    tags: query.tags,
    sort: query.sort,
    order: query.order,
    limit: query.limit,
    offset,
  };

  const [events, total] = await Promise.all([
    findEvents(repositoryQuery),
    countEvents(repositoryQuery),
  ]);

  return { events, total };
}
