import { loginAction } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  incorrect: "Incorrect password.",
  rate_limited: "Too many attempts. Try again in an hour.",
};

export default async function AdminLoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-lg font-semibold">MILQ admin</h1>
      <form action={loginAction} className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          autoFocus
          required
          className="rounded border border-[var(--milq-charcoal)] px-3 py-2 text-sm"
          placeholder="Password"
        />
        {typeof error === "string" && ERROR_MESSAGES[error] && (
          <p className="text-sm text-red-600">{ERROR_MESSAGES[error]}</p>
        )}
        <button
          type="submit"
          className="rounded bg-[var(--milq-black)] px-4 py-2 text-sm font-medium text-[var(--milq-white)]"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
