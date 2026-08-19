import "server-only";

export const ADMIN_COOKIE = "mp_admin";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The value stored in the admin cookie once a session is established: a hash of the shared
 * temporary password, never the password itself. This is a stand-in for real auth — phase 3
 * replaces it with Supabase Auth restricted to @milqdigital.co (BUILD_SPEC.md §5, §12).
 */
export function adminSessionValue(): Promise<string> {
  const password = process.env.TEMP_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("TEMP_ADMIN_PASSWORD environment variable is not set.");
  }
  return sha256Hex(password);
}
