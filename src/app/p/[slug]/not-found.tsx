export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Proposal not found</h1>
      <p className="text-sm text-[var(--milq-charcoal)]">
        This link isn&apos;t valid, or the proposal has been removed.
      </p>
    </main>
  );
}
