import type { SupportedMediaType } from "./signReader";
import { ApiError } from "./errors";

/** Media types Claude vision accepts for base64 images. */
export const SUPPORTED_MEDIA_TYPES: readonly SupportedMediaType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Formats an iPhone can produce that Claude does not accept; the app must convert to JPEG first. */
const KNOWN_UNSUPPORTED = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence", "image/avif", "image/tiff"]);

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Accept common aliases ("image/jpg", "JPEG"). Returns null if unknown. */
export function normaliseMediaType(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (t === "image/jpg" || t === "jpg" || t === "jpeg") return "image/jpeg";
  if (t === "png" || t === "webp" || t === "gif" || t === "heic" || t === "heif") return `image/${t}`;
  return t;
}

/** Detect the real format from magic bytes. */
export function sniffImageType(bytes: Uint8Array): SupportedMediaType | "image/heic" | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand)) return "image/heic";
  }
  return null;
}

export interface CheckedImage {
  base64: string;
  mediaType: SupportedMediaType;
  bytes: number;
}

/**
 * Validate an uploaded image: supported type, valid base64, size limit, and that the
 * bytes really are the declared format (the API rejects mismatches).
 */
export function checkImage(input: { base64: string; mediaType: string }, maxBytes: number): CheckedImage {
  const declared = normaliseMediaType(input.mediaType);
  if (KNOWN_UNSUPPORTED.has(declared)) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      `${declared} is not supported. Convert the photo to JPEG (recommended) or PNG/WebP before uploading.`,
    );
  }
  if (!(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(declared)) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      `Unsupported mediaType "${input.mediaType}". Use one of: ${SUPPORTED_MEDIA_TYPES.join(", ")}.`,
    );
  }

  // Tolerate a data: URL prefix and whitespace/newlines from encoders.
  let b64 = input.base64.trim();
  const comma = b64.startsWith("data:") ? b64.indexOf(",") : -1;
  if (comma >= 0) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  if (b64.length === 0 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
    throw new ApiError(400, "image_invalid", "image.base64 is not valid base64.");
  }
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = (b64.length / 4) * 3 - padding;
  if (bytes > maxBytes) {
    throw new ApiError(
      413,
      "image_too_large",
      `Image is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${(maxBytes / 1024 / 1024).toFixed(1)} MB. ` +
        "Resize to at most 2576 px on the long edge and re-encode as JPEG (quality ~0.8).",
    );
  }

  const head = Buffer.from(b64.slice(0, 32), "base64");
  const actual = sniffImageType(head);
  if (actual === "image/heic") {
    throw new ApiError(415, "unsupported_media_type", "The image data is HEIC/HEIF, which is not supported. Convert to JPEG.");
  }
  if (actual === null) {
    throw new ApiError(400, "image_invalid", "image.base64 does not contain a JPEG, PNG, WebP or GIF image.");
  }
  return { base64: b64, mediaType: actual, bytes };
}
