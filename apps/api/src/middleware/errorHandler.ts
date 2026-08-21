import type { ErrorRequestHandler } from "express";
import {
  ForbiddenError,
  NotFoundError,
} from "../errors/domainErrors.js";

type ErrorMapping = {
  matches: (error: unknown) => boolean;
  status: number;
};

const errorMappings: ErrorMapping[] = [
  // More specific errors should come first.
  {
    matches: (error) => error instanceof NotFoundError,
    status: 404,
  },
  {
    matches: (error) => error instanceof ForbiddenError,
    status: 403,
  },
];

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const mapping = errorMappings.find((entry) => entry.matches(err));

  if (mapping) {
    const error = err as Error & { code: string };

    console.warn(error.message);

    return res.status(mapping.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  // Unexpected errors: log the full stack.
  console.error(err);

  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
    },
  });
};