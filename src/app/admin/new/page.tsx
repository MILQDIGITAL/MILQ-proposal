import { createProposalAction } from "./actions";

export default function NewProposalPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-6 text-lg font-semibold">New proposal (draft)</h1>
      <p className="mb-6 text-sm text-[var(--milq-charcoal)]">
        Manual paste-in for phase 1. Paste the sanitised HTML fragment the
        `milq-proposal` skill produces — see docs/proposal-classes.md for the
        allowed classes. This form is a stand-in for the publish API (phase 3).
      </p>
      <form action={createProposalAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Client name
          <input
            name="client_name"
            required
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Client company
          <input
            name="client_company"
            required
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            name="title"
            required
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Stream
          <select
            name="stream"
            required
            defaultValue="project"
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          >
            <option value="ecommerce">eCommerce</option>
            <option value="project">Project</option>
            <option value="retainer">Retainer</option>
            <option value="seo">SEO</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Owner email
          <input
            name="owner_email"
            type="email"
            required
            placeholder="cam@milqdigital.co"
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Value (AUD, excl. GST)
          <input
            name="value_aud"
            type="number"
            min="0"
            step="1"
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Terms version
          <input
            name="terms_version"
            required
            defaultValue="2026"
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Expires in (days, optional)
          <input
            name="expires_in_days"
            type="number"
            min="1"
            step="1"
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Passcode (optional)
          <input
            name="passcode"
            type="text"
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Content HTML fragment
          <textarea
            name="content_html"
            required
            rows={16}
            className="rounded border border-[var(--milq-charcoal)] px-3 py-2 font-mono text-xs"
            placeholder='<section class="milq-cover">...</section>'
          />
        </label>
        <button
          type="submit"
          className="rounded bg-[var(--milq-black)] px-4 py-2 text-sm font-medium text-[var(--milq-white)]"
        >
          Create draft
        </button>
      </form>
    </main>
  );
}
