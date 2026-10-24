/** Crockford's base 32, lower case, as the item id pattern needs. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * A lower-case ULID: 10 characters of time in milliseconds, then 16 random
 * ones. Ids made later sort later.
 */
export function ulid(time: number = Date.now()): string {
  let head = "";
  for (let t = time, i = 0; i < 10; i++, t = Math.floor(t / 32)) {
    head = ALPHABET[t % 32] + head;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let tail = "";
  for (const b of bytes) tail += ALPHABET[b % 32];
  return head + tail;
}
