import { totalXp } from '@/data/local/repositories/awards';
import { EMPTY_PROFILE, getProfile, saveProfile } from '@/data/local/repositories/profile';
import { addPhoto, deletePhotoRecord, listPhotos } from '@/data/local/repositories/photos';
import {
  addExerciseToSession,
  finishSession,
  getSessionDetail,
  logSet,
  startSession,
} from '@/data/local/repositories/workouts';
import {
  applyRemote,
  backoffMs,
  listOpenConflicts,
  outboxStats,
  recoverInFlight,
  resolveConflict,
  runSync,
  SYNC_CONFIG,
} from '@/data/remote/sync/engine';
import { processPhotoQueue } from '@/data/remote/sync/photoQueue';
import type { SetValues } from '@/domain/validation/set';

import { FakeServer } from '../helpers/fakeServer';
import { freshDb, type TestDb } from '../helpers/nodeDb';

const v = (reps: number): SetValues => ({
  load_kg: null,
  reps,
  duration_seconds: null,
  distance_m: null,
  rpe: null,
  rir: null,
  is_warmup: false,
  notes: null,
});

async function offlineWorkout(db: TestDb) {
  const s = await startSession(db, { kind: 'freeform' });
  const we = await addExerciseToSession(db, s.id, 'push_up');
  await logSet(db, we.id, v(10));
  await logSet(db, we.id, v(12));
  await finishSession(db, s.id);
  return s.id;
}

const outboxCount = async (db: TestDb) =>
  (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))!.n;

describe('sync engine', () => {
  let db: TestDb;
  let server: FakeServer;
  beforeEach(async () => {
    db = await freshDb();
    server = new FakeServer();
  });
  afterEach(() => db.close());

  it('offline mutations are queued and sync once online; the outbox empties only after acknowledgement', async () => {
    const sessionId = await offlineWorkout(db);
    const queued = await outboxCount(db);
    expect(queued).toBeGreaterThan(5); // session, exercise, sets, attendance, xp, badge…
    server.failNext = ['network'];
    const offline = await runSync(db, server.transport(), { random: () => 0 });
    expect(offline.status).toBe('offline');
    expect(await outboxCount(db)).toBe(queued); // nothing lost
    expect((await outboxStats(db)).failed).toBe(queued);

    // backoff respected: an immediate retry does not resend
    const tooSoon = await runSync(db, server.transport());
    expect(tooSoon.pushed).toBe(0);
    await db.run('UPDATE sync_outbox SET next_attempt_at = NULL');

    const online = await runSync(db, server.transport());
    expect(online.status).toBe('ok');
    expect(await outboxCount(db)).toBe(0);
    expect(server.count('workout_session')).toBe(1);
    expect(server.count('workout_set')).toBe(2);
    expect(server.records.get(`workout_session|${sessionId}`)!.payload.status).toBe(
      'completed_as_planned',
    );
  });

  it('a timeout after the server committed (lost ack) retries safely without duplicates', async () => {
    await offlineWorkout(db);
    server.failNext = ['ack_lost'];
    await runSync(db, server.transport());
    const afterLost = server.records.size;
    expect(await outboxCount(db)).toBeGreaterThan(0); // client could not confirm → kept
    await db.run('UPDATE sync_outbox SET next_attempt_at = NULL');
    const retry = await runSync(db, server.transport());
    expect(retry.duplicates).toBeGreaterThan(0);
    expect(retry.pushed).toBe(0);
    expect(server.records.size).toBe(afterLost);
    expect(server.count('xp_event')).toBe(1);
    expect(await outboxCount(db)).toBe(0);
  });

  it('auth expiry is not counted as a failed attempt and keeps items pending', async () => {
    await saveProfile(db, EMPTY_PROFILE);
    server.failNext = ['auth'];
    const r = await runSync(db, server.transport());
    expect(r.status).toBe('auth_required');
    const row = await db.first<{ state: string; attempt_count: number }>(
      'SELECT state, attempt_count FROM sync_outbox',
    );
    expect(row).toEqual({ state: 'pending', attempt_count: 0 });
  });

  it('stops automatic retries after the bounded number of attempts (visible as failed)', async () => {
    await saveProfile(db, EMPTY_PROFILE);
    for (let i = 0; i < SYNC_CONFIG.maxAttempts + 2; i++) {
      server.failNext = ['server'];
      await db.run('UPDATE sync_outbox SET next_attempt_at = NULL');
      await runSync(db, server.transport());
    }
    expect(server.pushCalls).toBe(SYNC_CONFIG.maxAttempts);
    expect((await outboxStats(db)).stuck).toBe(1);
    expect(await getProfile(db)).not.toBeNull(); // local data untouched
  });

  it('backoff grows exponentially with jitter and is capped', () => {
    expect(backoffMs(1, () => 0)).toBe(SYNC_CONFIG.baseBackoffMs / 2);
    expect(backoffMs(3, () => 1)).toBe(SYNC_CONFIG.baseBackoffMs * 4);
    expect(backoffMs(50, () => 1)).toBe(SYNC_CONFIG.maxBackoffMs);
  });

  it('crash mid-sync: in-flight items return to the queue on launch', async () => {
    await saveProfile(db, EMPTY_PROFILE);
    await db.run("UPDATE sync_outbox SET state = 'in_flight'");
    await recoverInFlight(db);
    expect((await outboxStats(db)).pending).toBe(1);
  });

  it('restores everything on a new device without duplicating XP, and keeps device-local photo paths', async () => {
    await offlineWorkout(db);
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['strength'] });
    await addPhoto(db, {
      localUri: 'file:///private/a.jpg',
      category: 'front',
      campaignId: null,
      notes: null,
      cloudBackup: true,
    });
    await runSync(db, server.transport());
    const photoPayload = [...server.records.values()].find(
      (r) => r.entity_type === 'progress_photo',
    )!.payload;
    expect(photoPayload.local_uri).toBeUndefined(); // device path never leaves the device

    const device2 = await freshDb();
    const r = await runSync(device2, server.transport());
    expect(r.status).toBe('ok');
    expect(r.pulled).toBe(server.records.size);
    expect((await getProfile(device2))?.goals).toEqual(['strength']);
    expect(await totalXp(device2)).toBe(await totalXp(db));
    // replaying the same pull is harmless
    await device2.run('DELETE FROM app_setting WHERE key = ?', ['sync_cursor']);
    await runSync(device2, server.transport());
    expect(await totalXp(device2)).toBe(await totalXp(db));
    const photos = await listPhotos(device2);
    expect(photos[0]!.local_uri).toBeNull();
    device2.close();
  });

  it('remote change for a record with unsent local edits becomes a visible conflict — local is kept', async () => {
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['strength'] });
    await runSync(db, server.transport());
    server.remoteEdit('profile', 'profile', { goals: ['consistency'] });
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['hypertrophy'] }); // local unsent edit (version 2)
    const r = await runSync(db, server.transport());
    expect(r.conflicts).toBe(1);
    expect((await getProfile(db))?.goals).toEqual(['hypertrophy']);
    const conflicts = await listOpenConflicts(db);
    expect(conflicts).toHaveLength(1);

    await resolveConflict(db, conflicts[0]!.id, 'keep_local');
    const r2 = await runSync(db, server.transport());
    expect(r2.pushed).toBe(1);
    expect(server.records.get('profile|profile')!.payload.goals).toEqual(['hypertrophy']);
    expect(await listOpenConflicts(db)).toHaveLength(0);
  });

  it('resolving a conflict with the cloud copy replaces local and drops the local change', async () => {
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['strength'] });
    await runSync(db, server.transport());
    server.remoteEdit('profile', 'profile', { goals: ['consistency'] });
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['hypertrophy'] });
    await runSync(db, server.transport());
    const [c] = await listOpenConflicts(db);
    await resolveConflict(db, c!.id, 'use_remote');
    expect((await getProfile(db))?.goals).toEqual(['consistency']);
    expect(await outboxCount(db)).toBe(0);
  });

  it('pulled award rows with an existing idempotency key are skipped (no double XP)', async () => {
    const sessionId = await offlineWorkout(db);
    const xp = await db.first<Record<string, unknown>>('SELECT * FROM xp_event');
    const before = await totalXp(db);
    await applyRemote(db, [
      {
        entity_type: 'xp_event',
        entity_id: 'other-id',
        version: 1,
        updated_at: 'x',
        payload: { ...xp, id: 'other-id', source_entity_id: sessionId },
      },
    ]);
    expect(await totalXp(db)).toBe(before);
  });

  it('remote never overwrites a newer local record', async () => {
    const p = await saveProfile(db, { ...EMPTY_PROFILE, age: 30 });
    await saveProfile(db, { ...EMPTY_PROFILE, age: 31 });
    await db.run('DELETE FROM sync_outbox');
    await applyRemote(db, [
      {
        entity_type: 'profile',
        entity_id: p.id,
        version: 1,
        updated_at: 'x',
        payload: { ...p, age: 99 },
      },
    ]);
    expect((await getProfile(db))?.age).toBe(31);
  });

  it('session sets survive sync round-trip unchanged', async () => {
    const id = await offlineWorkout(db);
    await runSync(db, server.transport());
    const device2 = await freshDb();
    await runSync(device2, server.transport());
    const d = await getSessionDetail(device2, id);
    expect(d!.items[0]!.sets.map((s) => s.reps)).toEqual([10, 12]);
    expect(d!.session.status).toBe('completed_as_planned');
    device2.close();
  });
});

describe('photo upload queue', () => {
  it('uploads pending photos to a private per-user path and deletes cloud copies of deleted photos', async () => {
    const db = await freshDb();
    const uploads: string[] = [];
    const removed: string[] = [];
    const storage = {
      userFolder: async () => 'user-123',
      upload: async (path: string) => {
        uploads.push(path);
      },
      remove: async (paths: string[]) => {
        removed.push(...paths);
      },
    };
    const p = await addPhoto(db, {
      localUri: 'file:///private/a.jpg',
      category: 'side',
      campaignId: null,
      notes: null,
      cloudBackup: true,
    });
    await addPhoto(db, {
      localUri: 'file:///private/b.jpg',
      category: 'front',
      campaignId: null,
      notes: null,
      cloudBackup: false,
    });
    const r1 = await processPhotoQueue(db, storage, async () => new ArrayBuffer(4));
    expect(r1.uploaded).toBe(1);
    expect(uploads[0]).toMatch(/^user-123\/[0-9a-f-]{36}\.jpg$/);
    const photos = await listPhotos(db);
    expect(photos.find((x) => x.id === p.id)).toMatchObject({
      upload_status: 'uploaded',
      remote_path: uploads[0],
    });
    expect(photos.find((x) => x.id !== p.id)?.upload_status).toBe('local_only'); // local-only mode respected

    await deletePhotoRecord(db, p.id);
    const r2 = await processPhotoQueue(db, storage, async () => new ArrayBuffer(4));
    expect(r2.deleted).toBe(1);
    expect(removed).toEqual([uploads[0]]);
    db.close();
  });

  it('a failed upload is marked failed and retried later', async () => {
    const db = await freshDb();
    let fail = true;
    const storage = {
      userFolder: async () => 'u',
      upload: async () => {
        if (fail) throw new Error('network down');
      },
      remove: async () => {},
    };
    await addPhoto(db, {
      localUri: 'file:///x.jpg',
      category: 'front',
      campaignId: null,
      notes: null,
      cloudBackup: true,
    });
    expect((await processPhotoQueue(db, storage, async () => new ArrayBuffer(1))).failed).toBe(1);
    expect((await listPhotos(db))[0]).toMatchObject({
      upload_status: 'failed',
      upload_error: 'network down',
    });
    fail = false;
    expect((await processPhotoQueue(db, storage, async () => new ArrayBuffer(1))).uploaded).toBe(1);
    db.close();
  });
});
