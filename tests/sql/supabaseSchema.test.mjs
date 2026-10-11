/**
 * Runs the real Supabase migration in PGlite (WASM Postgres) with minimal stand-ins for the
 * Supabase `auth` and `storage` schemas, then verifies RLS isolation, private storage policies,
 * sync_push idempotency/conflicts and server-side award uniqueness.
 * Runs under node:test because PGlite is ESM-only (`npm run test:sql`, included in `npm test`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

const MIGRATION = fs.readFileSync(
  new URL('../../supabase/migrations/20261011000000_init.sql', import.meta.url),
  'utf8',
);

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated;
grant usage, select on all sequences in schema storage to authenticated;
`;

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
let pg;

/** Run a query as a given user (JWT sub) under the `authenticated` role, or as `anon` when user is null. */
async function as(user, sql, params = []) {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false);`);
  await pg.exec(user ? 'set role authenticated' : 'set role anon');
  try {
    return await pg.query(sql, params);
  } finally {
    await pg.exec('reset role');
  }
}

const item = (id, version, payload, type = 'workout_set') => ({
  entity_type: type,
  entity_id: id,
  version,
  payload,
});
const push = async (user, items) =>
  (await as(user, 'select public.sync_push($1::jsonb) as r', [JSON.stringify(items)])).rows[0].r;
const count = async (sql) => (await pg.query(sql)).rows[0].n;

describe('Supabase schema (PGlite)', () => {
  before(async () => {
    pg = new PGlite();
    await pg.exec(SUPABASE_STUBS);
    await pg.exec(MIGRATION);
    await pg.exec(`grant usage on schema public to anon, authenticated;
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into auth.users values ('${A}'), ('${B}');`);
  });
  after(async () => {
    await pg.close();
  });

  it('creates a private photo bucket', async () => {
    const r = await pg.query("select public from storage.buckets where id = 'progress-photos'");
    assert.equal(r.rows[0].public, false);
  });

  it('sync_push is idempotent: replaying the same batch never duplicates', async () => {
    const batch = [
      item('set-1', 1, { id: 'set-1', reps: 5 }),
      item('set-2', 1, { id: 'set-2', reps: 6 }),
    ];
    assert.deepEqual(
      (await push(A, batch)).map((x) => x.status),
      ['applied', 'applied'],
    );
    assert.deepEqual(
      (await push(A, batch)).map((x) => x.status),
      ['duplicate', 'duplicate'],
    );
    assert.deepEqual(
      (await push(A, batch)).map((x) => x.status),
      ['duplicate', 'duplicate'],
    );
    assert.equal(
      await count(
        `select count(*)::int as n from public.sync_record where entity_type = 'workout_set' and user_id = '${A}'`,
      ),
      2,
    );
  });

  it('newer versions apply; older or diverged versions are conflicts and never overwrite', async () => {
    await push(A, [item('s-v', 1, { id: 's-v', reps: 5 })]);
    assert.equal((await push(A, [item('s-v', 2, { id: 's-v', reps: 7 })]))[0].status, 'applied');
    const older = await push(A, [item('s-v', 1, { id: 's-v', reps: 1 })]);
    assert.equal(older[0].status, 'conflict');
    assert.equal(older[0].server_version, 2);
    assert.deepEqual(older[0].server_payload, { id: 's-v', reps: 7 });
    assert.equal((await push(A, [item('s-v', 2, { id: 's-v', reps: 99 })]))[0].status, 'conflict');
    const row = await pg.query(
      "select payload->>'reps' as reps from public.sync_record where entity_id = 's-v'",
    );
    assert.equal(row.rows[0].reps, '7');
  });

  it('server rejects a second award with the same idempotency key', async () => {
    const key = 'session_completed:abc:xp-v1';
    assert.equal(
      (
        await push(A, [
          item('xp-1', 1, { id: 'xp-1', idempotency_key: key, amount: 50 }, 'xp_event'),
        ])
      )[0].status,
      'applied',
    );
    assert.equal(
      (
        await push(A, [
          item('xp-2', 1, { id: 'xp-2', idempotency_key: key, amount: 50 }, 'xp_event'),
        ])
      )[0].status,
      'duplicate',
    );
    assert.equal(
      await count(
        `select count(*)::int as n from public.sync_record where entity_type = 'xp_event' and user_id = '${A}'`,
      ),
      1,
    );
    // the same key is independent per user
    assert.equal(
      (
        await push(B, [
          item('xp-1', 1, { id: 'xp-1', idempotency_key: key, amount: 50 }, 'xp_event'),
        ])
      )[0].status,
      'applied',
    );
  });

  it('RLS: users only see and modify their own records', async () => {
    await push(B, [item('b-only', 1, { id: 'b-only' })]);
    assert.equal(
      (await as(A, "select entity_id from public.sync_record where entity_id = 'b-only'")).rows
        .length,
      0,
    );
    const upd = await as(
      A,
      "update public.sync_record set version = 99 where entity_id = 'b-only'",
    );
    assert.equal(upd.affectedRows ?? 0, 0);
    await assert.rejects(
      as(
        A,
        `insert into public.sync_record (user_id, entity_type, entity_id, version, payload) values ('${B}', 'profile', 'x', 1, '{}')`,
      ),
      /row-level security/,
    );
  });

  it('anonymous callers cannot push or read', async () => {
    await assert.rejects(as(null, "select public.sync_push('[]'::jsonb)"));
    await assert.rejects(as(null, 'select * from public.sync_record'));
  });

  it('clients cannot read AI quota state or call the quota function', async () => {
    assert.equal((await as(A, 'select * from public.ai_usage')).rows.length, 0);
    assert.equal((await as(A, 'select * from public.ai_model_state')).rows.length, 0);
    await assert.rejects(as(A, `select public.ai_try_consume('${A}', 5)`), /permission denied/);
  });

  it('ai_try_consume enforces the per-user daily limit', async () => {
    const results = [];
    for (let i = 0; i < 4; i++)
      results.push((await pg.query(`select public.ai_try_consume('${B}', 3) as ok`)).rows[0].ok);
    assert.deepEqual(results, [true, true, true, false]);
  });

  it('users can only manage their own AI consent row', async () => {
    await as(
      A,
      `insert into public.ai_consent (user_id, granted, policy_version) values ('${A}', true, 'v1')`,
    );
    await assert.rejects(
      as(
        A,
        `insert into public.ai_consent (user_id, granted, policy_version) values ('${B}', true, 'v1')`,
      ),
      /row-level security/,
    );
    assert.equal((await as(B, 'select * from public.ai_consent')).rows.length, 0);
  });

  it('storage policies restrict photo objects to the owner folder', async () => {
    await as(
      A,
      `insert into storage.objects (bucket_id, name) values ('progress-photos', '${A}/p1.jpg')`,
    );
    await assert.rejects(
      as(
        A,
        `insert into storage.objects (bucket_id, name) values ('progress-photos', '${B}/evil.jpg')`,
      ),
      /row-level security/,
    );
    assert.equal((await as(B, 'select name from storage.objects')).rows.length, 0);
    assert.equal((await as(A, 'select name from storage.objects')).rows.length, 1);
  });

  it('delete_my_cloud_data removes only the caller’s rows', async () => {
    await as(A, 'select public.delete_my_cloud_data()');
    assert.equal(
      await count(`select count(*)::int as n from public.sync_record where user_id = '${A}'`),
      0,
    );
    assert.equal(
      await count(`select count(*)::int as n from public.ai_consent where user_id = '${A}'`),
      0,
    );
    assert.ok(
      (await count(`select count(*)::int as n from public.sync_record where user_id = '${B}'`)) > 0,
    );
  });
});
