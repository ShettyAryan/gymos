import { addPhoto } from '@/data/local/repositories/photos';
import { EMPTY_PROFILE, getProfile, saveProfile } from '@/data/local/repositories/profile';
import { listExercises } from '@/data/local/repositories/exercises';
import { seedIfNeeded } from '@/data/local/seed';
import {
  addExerciseToSession,
  finishSession,
  logSet,
  startSession,
} from '@/data/local/repositories/workouts';
import { buildExport, deleteAllLocalData } from '@/features/settings/exportData';

import { freshDb } from '../helpers/nodeDb';

describe('export and local deletion', () => {
  it('exports all user records in the documented format, without seed exercises', async () => {
    const db = await freshDb();
    await saveProfile(db, { ...EMPTY_PROFILE, goals: ['strength'] });
    const s = await startSession(db, { kind: 'freeform' });
    const we = await addExerciseToSession(db, s.id, 'push_up');
    await logSet(db, we.id, {
      load_kg: null,
      reps: 10,
      duration_seconds: null,
      distance_m: null,
      rpe: null,
      rir: null,
      is_warmup: false,
      notes: null,
    });
    await finishSession(db, s.id);
    await addPhoto(db, {
      localUri: 'file:///p.jpg',
      category: 'front',
      campaignId: null,
      notes: null,
      cloudBackup: false,
    });

    const exp = (await buildExport(db)) as {
      format: string;
      formatVersion: number;
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(exp.format).toBe('gymos-export');
    expect(exp.formatVersion).toBe(1);
    expect(exp.tables.profile![0]!.goals).toEqual(['strength']); // JSON columns decoded
    expect(exp.tables.workout_set).toHaveLength(1);
    expect(exp.tables.exercise).toHaveLength(0);
    expect(exp.tables.progress_photo).toHaveLength(1);
    expect(JSON.stringify(exp)).not.toMatch(/service_role|GROQ/i);
    db.close();
  });

  it('deletes all local data, returns photo files to remove, and can re-seed', async () => {
    const db = await freshDb();
    await saveProfile(db, EMPTY_PROFILE);
    await addPhoto(db, {
      localUri: 'file:///p.jpg',
      category: 'front',
      campaignId: null,
      notes: null,
      cloudBackup: false,
    });
    const uris = await deleteAllLocalData(db);
    expect(uris).toEqual(['file:///p.jpg']);
    expect(await getProfile(db)).toBeNull();
    expect(await db.all('SELECT * FROM sync_outbox')).toHaveLength(0);
    await seedIfNeeded(db);
    expect((await listExercises(db)).length).toBeGreaterThan(0);
    db.close();
  });
});
