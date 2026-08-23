import type { RegisterInput } from "@event-planner/shared";

import {
  hashPassword,
} from "../lib/password.js";

import {
  createUser,
  type User,
} from "../repositories/userRepository.js";

export async function registerUser(
  input: RegisterInput,
): Promise<User> {
  const passwordHash = await hashPassword(input.password);

  return createUser({
    name: input.name,
    email: input.email,
    passwordHash,
  });
}