/** Image type detection from magic bytes. Pure module. */

export type SniffedImage = "image/png" | "image/jpeg" | "image/webp";

export const EXTENSION_BY_MIME: Record<SniffedImage, "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

export const ALLOWED_LOGO_MIME_TYPES: ReadonlySet<string> = new Set(Object.keys(EXTENSION_BY_MIME));

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** PNG, JPEG or WebP from the first bytes of a file; anything else is null. */
export function sniffImageMime(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}
