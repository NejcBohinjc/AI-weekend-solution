import { hash, verify } from "@node-rs/argon2";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-rules";
// PASSWORD_MAX_LENGTH is an upper bound so a huge input cannot be used to make hashing expensive.

// argon2id with the library defaults (m=19 MiB, t=2, p=1), which match OWASP's recommendation.
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Returns an error message, or null if the password is acceptable. */
export function checkPasswordRules(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. When there is no stored hash (unknown email, or no password yet)
 * it still runs a full argon2 verification, so response time does not reveal which emails exist.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  if (!storedHash) {
    dummyHash ??= hash("dummy-password-for-timing");
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
