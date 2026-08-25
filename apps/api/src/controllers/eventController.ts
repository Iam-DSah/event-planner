import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../errors/domainErrors.js";
import {
  createEventSchema,
  updateEventSchema,
  eventListQuerySchema,
} from "@event-planner/shared";
import {
  createEvent,
  getEvent,
  updateEvent,
  deleteEvent,
  listEvents,
} from "../services/eventService.js";
import { idParamSchema } from "../validation/params.js";

export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      throw new UnauthorizedError();
    }

    const input = createEventSchema.parse(req.body);

    const event = await createEvent(input, req.userId);

    res.status(201).json({
      event,
    });
  } catch (error) {
    next(error);
  }
}

export async function getById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      throw new UnauthorizedError();
    }

    const { id } = idParamSchema.parse(req.params);

    const event = await getEvent(id, req.userId);

    res.status(200).json({
      event,
    });
  } catch (error) {
    next(error);
  }
}

export async function update(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      throw new UnauthorizedError();
    }

    const { id } = idParamSchema.parse(req.params);

    const input = updateEventSchema.parse(req.body);

    const event = await updateEvent(id, input, req.userId);

    res.status(200).json({
      event,
    });
  } catch (error) {
    next(error);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      throw new UnauthorizedError();
    }

    const { id } = idParamSchema.parse(req.params);

    await deleteEvent(id, req.userId);

    // 204: the client already knows the id it deleted; there is no body worth
    // sending back. event_tags rows go with it via ON DELETE CASCADE.
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      throw new UnauthorizedError();
    }

    const query = eventListQuerySchema.parse(req.query);

    const { events, total } = await listEvents(query, req.userId);

    res.status(200).json({
      events,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
}
