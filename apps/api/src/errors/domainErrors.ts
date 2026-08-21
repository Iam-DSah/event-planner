export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";

  constructor(message = "You are not allowed to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

