import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque session token for the cookie. Only its hash is stored. */
export const newSessionToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Stateless CSRF token bound to the session and a server secret. */
export const csrfTokenFor = (secret: string, tokenHash: string) =>
  createHmac("sha256", secret).update(`csrf:${tokenHash}`).digest("hex");

export function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
