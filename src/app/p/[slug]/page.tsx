import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProposalBySlug } from "@/lib/proposals";
import { PasscodeGate } from "./passcode-gate";
import { PrintButton } from "./print-button";
import { unlockCookieName } from "@/lib/unlock-cookie";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Always reflects current DB state (status, expiry, passcode) — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function ProposalPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const { error } = await searchParams;

  const proposal = await getProposalBySlug(slug);
  if (!proposal) notFound();

  if (proposal.passcode_hash) {
    const jar = await cookies();
    const unlocked = jar.get(unlockCookieName(proposal.id))?.value === "1";
    if (!unlocked) {
      return (
        <PasscodeGate
          slug={slug}
          error={typeof error === "string" ? error : undefined}
        />
      );
    }
  }

  const isExpired =
    proposal.expires_at &&
    new Date(proposal.expires_at) < new Date() &&
    !proposal.signed_at;

  if (isExpired) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">This proposal has expired</h1>
        <p className="text-sm text-[var(--milq-charcoal)]">
          Contact{" "}
          <a href={`mailto:${proposal.owner_email}`} className="underline">
            {proposal.owner_email}
          </a>{" "}
          for an updated version.
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="no-print flex items-center justify-between border-b border-[var(--milq-cream)] px-4 py-3 sm:px-8">
        <span className="text-sm font-semibold">MILQ Digital</span>
        <PrintButton />
      </header>
      <article
        className="milq-proposal-body"
        // content_html is sanitised to a fixed tag/attribute/class allowlist on ingest —
        // see src/lib/sanitize.ts and docs/proposal-classes.md.
        dangerouslySetInnerHTML={{ __html: proposal.content_html }}
      />
      <div className="print-footer text-xs text-[var(--milq-charcoal)]">
        {proposal.client_company} — {proposal.title}
      </div>
    </>
  );
}
