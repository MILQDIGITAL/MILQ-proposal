import "server-only";
import { createHash } from "node:crypto";

/** sha256 of a proposal's content_html, hex-encoded. Used to prove a document wasn't altered. */
export function contentHash(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}
