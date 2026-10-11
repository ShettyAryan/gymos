-- GymOS cloud schema (Supabase Free). Apply with `supabase db push` or the SQL editor.
-- Design: the device's SQLite database is the source of truth; the cloud keeps a per-user,
-- versioned backup of every syncable record as JSON (see docs/DECISIONS.md, D-05).
-- Every table has RLS. The app only ever uses the anon/publishable key + the user's JWT.

-- ---------------------------------------------------------------------------
-- Sync records
-- ---------------------------------------------------------------------------
create table if not exists public.sync_record (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  entity_type text        not null check (entity_type in (
                'profile','exercise','programme','programme_day','programme_exercise','programme_version',
                'workout_session','workout_exercise','workout_set','personal_record','progression_recommendation',
                'attendance_event','xp_event','badge_award','campaign','campaign_milestone','progress_entry',
                'daily_checkin','progress_photo','weekly_review','ai_consent')),
  entity_id   text        not null check (char_length(entity_id) between 1 and 100),
  version     integer     not null check (version > 0),
  payload     jsonb       not null check (pg_column_size(payload) < 262144),
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

-- Server-side idempotency for rewards: one XP event / badge per idempotency key per user.
create unique index if not exists sync_record_award_key
  on public.sync_record (user_id, entity_type, (payload ->> 'idempotency_key'))
  where entity_type in ('xp_event', 'badge_award');

create index if not exists sync_record_pull on public.sync_record (user_id, updated_at);

alter table public.sync_record enable row level security;

create policy "sync_record: owner can read"   on public.sync_record for select using ((select auth.uid()) = user_id);
create policy "sync_record: owner can insert" on public.sync_record for insert with check ((select auth.uid()) = user_id);
create policy "sync_record: owner can update" on public.sync_record for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sync_record: owner can delete" on public.sync_record for delete using ((select auth.uid()) = user_id);

-- Idempotent batch push with record-level version checks. SECURITY INVOKER: RLS still applies.
-- Per item: applied (new/newer version), duplicate (same version + same payload — a retry), or
-- conflict (server is newer or diverged — never silently overwritten; client keeps its copy).
create or replace function public.sync_push(items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  inc_version integer;
  ex_version integer;
  ex_payload jsonb;
  st text;
  results jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(items) loop
    inc_version := (item ->> 'version')::integer;
    ex_version := null;
    ex_payload := null;

    select r.version, r.payload into ex_version, ex_payload
    from public.sync_record r
    where r.user_id = uid and r.entity_type = item ->> 'entity_type' and r.entity_id = item ->> 'entity_id'
    for update;

    if ex_version is null then
      begin
        insert into public.sync_record (user_id, entity_type, entity_id, version, payload, deleted_at)
        values (uid, item ->> 'entity_type', item ->> 'entity_id', inc_version, item -> 'payload',
                nullif(item -> 'payload' ->> 'deleted_at', '')::timestamptz);
        st := 'applied';
      exception when unique_violation then
        -- Same award idempotency key under another id: the reward already exists.
        st := 'duplicate';
      end;
    elsif ex_version = inc_version then
      st := case when ex_payload = item -> 'payload' then 'duplicate' else 'conflict' end;
    elsif ex_version < inc_version then
      update public.sync_record
         set version = inc_version,
             payload = item -> 'payload',
             deleted_at = nullif(item -> 'payload' ->> 'deleted_at', '')::timestamptz,
             updated_at = now()
       where user_id = uid and entity_type = item ->> 'entity_type' and entity_id = item ->> 'entity_id';
      st := 'applied';
    else
      st := 'conflict';
    end if;

    results := results || jsonb_build_object(
      'entity_type', item ->> 'entity_type',
      'entity_id', item ->> 'entity_id',
      'status', st,
      'server_version', coalesce(ex_version, inc_version),
      'server_payload', case when st = 'conflict' then ex_payload else null end);
  end loop;
  return results;
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- AI consent, per-user quota and shared-model circuit breaker
-- ---------------------------------------------------------------------------
create table if not exists public.ai_consent (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  granted        boolean     not null,
  policy_version text        not null,
  decided_at     timestamptz not null default now()
);
alter table public.ai_consent enable row level security;
create policy "ai_consent: owner can read"   on public.ai_consent for select using ((select auth.uid()) = user_id);
create policy "ai_consent: owner can insert" on public.ai_consent for insert with check ((select auth.uid()) = user_id);
create policy "ai_consent: owner can update" on public.ai_consent for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ai_consent: owner can delete" on public.ai_consent for delete using ((select auth.uid()) = user_id);

-- Only the Edge Function (service role) touches these; RLS on with no policies = no client access.
create table if not exists public.ai_usage (
  user_id  uuid    not null references auth.users (id) on delete cascade,
  day      date    not null,
  requests integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create table if not exists public.ai_model_state (
  model         text primary key,
  blocked_until timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.ai_model_state enable row level security;

-- Atomically consume one AI request from today's per-user allowance.
create or replace function public.ai_try_consume(p_user uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.ai_usage (user_id, day, requests)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set requests = public.ai_usage.requests + 1
    where public.ai_usage.requests < p_limit
  returning requests into n;
  return n is not null;
end;
$$;
revoke all on function public.ai_try_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_try_consume(uuid, integer) to service_role;

-- Deletes every cloud record for the caller (photo objects are removed via the Storage API).
create or replace function public.delete_my_cloud_data()
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.sync_record where user_id = auth.uid();
  delete from public.ai_consent where user_id = auth.uid();
$$;
revoke all on function public.delete_my_cloud_data() from public, anon;
grant execute on function public.delete_my_cloud_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Private progress-photo storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do update set public = false;

-- Objects live under "<user_id>/<random-uuid>.jpg"; only the owner can touch their folder.
create policy "photos: owner can read" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos: owner can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos: owner can update" on storage.objects for update to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos: owner can delete" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
