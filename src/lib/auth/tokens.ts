import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL- and cookie-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes. High-entropy tokens do not need a slow hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
