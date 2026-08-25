import type { NextFunction, Request, Response } from "express";
import { loginSchema, registerSchema } from "@event-planner/shared";
import { authenticateUser, registerUser } from "../services/authService.js";
import { signToken } from "../lib/jwt.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../lib/tokenTtl.js";

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
};

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = registerSchema.parse(req.body);

    const user = await registerUser(input);

    const token = signToken(String(user.id));

    res.cookie("access_token", token, {
      ...cookieOptions,
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });

    res.status(201).json({
      user,
    });
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

    const token = signToken(user.id);

    res.cookie("access_token", token, {
      ...cookieOptions,
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });

    res.status(200).json({
      user,
    });
  } catch (error) {
    next(error);
  }
}

export function logout(_req: Request, res: Response): void {
  res.clearCookie("access_token", cookieOptions);

  res.status(204).send();
}
