import { randomBytes, timingSafeEqual } from 'node:crypto';

/** A long random secret that goes in the confirmation link. Knowing a booking reference alone is not enough to open it. */
export const newAccessKey = () => randomBytes(18).toString('base64url');          // 24 characters, 144 bits

export const REF_PATTERN = /^GYST-\d{8}-[0-9A-F]{6}$/;
export const KEY_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

/** Compares the stored secret with the one in the link without leaking how much of it matched. */
export function keyMatches(stored: unknown, given: unknown): boolean {
  if (typeof stored !== 'string' || typeof given !== 'string' || !stored || stored.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(given));
}
