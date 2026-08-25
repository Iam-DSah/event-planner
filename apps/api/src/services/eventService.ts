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
  touchEvent,
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

async function runTransactionWithDeadlockRetry<T>(
  work: (trx: Knex.Transaction) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await db.transaction(work);
    } catch (error) {
      const isDeadlock =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_LOCK_DEADLOCK";

      if (!isDeadlock || attempt === maxAttempts) {
        throw error;
      }

      // Full jitter, growing with the attempt. Without a delay two
      // transactions that deadlocked together retry at the same instant and
      // can collide again, so more attempts alone would not help — separating
      // them in time is what breaks the cycle.
      const backoffMs = Math.random() * 20 * attempt;

      await new Promise((resolve) => setTimeout(resolve, backoffMs));

      console.warn(
        `Retrying transaction after ER_LOCK_DEADLOCK (attempt ${attempt} of ${maxAttempts})`,
      );
    }
  }

  throw new Error("Transaction retry failed");
}

export async function createEvent(
  input: CreateEventInput,
  userId: string,
): Promise<EventWithTags> {
  return runTransactionWithDeadlockRetry(async (trx) => {
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

    if (input.tags === undefined) {
      return {
        ...event,
        tags: [],
      };
    }

    const tags = await findOrCreateTags(input.tags, trx);

    await replaceEventTags(
      event.id,
      tags.map((tag) => String(tag.id)),
      trx,
    );

    return {
      ...event,
      tags: tags.map((tag) => tag.name),
    };
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
): Promise<EventWithTags> {
  return runTransactionWithDeadlockRetry(async (trx) => {
    // Read, decide and write inside ONE transaction (D014). Outside it, the row
    // could be deleted between the guard and the update — and on a retry the
    // guard would not re-run, so attempt 2 would write on attempt 1's decision.
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

    // An absent `tags` key leaves the tag set untouched, so the response has to
    // report the tags the event still has. Returning [] here would claim the
    // event has none while the rows are sitting in the database.
    if (input.tags === undefined) {
      return attachTags(updatedEvent, trx);
    }

    const tags = await findOrCreateTags(input.tags, trx);

    await replaceEventTags(
      id,
      tags.map((tag) => String(tag.id)),
      trx,
    );

    // Supplying `tags` always counts as a change, so `updated_at` moves even
    // when no `events` column did — knex skips an empty update, so MySQL's
    // ON UPDATE CURRENT_TIMESTAMP(3) would never fire. When a column *did*
    // change this rewrites the same instant, which is deliberate: cheaper than
    // working out whether the column update already fired it.
    await touchEvent(id, trx);

    // Re-read: `updatedEvent` was fetched before touchEvent moved updated_at,
    // so returning it would report a timestamp that was never true.
    const refreshed = await findEventById(id, trx);

    if (!refreshed) {
      throw new Error("Event was updated but could not be retrieved");
    }

    return {
      ...refreshed,
      tags: tags.map((tag) => tag.name),
    };
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
