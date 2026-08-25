import type { NextFunction, Request, Response } from "express";
import { loginSchema, registerSchema } from "@event-planner/shared";
import {
  authenticateUser,
  issueSession,
  registerUser,
  revokeSession,
  type SessionTokens,
  rotateSession,
} from "../services/authService.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "../lib/tokenTtl.js";
import { UnauthorizedError } from "../errors/domainErrors.js";

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
};

const ACCESS_COOKIE_OPTIONS = {
  ...cookieOptions,
  path: "/",
  maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
};

const REFRESH_COOKIE_PATH = "/api/v1/auth";

const REFRESH_COOKIE_OPTIONS = (refreshExpiresAt: Date) => ({
  ...cookieOptions,
  path: REFRESH_COOKIE_PATH,
  maxAge: Math.max(0, refreshExpiresAt.getTime() - Date.now()),
});

function setSessionCookies(res: Response, session: SessionTokens): void {
  res.cookie("access_token", session.accessToken, ACCESS_COOKIE_OPTIONS);

  res.cookie(
    "refresh_token",
    session.refreshToken,
    REFRESH_COOKIE_OPTIONS(session.refreshExpiresAt),
  );
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = registerSchema.parse(req.body);

    const user = await registerUser(input);

    const session = await issueSession(user.id);

    setSessionCookies(res, session);

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);

    const user = await authenticateUser(input);

    const session = await issueSession(user.id);

    setSessionCookies(res, session);

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const presented: string | undefined = req.cookies?.refresh_token;

    // Revoking the family is what makes logout mean something: clearing the
    // cookies only removes the browser's copy, and a refresh token captured
    // earlier would otherwise stay valid for its full 30 days.
    if (presented) {
      await revokeSession(presented);
    }

    // clearCookie only removes a cookie whose attributes match the ones it was
    // set with, so each path has to match what setSessionCookies used.
    res.clearCookie("access_token", {
      ...cookieOptions,
      path: "/",
    });

    res.clearCookie("refresh_token", {
      ...cookieOptions,
      path: REFRESH_COOKIE_PATH,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const presentedToken = req.cookies?.refresh_token;

    if (!presentedToken) {
      throw new UnauthorizedError();
    }

    const session = await rotateSession(presentedToken);

    setSessionCookies(res, session);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}