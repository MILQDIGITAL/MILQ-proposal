import Link from "next/link";
import { listProposals } from "@/lib/proposals";
import { logoutAction } from "./login/actions";

// Always reflects current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: PageProps<"/admin">) {
  const proposals = await listProposals();
  const { created } = await searchParams;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      {typeof created === "string" && (
        <p className="mb-6 rounded bg-[var(--milq-cream)] px-4 py-3 text-sm">
          Draft created:{" "}
          <Link href={`/p/${created}`} target="_blank" className="underline">
            /p/{created}
          </Link>
        </p>
      )}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Proposals</h1>
        <div className="flex items-center gap-4">
          <Link
            href="/admin/new"
            className="rounded bg-[var(--milq-black)] px-3 py-1.5 text-sm font-medium text-[var(--milq-white)]"
          >
            New proposal
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="text-sm underline">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {proposals.length === 0 ? (
        <p className="text-sm text-[var(--milq-charcoal)]">
          No proposals yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--milq-cream)] text-left">
              <th className="py-2">Client</th>
              <th className="py-2">Title</th>
              <th className="py-2">Stream</th>
              <th className="py-2">Owner</th>
              <th className="py-2">Value</th>
              <th className="py-2">Status</th>
              <th className="py-2">Link</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => (
              <tr
                key={proposal.id}
                className="border-b border-[var(--milq-cream)]"
              >
                <td className="py-2">{proposal.client_company}</td>
                <td className="py-2">{proposal.title}</td>
                <td className="py-2">{proposal.stream}</td>
                <td className="py-2">{proposal.owner_email}</td>
                <td className="py-2">
                  {proposal.value_aud
                    ? `$${Number(proposal.value_aud).toLocaleString("en-AU")}`
                    : "—"}
                </td>
                <td className="py-2">{proposal.status}</td>
                <td className="py-2">
                  <Link
                    href={`/p/${proposal.slug}`}
                    target="_blank"
                    className="underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
