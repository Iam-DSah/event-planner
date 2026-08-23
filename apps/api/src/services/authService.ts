import type { LoginInput, RegisterInput } from "@event-planner/shared";

import { hashPassword, verifyPassword } from "../lib/password.js";

import {
  createUser,
  findUserForLoginByEmail,
  type User,
} from "../repositories/userRepository.js";

import { UnauthorizedError } from "../errors/domainErrors.js";

const DUMMY_HASH = await hashPassword("dummy-password-for-login-timing");

export async function registerUser(input: RegisterInput): Promise<User> {
  const passwordHash = await hashPassword(input.password);

  return createUser({
    name: input.name,
    email: input.email,
    passwordHash,
  });
}

export async function authenticateUser(input: LoginInput): Promise<User> {
  const user = await findUserForLoginByEmail(input.email);

  if (!user) {
    await verifyPassword(DUMMY_HASH, input.password);

    console.warn("Authentication failed: unknown email");

    throw new UnauthorizedError();
  }

  const valid = await verifyPassword(user.passwordHash, input.password);

  if (!valid) {
    console.warn("Authentication failed: invalid password");

    throw new UnauthorizedError();
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}
