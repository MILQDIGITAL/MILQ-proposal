-- MILQ Proposals — initial schema
-- See BUILD_SPEC.md §4 for the design rationale.

create extension if not exists pgcrypto;

create table proposals (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  client_name       text not null,
  client_company    text not null,
  title             text not null,
  stream            text not null check (stream in ('ecommerce', 'project', 'retainer', 'seo')),
  owner_email       text not null,
  value_aud         numeric,
  status            text not null default 'draft'
                    check (status in ('draft', 'sent', 'viewed', 'signed', 'expired', 'archived')),
  content_html      text not null,
  content_hash      text not null,
  terms_version     text not null,
  version           int not null default 1,
  supersedes_id     uuid references proposals(id),
  passcode_hash     text,
  expires_at        timestamptz,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  first_viewed_at   timestamptz,
  signed_at         timestamptz
);

create table signatures (
  id                      uuid primary key default gen_random_uuid(),
  proposal_id             uuid not null references proposals(id),
  signer_name             text not null,
  signer_role             text not null,
  signer_company          text not null,
  signer_email            text not null,
  signature_type          text not null check (signature_type in ('typed', 'drawn')),
  signature_data          text not null,
  accepted_terms          boolean not null,
  terms_version           text not null,
  content_hash_at_signing text not null,
  signed_at               timestamptz not null default now(),
  ip                      inet,
  user_agent              text,
  pdf_snapshot_path       text
);

create table proposal_events (
  id            bigserial primary key,
  proposal_id   uuid not null references proposals(id),
  event_type    text not null,
  actor         text not null,
  occurred_at   timestamptz not null default now(),
  ip            inet,
  user_agent    text,
  metadata      jsonb
);

create unique index one_signature_per_proposal on signatures(proposal_id);
create index events_by_proposal on proposal_events(proposal_id, occurred_at);

-- Once signed_at is set, content_html (and the fields that describe what was agreed to) can
-- never change. Enforced in the database so this holds even if application code is wrong later.
create or replace function prevent_locked_proposal_update()
returns trigger as $$
begin
  if old.signed_at is not null and new.content_html is distinct from old.content_html then
    raise exception 'proposal % is signed and locked; publish a new version instead', old.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger proposals_lock_on_sign
  before update on proposals
  for each row
  execute function prevent_locked_proposal_update();

alter table proposals enable row level security;
alter table signatures enable row level security;
alter table proposal_events enable row level security;

-- No policies are defined for anon/authenticated roles. All access in phase 1 goes through the
-- service role in server-only code (see src/lib/supabase/service-role.ts), which bypasses RLS by
-- design. Policies for the phase 3 Supabase Auth admin surface are added when that auth is wired
-- up, not before — an RLS table with no policies is deny-by-default for every other role.
