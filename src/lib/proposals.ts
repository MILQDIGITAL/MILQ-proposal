import "server-only";
import { customAlphabet } from "nanoid";
import bcrypt from "bcryptjs";
import { supabaseServiceRole } from "@/lib/supabase/service-role";
import { sanitizeProposalHtml } from "@/lib/sanitize";
import { contentHash } from "@/lib/hash";

export type ProposalStream = "ecommerce" | "project" | "retainer" | "seo";
export type ProposalStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "expired"
  | "archived";

export type Proposal = {
  id: string;
  slug: string;
  client_name: string;
  client_company: string;
  title: string;
  stream: ProposalStream;
  owner_email: string;
  value_aud: number | null;
  status: ProposalStatus;
  content_html: string;
  content_hash: string;
  terms_version: string;
  version: number;
  supersedes_id: string | null;
  passcode_hash: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  first_viewed_at: string | null;
  signed_at: string | null;
};

// URL-safe, no look-alike characters. 24 chars ~= 142 bits of entropy.
const generateSlug = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24
);

export type DraftProposalInput = {
  client_name: string;
  client_company: string;
  title: string;
  stream: ProposalStream;
  owner_email: string;
  value_aud: number | null;
  content_html: string;
  terms_version: string;
  expires_in_days: number | null;
  passcode: string | null;
  created_by: string;
};

export async function createDraftProposal(
  input: DraftProposalInput
): Promise<Proposal> {
  const sanitized = sanitizeProposalHtml(input.content_html);
  const slug = generateSlug();
  const expires_at = input.expires_in_days
    ? new Date(
        Date.now() + input.expires_in_days * 24 * 60 * 60 * 1000
      ).toISOString()
    : null;
  const passcode_hash = input.passcode
    ? await bcrypt.hash(input.passcode, 12)
    : null;

  const { data, error } = await supabaseServiceRole()
    .from("proposals")
    .insert({
      slug,
      client_name: input.client_name,
      client_company: input.client_company,
      title: input.title,
      stream: input.stream,
      owner_email: input.owner_email,
      value_aud: input.value_aud,
      content_html: sanitized,
      content_hash: contentHash(sanitized),
      terms_version: input.terms_version,
      expires_at,
      passcode_hash,
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create proposal: ${error.message}`);
  return data as unknown as Proposal;
}

export async function getProposalBySlug(
  slug: string
): Promise<Proposal | null> {
  const { data, error } = await supabaseServiceRole()
    .from("proposals")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load proposal: ${error.message}`);
  return data as unknown as Proposal | null;
}

export async function listProposals(): Promise<Proposal[]> {
  const { data, error } = await supabaseServiceRole()
    .from("proposals")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list proposals: ${error.message}`);
  return data as unknown as Proposal[];
}

export async function verifyPasscode(
  proposal: Proposal,
  candidate: string
): Promise<boolean> {
  if (!proposal.passcode_hash) return true;
  return bcrypt.compare(candidate, proposal.passcode_hash);
}
