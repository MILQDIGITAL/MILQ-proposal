"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminSessionValue } from "@/lib/admin-auth";
import { isRateLimited } from "@/lib/rate-limit";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(`admin-login:${ip}`, 10, 60 * 60 * 1000)) {
    redirect("/admin/login?error=rate_limited");
  }

  if (password !== process.env.TEMP_ADMIN_PASSWORD) {
    redirect("/admin/login?error=incorrect");
  }

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, await adminSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/admin",
  });

  redirect("/admin");
}

export async function logoutAction() {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}
