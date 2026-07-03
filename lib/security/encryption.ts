import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

function base64UrlEncode(value: Buffer) {
  return value.toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function getEncryptionKey() {
  const rawKey = process.env.LEADDER_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error("Missing LEADDER_TOKEN_ENCRYPTION_KEY.");
  }

  const key = Buffer.from(rawKey, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error("LEADDER_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return key;
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(`${TOKEN_PREFIX}:`);
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX,
    base64UrlEncode(iv),
    base64UrlEncode(authTag),
    base64UrlEncode(ciphertext)
  ].join(":");
}

export function decryptSecret(ciphertextEnvelope: string) {
  const parts = ciphertextEnvelope.split(":");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
    throw new Error("Stored secret is not encrypted. Rotate the GHL token for this connection.");
  }

  const [, encodedIv, encodedAuthTag, encodedCiphertext] = parts;
  const iv = base64UrlDecode(encodedIv);
  const authTag = base64UrlDecode(encodedAuthTag);
  const ciphertext = base64UrlDecode(encodedCiphertext);

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
