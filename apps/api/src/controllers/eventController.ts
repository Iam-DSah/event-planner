import type {NextFunction, Request, Response,} from "express";
import {UnauthorizedError } from "../errors/domainErrors.js";
import {createEventSchema,} from "@event-planner/shared";
import {createEvent, getEvent} from "../services/eventService.js";
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

    const event = await createEvent(
      input,
      req.userId,
    );

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

    const event = await getEvent(
      id,
      req.userId,
    );

    res.status(200).json({
      event,
    });
  } catch (error) {
    next(error);
  }
}