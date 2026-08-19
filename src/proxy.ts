import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminSessionValue } from "@/lib/admin-auth";

export async function proxy(request: NextRequest) {
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  const expected = await adminSessionValue();

  if (cookie === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin", "/admin/((?!login).*)"],
};
