-- Signing transaction — see BUILD_SPEC.md §7 "On submit". Runs as one Postgres function call so
-- the row lock, the already-signed check, the hash computation, the signature insert and the
-- proposal flip all happen atomically, regardless of what the calling application code does.

create or replace function sign_proposal(
  p_proposal_id uuid,
  p_signer_name text,
  p_signer_role text,
  p_signer_company text,
  p_signer_email text,
  p_signature_type text,
  p_signature_data text,
  p_accepted_terms boolean,
  p_terms_version text,
  p_ip inet,
  p_user_agent text
) returns signatures as $$
declare
  v_proposal proposals;
  v_hash text;
  v_signature signatures;
begin
  select * into v_proposal from proposals where id = p_proposal_id for update;

  if not found then
    raise exception 'proposal not found';
  end if;

  if v_proposal.signed_at is not null then
    raise exception 'proposal already signed';
  end if;

  v_hash := encode(digest(v_proposal.content_html, 'sha256'), 'hex');

  insert into signatures (
    proposal_id, signer_name, signer_role, signer_company, signer_email,
    signature_type, signature_data, accepted_terms, terms_version,
    content_hash_at_signing, ip, user_agent
  ) values (
    p_proposal_id, p_signer_name, p_signer_role, p_signer_company, p_signer_email,
    p_signature_type, p_signature_data, p_accepted_terms, p_terms_version,
    v_hash, p_ip, p_user_agent
  ) returning * into v_signature;

  update proposals
  set signed_at = v_signature.signed_at, status = 'signed'
  where id = p_proposal_id;

  insert into proposal_events (proposal_id, event_type, actor, ip, user_agent, metadata)
  values (
    p_proposal_id, 'signed', p_signer_email, p_ip, p_user_agent,
    jsonb_build_object('signer_name', p_signer_name)
  );

  return v_signature;
end;
$$ language plpgsql;
