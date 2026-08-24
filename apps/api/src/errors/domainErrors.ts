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

export class UnauthorizedError extends Error {
  readonly code: "UNAUTHORIZED" | "TOKEN_EXPIRED";

  constructor(
    code: "UNAUTHORIZED" | "TOKEN_EXPIRED" = "UNAUTHORIZED",
    message = "Invalid authentication credentials",
  ) {
    super(message);
    this.name = "UnauthorizedError";
    this.code = code;
  }
}

export class EmailAlreadyRegisteredError extends Error {
  readonly code = "EMAIL_ALREADY_REGISTERED";

  constructor() {
    super("An account with this email already exists.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class EventValidationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = "EventValidationError";
    this.field = field;
  }
}
