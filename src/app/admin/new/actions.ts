"use server";

import { redirect } from "next/navigation";
import {
  createDraftProposal,
  type ProposalStream,
} from "@/lib/proposals";

const STREAMS: ProposalStream[] = ["ecommerce", "project", "retainer", "seo"];

function requireString(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

export async function createProposalAction(formData: FormData) {
  const client_name = requireString(formData, "client_name");
  const client_company = requireString(formData, "client_company");
  const title = requireString(formData, "title");
  const stream = requireString(formData, "stream") as ProposalStream;
  const owner_email = requireString(formData, "owner_email");
  const content_html = requireString(formData, "content_html");
  const terms_version = requireString(formData, "terms_version");

  if (!STREAMS.includes(stream)) {
    throw new Error(`Invalid stream: ${stream}`);
  }
  if (!owner_email.endsWith("@milqdigital.co")) {
    throw new Error("owner_email must be a @milqdigital.co address.");
  }
  if (content_html.includes("[[TBC]]")) {
    throw new Error(
      "content_html still contains a [[TBC]] placeholder — resolve it before publishing."
    );
  }

  const valueRaw = formData.get("value_aud");
  const value_aud =
    typeof valueRaw === "string" && valueRaw.trim() !== ""
      ? Number(valueRaw)
      : null;

  const expiresRaw = formData.get("expires_in_days");
  const expires_in_days =
    typeof expiresRaw === "string" && expiresRaw.trim() !== ""
      ? Number(expiresRaw)
      : null;

  const passcodeRaw = formData.get("passcode");
  const passcode =
    typeof passcodeRaw === "string" && passcodeRaw.trim() !== ""
      ? passcodeRaw
      : null;

  const proposal = await createDraftProposal({
    client_name,
    client_company,
    title,
    stream,
    owner_email,
    value_aud,
    content_html,
    terms_version,
    expires_in_days,
    passcode,
    created_by: owner_email,
  });

  redirect(`/admin?created=${proposal.slug}`);
}
