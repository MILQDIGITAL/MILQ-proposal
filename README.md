# MILQ Proposals

Hosted proposal delivery and e-signature platform for MILQ Digital. See `BUILD_SPEC.md` for the
full design; `docs/proposal-classes.md` for the layout classes a proposal body may use.

This is phase 1 of the build order in `BUILD_SPEC.md` §12: render a proposal at `/p/[slug]` with
brand CSS, responsive layout and a print stylesheet, plus a temporary admin form at `/admin/new`
for pasting in drafts by hand. Signing, the publish API and real admin auth are later phases.

## Setup

1. Create a **new** Supabase project (don't reuse one from another MILQ app — see §2).
2. Run `supabase/migrations/0001_init.sql` against it (via the Supabase SQL editor, or the
   Supabase CLI once this repo is linked to the project).
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from the Supabase project settings.
   - `TEMP_ADMIN_PASSWORD` — any password; gates `/admin` until phase 3 wires up Supabase Auth.
4. `npm install`
5. `npm run dev`, then visit `/admin` (you'll be redirected to `/admin/login`).

## Creating a proposal by hand (phase 1)

`/admin/new` takes the proposal's metadata plus a pasted HTML body fragment (the same fragment
the `milq-proposal` skill will eventually POST directly — see BUILD_SPEC.md §6, §11). The fragment
is sanitised down to the allowed tags/classes in `src/lib/sanitize.ts` before it's stored, so paste
markup using only the classes documented in `docs/proposal-classes.md`.

## Known phase 1 limitations

- The passcode-attempt rate limiter (`src/lib/rate-limit.ts`) is in-memory — it resets on every
  server restart and does not share state across serverless instances. Fine for local dev; needs a
  durable store before this matters in production.
- The admin gate (`TEMP_ADMIN_PASSWORD`) is a stand-in for phase 3's Supabase Auth, not a
  substitute for it.
- No signature capture, locking, publish API, or admin auth yet — see `BUILD_SPEC.md` §12 for the
  rest of the build order.
