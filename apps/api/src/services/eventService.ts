import type {CreateEventInput,} from "@event-planner/shared";

import {insertEvent,} from "../repositories/eventRepository.js";

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