-- api_idempotency_keys: claim/fill/reclaim backing store for T3 POSTs that
-- declare idempotent: true in defineEndpoint (mobile spec S4). Service-role
-- only — no client, mobile or web, ever reads or writes this table directly.
create table api_idempotency_keys (
  key text not null,
  user_id uuid not null references auth.users(id),
  route text not null,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (key, user_id, route)
);

alter table api_idempotency_keys enable row level security;
-- No policies: authenticated/anon get zero access. Only the service-role
-- client (which bypasses RLS) touches this table.
