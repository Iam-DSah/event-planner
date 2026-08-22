import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import { verifyToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../errors/domainErrors.js";

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const token = req.cookies?.access_token;

    if (!token) {
      throw new UnauthorizedError();
    }

    const payload = verifyToken(token);

    req.userId = payload.sub;

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }

    console.warn("Token verification failed:", error);

    if (error instanceof jwt.TokenExpiredError) {
      next(
        new UnauthorizedError(
          "TOKEN_EXPIRED",
          "Authentication token expired",
        ),
      );
      return;
    }

    next(new UnauthorizedError());
  }
}