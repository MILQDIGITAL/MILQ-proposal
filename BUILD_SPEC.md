# MILQ Proposals — Build Spec

Hosted proposal delivery and e-signature platform. Replaces Qwilr as the presentation and
sign-off layer for MILQ Digital proposals.

Written as a brief for Claude Code. Read this fully before writing code. Section 12 lists
decisions that are still open.

---

## 1. What this replaces and why

Today proposals are drafted by the `milq-proposal` skill as markdown blocks, then pasted by
hand into a duplicated Qwilr template. That is two systems, a manual transfer step, and a theme
carrying a retired brand colour.

This app collapses it. The skill drafts and publishes in one run. The client gets a branded URL.
They sign in-page. The proposal locks and produces an audit trail.

**In scope:** hosting, admin directory, signature capture, locking, audit trail, PDF export.

**Out of scope for v1:** payment collection on acceptance, proposal editing in the admin UI,
multi-signer flows, client comments, MILQ countersignature, HubSpot sync.

---

## 2. Stack

| Layer | Choice | Reason |
|---|---|---|
| App | Next.js (App Router) on Vercel | Server-side locking enforcement, API routes for the publish endpoint, dynamic slug routing |
| Database | Supabase (Postgres) | Already in use across `milq-daily-os` and the retainer app |
| Storage | Supabase Storage | PDF snapshots, signature images |
| Auth (admin) | Supabase Auth, email domain restricted to `@milqdigital.co` | Team-only admin directory |
| Auth (publish API) | Static bearer token, create-scoped | Called from the Claude sandbox by the skill |
| PDF (client) | Print stylesheet plus `window.print()` | Zero infra, always available |
| PDF (archival) | Headless Chromium on a Vercel function | Deterministic snapshot at signing |

Use a **new Supabase project**, not a shared one. Signed commercial documents should not share a
database with an internal ops tool.

`@milqdigital.co` is confirmed as the correct email domain for MILQ staff — used consistently
below for admin auth and `owner_email`.

---

## 3. Content model: the app owns the chrome

The skill emits a **body fragment**, not a full HTML document. The app wraps it in a shell that
supplies brand CSS, the signature block, the print stylesheet and the responsive rules.

This is the single most important structural decision in the build. It means requirement 3
(mobile friendly from the outset) is solved once in the shell rather than re-solved in every
proposal, and a template fix retro-applies to every proposal already published.

The fragment is sanitised on ingest. Allowed tags: headings, paragraphs, lists, tables, `img`,
`a`, `strong`, `em`, `blockquote`, `hr`, `section`, `div`, `span`. Allowed attributes: `class`,
`href`, `src`, `alt`, `colspan`, `rowspan`. Strip everything else, including all inline styles,
`script`, `style`, `iframe` and event handlers.

The fragment may use a fixed set of MILQ layout classes. Document these in
`docs/proposal-classes.md` and keep the skill and the shell in sync:

```
.milq-cover          .milq-lede           .milq-stat
.milq-pricing-grid   .milq-pricing-card    .milq-pricing-card--recommended
.milq-scope-group    .milq-process-strip   .milq-testimonial
.milq-terms          .milq-team-card
```

---

## 4. Data model

```sql
create table proposals (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  client_name       text not null,          -- "Maggie and Josh"
  client_company    text not null,
  title             text not null,
  stream            text not null check (stream in ('ecommerce','project','retainer','seo')),
  owner_email       text not null,          -- cam@ or vanja@milqdigital.co
  value_aud         numeric,
  status            text not null default 'draft'
                    check (status in ('draft','sent','viewed','signed','expired','archived')),
  content_html      text not null,          -- sanitised body fragment
  content_hash      text not null,          -- sha256 of content_html
  terms_version     text not null,
  version           int not null default 1,
  supersedes_id     uuid references proposals(id),
  passcode_hash     text,                   -- optional, bcrypt
  expires_at        timestamptz,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  first_viewed_at   timestamptz,
  signed_at         timestamptz             -- client execution; commencement date
);

create table signatures (
  id                     uuid primary key default gen_random_uuid(),
  proposal_id            uuid not null references proposals(id),
  signer_name            text not null,
  signer_role            text not null,
  signer_company         text not null,
  signer_email           text not null,
  signature_type         text not null check (signature_type in ('typed','drawn')),
  signature_data         text not null,     -- typed string, or base64 PNG for drawn
  accepted_terms         boolean not null,
  terms_version          text not null,
  content_hash_at_signing text not null,
  signed_at              timestamptz not null default now(),
  ip                     inet,
  user_agent             text,
  pdf_snapshot_path      text
);

create table proposal_events (
  id            bigserial primary key,
  proposal_id   uuid not null references proposals(id),
  event_type    text not null,   -- created | published | viewed | pdf_exported
                                 -- | signature_started | signed | superseded | archived
  actor         text not null,   -- 'client' or a milqdigital.co email
  occurred_at   timestamptz not null default now(),
  ip            inet,
  user_agent    text,
  metadata      jsonb
);

create unique index one_signature_per_proposal on signatures(proposal_id);
create index events_by_proposal on proposal_events(proposal_id, occurred_at);
```

RLS on all three tables. The public proposal route reads through a service role in a server
component, never a client-side anon query. Nothing about a proposal should be reachable from the
browser except the slug it was given.

No HubSpot deal reference on the schema — HubSpot sync is out of scope for v1 and not planned as
a later phase.

---

## 5. URLs and access

| Route | Purpose | Access |
|---|---|---|
| `/p/[slug]` | Client-facing proposal | Unguessable slug, optional passcode |
| `/p/[slug]/pdf` | Server-rendered PDF | Same as above |
| `/admin` | Proposal directory | Supabase Auth, `@milqdigital.co` only |
| `/admin/[id]` | Detail, audit trail, signature record | As above |
| `/api/proposals` | Publish endpoint (POST) | Bearer token |
| `/api/proposals/[slug]` | Update (PATCH), 409 if signed | Bearer token |

**Slug:** `nanoid(24)` from a URL-safe alphabet. At 24 characters this is not enumerable by any
practical means, which is the same posture Qwilr takes.

**Indexing:** `noindex, nofollow` meta on every `/p/` route, plus `Disallow: /p/` in
`robots.txt`, plus `X-Robots-Tag: noindex` header. A proposal with pricing in it must never
appear in a search result.

**Passcode:** optional per proposal. When set, a gate page collects it before the proposal
renders. Store bcrypt, never the plaintext. Rate limit to 5 attempts per IP per hour — this
needs state that survives across serverless invocations (a Supabase table keyed on IP + slug, or
an external store), not an in-memory counter.

**Expiry:** optional `expires_at`. After it passes, the proposal renders a "this proposal has
expired, contact [owner]" state rather than the content. Signing is disabled. Already-signed
proposals ignore expiry and always render.

---

## 6. Publish API (requirement 1)

```
POST /api/proposals
Authorization: Bearer <MILQ_PUBLISH_TOKEN>
Content-Type: application/json

{
  "client_name":    "Jay",
  "client_company": "Wayne Ritchies",
  "title":          "Shopify Plus Migration",
  "stream":         "project",
  "owner_email":    "cam@milqdigital.co",
  "value_aud":      71000,
  "content_html":   "<section class=\"milq-cover\">...</section>",
  "terms_version":  "2026",
  "expires_in_days": 30,
  "passcode":       null
}

201 →
{
  "slug":      "V1StGXR8_Z5jdHi6B-myT4kQ",
  "url":       "https://proposal.milqdigital.co/p/V1StGXR8_Z5jdHi6B-myT4kQ",
  "admin_url": "https://proposal.milqdigital.co/admin/9f2c...",
  "status":    "draft"
}
```

`PATCH /api/proposals/[slug]` updates content on an unsigned proposal. If `signed_at` is not
null it returns **409 Conflict** with a message directing the caller to publish a new version.
This check happens in the database transaction, not in application code alone.

### Token scope

`MILQ_PUBLISH_TOKEN` lives in the skill directory and grants create and update only. It cannot
read other proposals, cannot delete, cannot sign, and cannot reach the admin API. If it leaks,
the blast radius is "someone can create draft proposals nobody has the URL to." That is an
acceptable trade for making publishing a single skill step. Compare it with a constant-time
check server-side to avoid timing attacks.

### Sandbox network constraint

The skill runs inside Claude's sandbox, which enforces a domain allowlist. `proposal.milqdigital.co`
is not on it by default.

**Preferred:** as MILQ org owner, add `proposal.milqdigital.co` to the org network allowlist in
Claude settings. One entry, and the direct POST above works.

**Fallback if that is not possible:** the skill commits the fragment plus a metadata JSON file to
a private GitHub repo (`github.com` and `api.github.com` are already allowlisted). A GitHub
Actions workflow or a Vercel deploy hook then calls the publish API server-side. Slower and more
moving parts, so only take this path if the allowlist route is blocked.

Build the direct POST path. Structure the publish logic behind a small adapter so the GitHub
path can be swapped in without touching the skill's calling code.

---

## 7. Signature, locking and audit trail (requirement 4)

### Capture

Rendered by the shell at the foot of every unsigned proposal. Fields:

| Field | Type | Required |
|---|---|---|
| Full name | text | yes |
| Role / title | text | yes |
| Company | text, prefilled from `client_company`, editable | yes |
| Email | email, validated | yes |
| Signature | typed name or drawn on canvas, toggle between the two | yes |
| Terms acceptance | checkbox, label links to the versioned terms | yes, must be true |

Date is captured server-side. Never trust a client-supplied timestamp.

The drawn signature uses pointer events so it works with finger, stylus and mouse. Canvas at
device pixel ratio so it is not blurry on retina. Export as PNG at a fixed 600x200 logical size.

### On submit

Server-side, in one transaction:

1. Re-read the proposal. If `signed_at` is already set, return 409.
2. Recompute `content_hash` from stored `content_html`. Persist it as
   `content_hash_at_signing`. This is the proof of what was actually agreed.
3. Insert the `signatures` row with IP from the forwarded header and the user agent.
4. Set `proposals.signed_at` and `status = 'signed'`. This is the final, executed state — there
   is no separate countersignature step.
5. Write a `signed` event to `proposal_events`.
6. Fire the post-signature jobs (section 8) asynchronously. A failed Slack ping must never
   roll back a valid signature.

### Locked state

Once `signed_at` is set:

- `PATCH` on the proposal returns 409. Enforce with a database trigger that raises on any update
  to `content_html` where `signed_at is not null`, so this holds even if application code is
  wrong later.
- The public route still renders the full proposal, read-only. This is requirement 4 and it
  matters: the client must be able to return to what they signed at any time.
- The signature block is replaced by an executed panel showing signer name, role, company, the
  signature image or typed mark, and the timestamp rendered in `Australia/Sydney` with the
  offset shown, for example `14 August 2026 at 3:42 pm AEST`.
- Below it, an audit trail summary (see below).
- A "Download signed PDF" button replaces the plain export button, available immediately —
  the client-side print stylesheet already renders the executed panel and audit trail (§9), so
  this download is available the moment they sign, with no wait on any archival job.

### Revising a signed proposal

There is no unlock. Publishing a revision creates a **new proposal row** with `version + 1`, a
new slug, and `supersedes_id` pointing at the original. The original stays live and locked, with
a banner linking forward to the superseding version. The admin list groups versions together.

Say this plainly in the skill output so nobody expects an edit-in-place.

### Audit trail summary

Rendered on the locked proposal and in admin. Plain language, timestamped, `Australia/Sydney`:

```
Proposal published            12 Aug 2026, 9:14 am AEST
First opened by recipient     12 Aug 2026, 4:31 pm AEST
Opened 6 times across 3 days
Signed by Jay Ritchie         14 Aug 2026, 3:42 pm AEST
  Role            Managing Director
  Company         Wayne Ritchies Pty Ltd
  Email           jay@wayneritchies.com.au
  IP address      203.0.113.44
  Device          Safari 18 on iPhone
  Terms version   2026
  Document hash   a3f1c9…8e21  (unchanged since publication)
```

The hash line is the point of the whole exercise. It lets you demonstrate the document was not
altered between publication and signature.

### Archival PDF

Generated immediately after client signature, server-side, as part of the post-signature jobs
(§8). Headless Chromium renders the same executed page a browser would, so the archival copy is
deterministic regardless of the client's own browser.

### Terms and conditions

Confirmed source: **MILQ General Terms and Conditions 2026**, currently hosted in Qwilr. Version
string is `2026`.

**Migrate the terms into this repo before launch.** They live at a Qwilr URL today. If MILQ leaves
Qwilr, that URL dies and every signed proposal loses its reference document. Port the full text to
`terms/2026.md`, serve it at `proposal.milqdigital.co/terms/2026`, and keep the Qwilr page live
until every proposal signed against it has completed.

Version the terms as files and render them from the version recorded on the proposal, never from the
current file. A proposal signed against `2026` must render `2026` forever, even after `2027` ships.

**Present, do not merely link.** Clause 7.1(k) requires the client to warrant they have reviewed and
understood the terms. A bare hyperlink is weak evidence of that. Render the terms in an expandable
panel directly above the signature block, log a `terms_viewed` event when it is opened, and include
that event in the audit trail. The checkbox label should read:

> I have read and accept the MILQ Digital General Terms and Conditions 2026, and I have authority to
> enter this Agreement on behalf of [company].

The authority wording matters. Clause 9.2(d) has the client warrant no legal restriction prevents
them entering the Agreement, and you are collecting a role/title field anyway.

### Clauses that constrain the build

| Clause | Effect on the app |
|---|---|
| 1.1 | Acceptance by indicating acceptance online is already contemplated. Click-to-accept is the intended mechanism, not a workaround. |
| 17.10 | Online execution is framed around a **third party** execution service. This app is first-party. Flag to the lawyer, see §14. |
| 17.1 | Amendment only by written instrument executed by the Parties. Confirms the no-unlock, new-version design in this section. |
| Definitions, "Proposal" | The hosted page **is** the Proposal, a schedule to the Agreement. This is why hashing and locking are load-bearing rather than nice to have. |
| Definitions, "Fees" | All fees are quoted **exclusive of GST**. The shell must render an "excludes GST" line adjacent to every total. Do not leave this to proposal copy. |
| 8.2 | Where the Proposal specifies no payment date, the default is 30 days, not 14. See §11. |
| Definitions, "Commencement Date" | Defined as when the *last Party* signs. With no MILQ countersignature step in this app, this app captures only the client signature — see §14 for the legal implication. |

---

## 8. Post-signature jobs

Fire and forget, retried, never blocking the signature response.

1. **Server-render the PDF snapshot.** Headless Chromium against `/p/[slug]?snapshot=1`. Store in
   Supabase Storage, write the path to `signatures.pdf_snapshot_path`.
2. **Slack notification** to the MILQ channel: client, title, value, signer, link to admin.
3. **Confirmation email** to the signer, cc the `owner_email`, with the PDF attached.

---

## 9. PDF export (requirement 6)

Two mechanisms, deliberately.

**Client-side, always available, signed or not.** A print stylesheet plus a button calling
`window.print()`. This must be built regardless because it is also how the archival render works.

Print CSS requirements:
- `@page { size: A4; margin: 18mm 16mm; }`
- Hide nav, the export button, and the live signature form
- `break-inside: avoid` on pricing cards, tables and the signature panel
- Force backgrounds with `print-color-adjust: exact` so the cream fills survive
- Repeat table headers with `thead { display: table-header-group; }`
- Running footer with client company, proposal title and page number
- When signed, print the executed panel and the audit trail summary

**Server-side, for the archival snapshot.** Same page rendered by Chromium at signing time.
Deterministic output regardless of the client's browser, which is what you want on the document
you may one day need to rely on.

Ship the print stylesheet in phase 1. Add the server render in phase 4.

---

## 10. Admin directory (requirement 2)

`/admin`, table view, newest first:

| Column | Notes |
|---|---|
| Client | Company, with contact name beneath |
| Title | Links to the client-facing proposal in a new tab |
| Stream | ecommerce / project / retainer / seo |
| Owner | Cam or Vanja |
| Value | AUD, formatted |
| Status | Pill: draft, sent, viewed, signed, expired, archived |
| Last activity | Relative, for example "opened 2 hours ago" |
| Actions | Copy link, preview, duplicate, archive |

Filters on status, stream and owner. Search across client company and title.

Detail view shows the rendered proposal in an iframe, the full event log, the signature record
if present, the version chain, and a link to the signed PDF.

`viewed` status is set on the first `viewed` event. `sent` is set manually when the link is
shared, or automatically on first publish if you prefer fewer states. Pick one and be consistent.

---

## 11. Skill changes

`/mnt/skills/organization/milq-proposal/SKILL.md` currently ends at §3 by writing markdown blocks
to `/mnt/user-data/outputs/` for pasting into Qwilr. That stays as the fallback path. Add a
publish path alongside it.

### New §3b: Publish

After the markdown file is written and the §8 checklist passes:

1. Render the approved blocks into the HTML fragment using the layout classes in
   `references/proposal-html.md` (new file, mirrors `docs/proposal-classes.md` in the app repo).
2. Refuse to publish while any `[[TBC]]` placeholder remains in the copy. List them and stop.
   A placeholder reaching a client URL is worse than one reaching a Qwilr draft, because the URL
   may already have been shared.
3. POST to the publish endpoint.
4. Report back the client URL and the admin URL. Do not paste the fragment into chat.

### Also update

- §1 stream table: the retainer and SEO reference files are still unbuilt. Publishing does not
  change that. Keep the guardrail that unpriced streams cannot ship.
- §5 payment terms: the block currently states "Payment due date terms: 14 days". Keep it, and make
  it **mandatory rather than standard**. Clause 8.2 of the 2026 terms defaults to 30 days where the
  Proposal is silent. A proposal that drops the terms block silently doubles MILQ's payment window.
  The skill should refuse to publish without it.
- §5 GST: the existing line covers this in prose. The shell also renders an "excludes GST" line
  against every total, so check the two do not read as duplicated on the page.
- §8 checklist: add `[ ] Published, client URL returned` and `[ ] No [[TBC]] placeholders remain`.
- §8 known template issue: the Qwilr purple note becomes conditional. On the hosted path the
  shell uses brand tokens only, so it does not apply. Keep the note for proposals still going
  through Qwilr.

### Brand tokens for the shell

From `milq-brand` §6. Black `#000000`, White `#ffffff`, Cream `#f4f4f1`, Charcoal `#3d3d3d`.
No purple anywhere. Inter for all text via Google Fonts. Anton only for the wordmark, and the
wordmark is an asset file, never styled text.

---

## 12. Build order

**Phase 1 — Render.** Supabase schema, Next.js app, `/p/[slug]` shell with brand CSS and
responsive rules, print stylesheet, manual paste-in through a temporary admin form. At the end of
this phase you can host a proposal and a client can read it on a phone and print it.

**Phase 2 — Sign and lock.** Signature capture, server-side transaction, database lock trigger,
executed panel, audit trail summary, event logging, versioned terms. At the end of this phase a
client can sign and immediately download a PDF of the executed proposal, signature and audit
trail via the print stylesheet.

**Phase 3 — Publish and admin.** Publish API, token auth, HTML sanitiser, skill integration,
admin directory and detail views, Supabase Auth with domain restriction.

**Phase 4 — Snapshot and notify.** Server-side Chromium PDF (deterministic archival duplicate of
the phase 2 print output), Supabase Storage, Slack ping, confirmation email.

**Phase 5 — Analytics.** View beacons, dwell time per section, open counts in the admin list.

Phases 1 and 2 are the product. Everything after is leverage.

---

## 13. Decisions

### Settled

1. **Domain.** `proposal.milqdigital.co` (singular), DNS via Cloudflare. This is now fixed and
   cannot change once a proposal has been signed, because executed documents reference the host in
   their audit trail and terms URL. Add `proposals.milqdigital.co` as a 301 alias to catch the
   plural typo in emails.
2. **Allowlist.** Being added to the Claude org network allowlist. Build the direct POST path in §6.
3. **Terms.** MILQ General Terms and Conditions 2026 exist and apply across all business units.
   Version string `2026`. Migrate into the repo per §7.
4. **Signature type.** Both typed and drawn, with a toggle. Default to typed on viewports under
   768px, drawn on desktop, but let the client switch either way.
5. **Staff email domain.** `@milqdigital.co` is correct, used for both admin auth and
   `owner_email`.
6. **No countersignature.** Client signature is the sole and final execution step. No MILQ
   countersignature, no "awaiting countersignature" state, no separate Commencement Date
   computation — `signed_at` is the commencement date. See §14 for the legal caveat this raises
   against the 2026 T&Cs' Commencement Date definition.
7. **No HubSpot sync.** Not in scope for v1 or a later phase. No deal reference on the schema.

### Still open

8. **Status semantics.** Auto-set `sent` on publish, or keep it manual.
9. **Terms panel behaviour.** Require the client to open the terms panel before the accept button
   enables, or log the event and leave the button live. The former is stronger evidence, the latter
   is less friction. Sales call as much as a legal one.

---

## 14. Legal note

Click-to-accept is generally enforceable in Australia under the Electronic Transactions Act 1999
(Cth) and the NSW equivalent, provided there is clear intent to be bound, consent to transacting
electronically, and a reliable method of identifying the signer. The audit trail in §7 is designed
to evidence all three. Clause 1.1 of the 2026 terms already contemplates online acceptance, so this
system executes the mechanism the terms describe rather than substituting a different one.

**One clause to put in front of the lawyer.** Clause 17.10 permits execution by a *third party*
online document execution service nominated by MILQ. This app is first-party. Two readings are
available: that 1.1 stands independently and 17.10 is merely permissive, or that 17.10 narrows the
acceptable execution methods. The first reading is more natural, but the question is worth thirty
minutes of a lawyer's time before the first proposal executes through this system, because it goes
to formation. The cheap fix if they are uncomfortable is a one-line amendment to 17.10 covering
"a document execution service operated by us or a third party."

**Also worth their view, given the decision to drop countersignature (§13.6):** the 2026 T&Cs
define Commencement Date as when the *last Party* signs. With only a client signature captured,
this app does not itself produce a "last Party" signing event for MILQ. In practice MILQ's
acceptance is presumably evidenced elsewhere (issuing the proposal, commencing work, an internal
sign-off) — worth confirming with counsel that Commencement Date has a clearly defined trigger
under the T&Cs even though this app only captures the client's signature, so a dispute over "when
did the Term start" has a clean answer.

This is not legal advice.
