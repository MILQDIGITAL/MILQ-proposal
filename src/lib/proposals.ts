import "server-only";
import { customAlphabet } from "nanoid";
import bcrypt from "bcryptjs";
import { supabaseServiceRole } from "@/lib/supabase/service-role";
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

export type Signature = {
  id: string;
  proposal_id: string;
  signer_name: string;
  signer_role: string;
  signer_company: string;
  signer_email: string;
  signature_type: "typed" | "drawn";
  signature_data: string;
  accepted_terms: boolean;
  terms_version: string;
  content_hash_at_signing: string;
  signed_at: string;
  ip: string | null;
  user_agent: string | null;
  pdf_snapshot_path: string | null;
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
  // The uploaded file is stored and served verbatim (BUILD_SPEC.md §3) — the only structural
  // requirement is a closing </body> tag, since that's where the signing widget gets spliced in.
  if (!input.content_html.includes("</body>")) {
    throw new Error(
      "Uploaded file doesn't look like a complete HTML document — no closing </body> tag found."
    );
  }

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
      content_html: input.content_html,
      content_hash: contentHash(input.content_html),
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

export async function getSignatureForProposal(
  proposalId: string
): Promise<Signature | null> {
  const { data, error } = await supabaseServiceRole()
    .from("signatures")
    .select("*")
    .eq("proposal_id", proposalId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load signature: ${error.message}`);
  return data as unknown as Signature | null;
}

export class AlreadySignedError extends Error {
  constructor() {
    super("This proposal has already been signed.");
    this.name = "AlreadySignedError";
  }
}

export type SignInput = {
  proposalId: string;
  signerName: string;
  signerRole: string;
  signerCompany: string;
  signerEmail: string;
  signatureType: "typed" | "drawn";
  signatureData: string;
  acceptedTerms: boolean;
  termsVersion: string;
  ip: string | null;
  userAgent: string | null;
};

/**
 * Signs a proposal via the `sign_proposal` Postgres function (see
 * supabase/migrations/0002_sign_proposal.sql), which locks the proposal row, checks it isn't
 * already signed, recomputes the content hash server-side, inserts the signature, and flips the
 * proposal to signed — all inside one database transaction. See BUILD_SPEC.md §7.
 */
export async function signProposal(input: SignInput): Promise<Signature> {
  const { data, error } = await supabaseServiceRole().rpc("sign_proposal", {
    p_proposal_id: input.proposalId,
    p_signer_name: input.signerName,
    p_signer_role: input.signerRole,
    p_signer_company: input.signerCompany,
    p_signer_email: input.signerEmail,
    p_signature_type: input.signatureType,
    p_signature_data: input.signatureData,
    p_accepted_terms: input.acceptedTerms,
    p_terms_version: input.termsVersion,
    p_ip: input.ip,
    p_user_agent: input.userAgent,
  });

  if (error) {
    if (error.message.includes("already signed")) {
      throw new AlreadySignedError();
    }
    throw new Error(`Failed to sign proposal: ${error.message}`);
  }

  return data as unknown as Signature;
}

export async function recordProposalEvent(input: {
  proposalId: string;
  eventType: string;
  actor: string;
  ip: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServiceRole()
    .from("proposal_events")
    .insert({
      proposal_id: input.proposalId,
      event_type: input.eventType,
      actor: input.actor,
      ip: input.ip,
      user_agent: input.userAgent,
      metadata: input.metadata ?? null,
    });

  if (error) throw new Error(`Failed to record event: ${error.message}`);
}

/** Sets first_viewed_at (and bumps draft -> viewed) the first time someone loads the proposal. */
export async function markFirstViewIfNeeded(proposal: Proposal): Promise<void> {
  if (proposal.first_viewed_at) return;

  const { error } = await supabaseServiceRole()
    .from("proposals")
    .update({
      first_viewed_at: new Date().toISOString(),
      status: proposal.status === "draft" ? "viewed" : proposal.status,
    })
    .eq("id", proposal.id)
    .is("first_viewed_at", null);

  if (error) throw new Error(`Failed to record first view: ${error.message}`);
}

export async function countViewEvents(proposalId: string): Promise<number> {
  const { count, error } = await supabaseServiceRole()
    .from("proposal_events")
    .select("id", { count: "exact", head: true })
    .eq("proposal_id", proposalId)
    .eq("event_type", "viewed");

  if (error) throw new Error(`Failed to count view events: ${error.message}`);
  return count ?? 0;
}
