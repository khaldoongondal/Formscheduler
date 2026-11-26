import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Crypto-safe random suffix from a-z and 0-9. */
export function randomSuffix(length = 6): string {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += ALPHABET[randomInt(ALPHABET.length)];
  }
  return result;
}
