
import db from "../db/knex.js";
import { EmailAlreadyRegisteredError } from "../errors/domainErrors.js";

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export async function createUser(
  input: CreateUserInput,
): Promise<User> {
  try {
    const [id] = await db("users").insert({
      name: input.name,
      email: input.email,
      password_hash: input.passwordHash,
    });

    const user = await db("users")
      .select("id", "name", "email")
      .where("id", id)
      .first();

    if (!user) {
      throw new Error("User was created but could not be retrieved");
    }

    return {
      id: String(user.id),
      name: user.name,
      email: user.email,
    };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      throw new EmailAlreadyRegisteredError();
    }

    throw error;
  }
}