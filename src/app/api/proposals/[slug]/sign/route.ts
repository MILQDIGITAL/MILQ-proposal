import { NextResponse, type NextRequest } from "next/server";
import {
  getProposalBySlug,
  signProposal,
  AlreadySignedError,
} from "@/lib/proposals";
import { unlockCookieName } from "@/lib/unlock-cookie";

export const dynamic = "force-dynamic";

type SignBody = {
  signerName?: unknown;
  signerRole?: unknown;
  signerCompany?: unknown;
  signerEmail?: unknown;
  signatureType?: unknown;
  signatureData?: unknown;
  acceptedTerms?: unknown;
  termsVersion?: unknown;
};

function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/proposals/[slug]/sign">
) {
  const { slug } = await context.params;
  const proposal = await getProposalBySlug(slug);

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  if (proposal.signed_at) {
    return NextResponse.json(
      { error: "This proposal has already been signed." },
      { status: 409 }
    );
  }

  const isExpired =
    proposal.expires_at && new Date(proposal.expires_at) < new Date();
  if (isExpired) {
    return NextResponse.json(
      { error: "This proposal has expired and can no longer be signed." },
      { status: 410 }
    );
  }

  if (proposal.passcode_hash) {
    const unlocked =
      request.cookies.get(unlockCookieName(proposal.id))?.value === "1";
    if (!unlocked) {
      return NextResponse.json(
        { error: "Enter the passcode before signing." },
        { status: 403 }
      );
    }
  }

  let body: SignBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const signerName = requiredString(body.signerName);
  const signerRole = requiredString(body.signerRole);
  const signerCompany = requiredString(body.signerCompany);
  const signerEmail = requiredString(body.signerEmail);
  const signatureData = requiredString(body.signatureData);
  const signatureType = body.signatureType;
  const termsVersion = requiredString(body.termsVersion);

  if (
    !signerName ||
    !signerRole ||
    !signerCompany ||
    !signerEmail ||
    !signatureData ||
    !termsVersion
  ) {
    return NextResponse.json(
      { error: "All fields are required." },
      { status: 400 }
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(signerEmail)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (signatureType !== "typed" && signatureType !== "drawn") {
    return NextResponse.json(
      { error: "Invalid signature type." },
      { status: 400 }
    );
  }
  if (body.acceptedTerms !== true) {
    return NextResponse.json(
      { error: "You must accept the terms to sign." },
      { status: 400 }
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");

  try {
    const signature = await signProposal({
      proposalId: proposal.id,
      signerName,
      signerRole,
      signerCompany,
      signerEmail,
      signatureType,
      signatureData,
      acceptedTerms: true,
      termsVersion,
      ip,
      userAgent,
    });

    return NextResponse.json({ ok: true, signedAt: signature.signed_at }, { status: 201 });
  } catch (error) {
    if (error instanceof AlreadySignedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
