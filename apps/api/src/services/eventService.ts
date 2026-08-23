import type {CreateEventInput,} from "@event-planner/shared";

import {insertEvent, findEventById} from "../repositories/eventRepository.js";
import { NotFoundError } from "../errors/domainErrors.js";

export async function createEvent(
  input: CreateEventInput,
  userId: string,
) {
  return insertEvent({
    creatorId: userId,

    title: input.title,

    description: input.description,

    startsAt: new Date(input.startsAt),

    endsAt:
      input.endsAt === null ||
      input.endsAt === undefined
        ? null
        : new Date(input.endsAt),

    location: input.location,

    visibility: input.visibility,

    timezone: input.timezone,
  });
}

const PRIVATE_EVENT_NOT_FOUND_MESSAGE =
  "Event not found";

export async function getEvent(
  id: string,
  userId: string,
) {
  const event = await findEventById(id);

  if (!event) {
    throw new NotFoundError(
      PRIVATE_EVENT_NOT_FOUND_MESSAGE,
    );
  }

  if (
    event.visibility === "private" &&
    event.creatorId !== userId
  ) {
    throw new NotFoundError(
      PRIVATE_EVENT_NOT_FOUND_MESSAGE,
    );
  }

  return event;
}