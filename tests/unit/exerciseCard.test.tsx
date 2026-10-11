import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { StaticDatabaseProvider } from '@/data/DatabaseProvider';
import {
  addExerciseToSession,
  getSessionDetail,
  startSession,
  type SessionItem,
} from '@/data/local/repositories/workouts';
import { ExerciseCard } from '@/features/workout/ExerciseCard';

import { freshDb, type TestDb } from '../helpers/nodeDb';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

describe('ExerciseCard (set logging UI)', () => {
  let db: TestDb;
  let item: SessionItem;
  beforeEach(async () => {
    db = await freshDb();
    const s = await startSession(db, { kind: 'freeform' });
    await addExerciseToSession(db, s.id, 'bench_press');
    item = (await getSessionDetail(db, s.id))!.items[0]!;
  });
  afterEach(() => db.close());

  it('persists the set before acknowledging it (rest timer starts only after the write)', async () => {
    // Read synchronously at the exact moment the UI acknowledges the set.
    let rowsAtAck: unknown = null;
    const onLogged = jest.fn(() => {
      rowsAtAck = db.raw.prepare('SELECT load_kg, reps FROM workout_set').all();
    });
    await render(
      <StaticDatabaseProvider db={db}>
        <ExerciseCard
          item={item}
          units="metric"
          previous={null}
          recommendation={null}
          replacedName={null}
          onLogged={onLogged}
          onDeleteSet={jest.fn()}
        />
      </StaticDatabaseProvider>,
    );
    await fireEvent.changeText(screen.getByLabelText('Load in kg'), '60');
    await fireEvent.changeText(screen.getByLabelText('Reps'), '8');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() =>
      expect(onLogged).toHaveBeenCalledWith(item.exercise!.default_rest_seconds, 'Bench Press'),
    );
    expect(rowsAtAck).toEqual([{ load_kg: 60, reps: 8 }]);
    // also queued for sync in the same transaction
    expect(
      (await db.all('SELECT * FROM sync_outbox WHERE entity_type = ?', ['workout_set'])).length,
    ).toBe(1);
  });

  it('shows previous performance and does not save an invalid set', async () => {
    await render(
      <StaticDatabaseProvider db={db}>
        <ExerciseCard
          item={item}
          units="imperial"
          previous={{
            sessionId: 'x',
            date: '2026-10-01',
            title: 'Upper',
            completedAt: null,
            sets: [],
          }}
          recommendation={null}
          replacedName={null}
          onLogged={jest.fn()}
          onDeleteSet={jest.fn()}
        />
      </StaticDatabaseProvider>,
    );
    expect(screen.getByLabelText(/Last time on 2026-10-01/)).toBeTruthy();
    expect(screen.getByLabelText('Load in lb')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Reps'), '8');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(async () => expect(await db.all('SELECT * FROM workout_set')).toHaveLength(0));
  });
});
