# MILQ Proposals

Hosted proposal delivery and e-signature platform for MILQ Digital. See `BUILD_SPEC.md` for the
full design.

Proposals are complete, self-contained HTML files (drafted in a Claude chat, or by the
`milq-proposal` skill) uploaded and served **verbatim** — no sanitiser, no fixed layout classes.
The one thing the host adds is a small injected widget (signing, locking, the audit trail, a PDF
export fallback), spliced into the page just before `</body>` and isolated in a Shadow DOM so it
can't clash with whatever CSS/JS the uploaded file brings. See `BUILD_SPEC.md` §3 for why.

## Setup

1. Create a **new** Supabase project (don't reuse one from another MILQ app — see §2).
2. Run the migrations in `supabase/migrations/` against it, in order (via the Supabase SQL
   editor, or the Supabase CLI once this repo is linked to the project).
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the Supabase project settings.
   - `TEMP_ADMIN_PASSWORD` — any password; gates `/admin` until phase 3 wires up Supabase Auth.
4. `npm install`
5. `npm run dev`, then visit `/admin` (you'll be redirected to `/admin/login`).

## Publishing a proposal by hand (phase 1/2)

`/admin/new` takes the proposal's metadata plus the HTML file itself. It's a stand-in for the
publish API (phase 3) that the `milq-proposal` skill will eventually call directly.

## Signing

Every unsigned proposal gets a fixed "Sign this proposal" bar and modal (name, role, company,
email, typed-or-drawn signature, terms acceptance). Signing runs through the `sign_proposal`
Postgres function (`supabase/migrations/0002_sign_proposal.sql`) in one transaction: lock the row,
check it isn't already signed, hash the content server-side, insert the signature, flip the
proposal to signed. Once signed, the widget swaps to a read-only executed panel and audit trail —
the underlying document is locked at the database level (a trigger rejects any update to
`content_html` once `signed_at` is set) regardless of what application code does.

## Known limitations

- The passcode-attempt rate limiter (`src/lib/rate-limit.ts`) is in-memory — it resets on every
  server restart and does not share state across serverless instances. Fine for local dev; needs a
  durable store before this matters in production.
- The admin gate (`TEMP_ADMIN_PASSWORD`) is a stand-in for phase 3's Supabase Auth, not a
  substitute for it.
- The terms panel in the signing modal doesn't yet link to a hosted terms document — that
  migration (BUILD_SPEC.md §7 "Terms and conditions") hasn't happened yet.
- No publish API, real admin auth, PDF archival snapshot, Slack/email notifications, or proposal
  versioning yet — see `BUILD_SPEC.md` §12 for the rest of the build order.
