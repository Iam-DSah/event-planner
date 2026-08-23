import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import {
  EmailAlreadyRegisteredError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../errors/domainErrors.js";

type ErrorMapping = {
  matches: (error: unknown) => boolean;
  status: number;
  code: string;
};

const errorMappings: ErrorMapping[] = [
  // More specific errors should come first.
  {
    matches: (error) => error instanceof NotFoundError,
    status: 404,
    code: "NOT_FOUND",
  },
  {
    matches: (error) => error instanceof ForbiddenError,
    status: 403,
    code: "FORBIDDEN",
  },
  {
    matches: (error) => error instanceof EmailAlreadyRegisteredError,
    status: 409,
    code: "EMAIL_ALREADY_REGISTERED",
  },
];

const exposedStatusCodes: Record<number, string> = {
  400: "BAD_REQUEST",
  413: "PAYLOAD_TOO_LARGE",
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // 1. Domain errors: our application owns the contract.
  const mapping = errorMappings.find((entry) => entry.matches(err));

  if (mapping) {
    const error = err as Error;

    console.warn(error.message);

    return res.status(mapping.status).json({
      error: {
        code: mapping.code,
        message: error.message,
      },
    });
  }

  // 2. Expected client errors from libraries.
  if (
    err?.expose === true &&
    typeof err?.status === "number" &&
    err.status >= 400 &&
    err.status < 500
  ) {
    const code = exposedStatusCodes[err.status];

    if (code) {
      console.warn(
        `Client error: status=${err.status} code=${code} message=${err.message}`,
      );

      return res.status(err.status).json({
        error: {
          code,
          message: err.message,
        },
      });
    }

    console.warn(
      `Unmapped exposed client error: status=${err.status} ` +
        `name=${err.name} type=${err.type ?? "unknown"} ` +
        `message=${err.message}`,
    );

    return res.status(err.status).json({
      error: {
        code: "CLIENT_ERROR",
        message: "Request could not be processed",
      },
    });
  }

  // 3. Authentication errors.
  if (err instanceof UnauthorizedError) {
    console.warn(`Authentication failure: ${err.message}`);

    return res.status(401).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  // 4. Validation errors.
  if (err instanceof ZodError) {

    console.warn("Request validation failed:", err.issues);

    const fields: Record<string, string[]> = {};

    for (const issue of err.issues) {
      const field = issue.path.join(".");

      if (!fields[field]) {
        fields[field] = [];
      }

      fields[field].push(issue.message);
    }

    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        fields,
      },
    });
  }

  // 5. Everything else is an unexpected server error.
  console.error(err);

  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
    },
  });
};
