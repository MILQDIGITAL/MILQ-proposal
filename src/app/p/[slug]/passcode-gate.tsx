import { unlockProposal } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  incorrect: "That passcode isn't right. Try again.",
  rate_limited: "Too many attempts. Try again in an hour.",
};

export function PasscodeGate({
  slug,
  error,
}: {
  slug: string;
  error?: string;
}) {
  const action = unlockProposal.bind(null, slug);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-lg font-semibold">This proposal is protected</h1>
      <p className="text-sm text-[var(--milq-charcoal)]">
        Enter the passcode you were given to view it.
      </p>
      <form action={action} className="flex flex-col gap-3">
        <input
          type="password"
          name="passcode"
          autoFocus
          required
          className="rounded border border-[var(--milq-charcoal)] px-3 py-2 text-sm"
          placeholder="Passcode"
        />
        {error && ERROR_MESSAGES[error] && (
          <p className="text-sm text-red-600">{ERROR_MESSAGES[error]}</p>
        )}
        <button
          type="submit"
          className="rounded bg-[var(--milq-black)] px-4 py-2 text-sm font-medium text-[var(--milq-white)]"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
