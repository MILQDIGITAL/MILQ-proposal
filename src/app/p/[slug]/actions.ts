"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getProposalBySlug, verifyPasscode } from "@/lib/proposals";
import { isRateLimited } from "@/lib/rate-limit";
import { unlockCookieName } from "@/lib/unlock-cookie";

export async function unlockProposal(slug: string, formData: FormData) {
  const passcode = String(formData.get("passcode") ?? "");
  const proposal = await getProposalBySlug(slug);

  if (!proposal) redirect(`/p/${slug}`);

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (isRateLimited(`passcode:${slug}:${ip}`, 5, 60 * 60 * 1000)) {
    redirect(`/p/${slug}?error=rate_limited`);
  }

  const ok = await verifyPasscode(proposal, passcode);
  if (!ok) {
    redirect(`/p/${slug}?error=incorrect`);
  }

  const jar = await cookies();
  jar.set(unlockCookieName(proposal.id), "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: `/p/${slug}`,
  });

  redirect(`/p/${slug}`);
}
