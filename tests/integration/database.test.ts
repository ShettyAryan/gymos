import fs from 'fs';
import os from 'os';
import path from 'path';

import { getSchemaVersion, LATEST_SCHEMA_VERSION, runMigrations } from '@/data/local/migrations';
import { listExercises } from '@/data/local/repositories/exercises';
import { EMPTY_PROFILE, getProfile, saveProfile } from '@/data/local/repositories/profile';
import { getPreferences, updatePreferences } from '@/data/local/repositories/settings';
import { seedIfNeeded } from '@/data/local/seed';
import { SEED_EXERCISES } from '@/data/local/seed/exercises';
import { saveEntity, softDelete } from '@/data/local/store';
import type { Profile } from '@/domain/models/types';

import { freshDb, openTestDb } from '../helpers/nodeDb';

type OutboxRow = {
  entity_type: string;
  entity_id: string;
  operation: string;
  entity_version: number;
  state: string;
  payload: string;
};

describe('migrations', () => {
  it('migrates an empty database to the latest version and is idempotent', async () => {
    const db = openTestDb();
    expect(await getSchemaVersion(db)).toBe(0);
    expect(await runMigrations(db)).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION });
    expect(await runMigrations(db)).toEqual({
      from: LATEST_SCHEMA_VERSION,
      to: LATEST_SCHEMA_VERSION,
    });
    db.close();
  });

  it('refuses to run against a newer schema without touching data', async () => {
    const db = openTestDb();
    await db.exec('PRAGMA user_version = 999');
    await expect(runMigrations(db)).rejects.toThrow(/newer than this app/);
    db.close();
  });
});

describe('seed library', () => {
  it('seeds every exercise once and is idempotent', async () => {
    const db = await freshDb();
    expect(await seedIfNeeded(db)).toBe(false);
    expect(await listExercises(db)).toHaveLength(SEED_EXERCISES.length);
    db.close();
  });

  it('has unique ids and every alternative references an existing exercise', () => {
    const ids = new Set(SEED_EXERCISES.map((e) => e.id));
    expect(ids.size).toBe(SEED_EXERCISES.length);
    for (const e of SEED_EXERCISES) for (const a of e.alternatives) expect(ids.has(a)).toBe(true);
  });

  it('filters by muscle, search and available equipment', async () => {
    const db = await freshDb();
    const bodyweightOnly = await listExercises(db, { availableEquipment: [] });
    expect(bodyweightOnly.length).toBeGreaterThan(5);
    expect(bodyweightOnly.every((e) => e.equipment.length === 0)).toBe(true);
    const chest = await listExercises(db, { muscle: 'chest' });
    expect(chest.some((e) => e.id === 'bench_press')).toBe(true);
    const search = await listExercises(db, { search: 'squat' });
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((e) => /squat/i.test(e.name))).toBe(true);
    db.close();
  });
});

describe('write path: entity + outbox atomicity', () => {
  it('queues an outbox item in the same transaction as the write', async () => {
    const db = await freshDb();
    const p = await saveProfile(db, { ...EMPTY_PROFILE, goals: ['strength'] });
    expect(p.version).toBe(1);
    const outbox = await db.all<OutboxRow>('SELECT * FROM sync_outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity_type: 'profile',
      entity_id: 'profile',
      operation: 'upsert',
      entity_version: 1,
      state: 'pending',
    });
    db.close();
  });

  it('coalesces repeated edits into one pending outbox item with the latest version', async () => {
    const db = await freshDb();
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['strength'] });
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['hypertrophy'] });
    const p = await saveProfile(db, { ...EMPTY_PROFILE, goals: ['consistency'] });
    expect(p.version).toBe(3);
    const outbox = await db.all<OutboxRow>('SELECT * FROM sync_outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.entity_version).toBe(3);
    expect(JSON.parse(outbox[0]!.payload).goals).toEqual(['consistency']);
    db.close();
  });

  it('does not coalesce into an in-flight item', async () => {
    const db = await freshDb();
    await saveProfile(db, EMPTY_PROFILE);
    await db.run("UPDATE sync_outbox SET state = 'in_flight'");
    await saveProfile(db, { ...EMPTY_PROFILE, age: 30 });
    const outbox = await db.all<OutboxRow>('SELECT * FROM sync_outbox ORDER BY entity_version');
    expect(outbox.map((o) => [o.state, o.entity_version])).toEqual([
      ['in_flight', 1],
      ['pending', 2],
    ]);
    db.close();
  });

  it('rolls back both the write and the outbox item when the transaction fails', async () => {
    const db = await freshDb();
    await expect(
      db.transaction(async (tx) => {
        await saveProfile(tx, EMPTY_PROFILE);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await getProfile(db)).toBeNull();
    expect(await db.all('SELECT * FROM sync_outbox')).toHaveLength(0);
    db.close();
  });

  it('soft delete keeps a tombstone and queues a delete operation', async () => {
    const db = await freshDb();
    await saveEntity<Profile>(db, 'profile', { ...EMPTY_PROFILE, id: 'x' });
    await softDelete(db, 'profile', 'x');
    const row = await db.first<{ deleted_at: string | null; version: number }>(
      'SELECT deleted_at, version FROM profile WHERE id = ?',
      ['x'],
    );
    expect(row?.deleted_at).toBeTruthy();
    expect(row?.version).toBe(2);
    const outbox = await db.all<OutboxRow>('SELECT * FROM sync_outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.operation).toBe('delete');
    db.close();
  });
});

describe('persistence across restart', () => {
  it('profile and preferences survive closing and reopening the database file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-'));
    const file = path.join(dir, 'gymos.db');
    const a = await freshDb(file);
    await saveProfile(a, {
      ...EMPTY_PROFILE,
      goals: ['strength'],
      unit_system: 'imperial',
      preferred_days: [1, 3, 5],
    });
    await updatePreferences(a, { restTimerAuto: false });
    a.close();

    const b = await freshDb(file); // simulated relaunch: migrations + seed run again
    expect(await getProfile(b)).toMatchObject({
      goals: ['strength'],
      unit_system: 'imperial',
      preferred_days: [1, 3, 5],
    });
    expect((await getPreferences(b)).restTimerAuto).toBe(false);
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
