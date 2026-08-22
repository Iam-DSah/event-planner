import { hash, verify, Algorithm } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hashValue: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(hashValue, plain);
  } catch (error) {
    console.error("Password hash verification failed:", error);
    return false;
  }
}