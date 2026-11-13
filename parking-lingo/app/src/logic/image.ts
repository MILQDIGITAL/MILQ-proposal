/** Image sizing maths (pure). */

/**
 * Size to resize to so the long edge is at most `maxLongEdge`, preserving aspect ratio.
 * Returns only the dimension to constrain (the other is derived by the manipulator),
 * or null if the image is already small enough.
 */
export function fitLongEdge(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0)) return { width: maxLongEdge };
  if (Math.max(width, height) <= maxLongEdge) return null;
  return width >= height ? { width: maxLongEdge } : { height: maxLongEdge };
}

/** Approximate decoded byte size of a base64 string. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export const UPLOAD_LONG_EDGE = 1600;
export const UPLOAD_QUALITY = 0.7;
export const THUMB_LONG_EDGE = 320;
export const THUMB_QUALITY = 0.5;
