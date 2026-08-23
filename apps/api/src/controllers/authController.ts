import type { NextFunction, Request, Response } from "express";

import { registerSchema } from "@event-planner/shared";

import { registerUser } from "../services/authService.js";
import { signToken } from "../lib/jwt.js";

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
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.status(201).json({
      user,
    });
  } catch (error) {
    next(error);
  }
}
