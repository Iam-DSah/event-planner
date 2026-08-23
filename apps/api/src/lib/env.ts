export function requireEnv(name: string, minLength?: number): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  if (minLength !== undefined && value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters long`);
  }

  return value;
}
