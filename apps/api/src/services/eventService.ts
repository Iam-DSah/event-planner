import type { CreateEventInput, UpdateEventInput } from "@event-planner/shared";
import {
  insertEvent,
  findEventById,
  updateEvent as updateEventRepository,
  deleteEvent as deleteEventRepository,
} from "../repositories/eventRepository.js";
import {
  NotFoundError,
  ForbiddenError,
  EventValidationError,
} from "../errors/domainErrors.js";

export async function createEvent(input: CreateEventInput, userId: string) {
  return insertEvent({
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
  });
}

const EVENT_NOT_FOUND_MESSAGE = "Event not found";

export async function getEvent(id: string, userId: string) {
  const event = await findEventById(id);

  if (!event) {
    throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE);
  }

  if (event.visibility === "private" && event.creatorId !== userId) {
    throw new NotFoundError(EVENT_NOT_FOUND_MESSAGE);
  }

  return event;
}

async function getEventForMutation(id: string, userId: string) {
  const event = await findEventById(id);

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
  const event = await getEventForMutation(id, userId);

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

  return updateEventRepository(id, input);
}

export async function deleteEvent(id: string, userId: string): Promise<void> {
  // Same not-found / view / edit guards as update, so a second DELETE of the
  // same event answers 404 exactly as a GET of it would.
  await getEventForMutation(id, userId);

  await deleteEventRepository(id);
}
