import { hasValidConsent, recordConsent } from '@/data/local/repositories/aiConsent';
import { addPhoto } from '@/data/local/repositories/photos';
import { EMPTY_PROFILE, getProfile, saveProfile } from '@/data/local/repositories/profile';
import {
  getActiveProgramme,
  getProgrammeDetail,
  validateProgrammeById,
} from '@/data/local/repositories/programmes';
import { updatePreferences } from '@/data/local/repositories/settings';
import { requestAi } from '@/features/coach/aiClient';
import { catalogueFor, coachContext, profileContext } from '@/features/coach/aiContext';
import { AI_POLICY_VERSION } from '@/features/coach/disclosure';
import { generateProgrammeDraft } from '@/features/coach/programmeDraft';
import { getExerciseMap } from '@/data/local/repositories/exercises';

import { freshDb, type TestDb } from '../helpers/nodeDb';

jest.mock('@/data/remote/supabaseClient', () => ({
  getSupabase: () => null,
  getUserId: async () => null,
}));

async function setup(db: TestDb) {
  await saveProfile(db, {
    ...EMPTY_PROFILE,
    display_name: 'Private Name',
    age: 33,
    body_weight_kg: 80,
    goals: ['strength'],
    experience: 'intermediate',
    weekly_target: 3,
    preferred_days: [1, 3, 5],
    session_minutes: 60,
    location: 'home_gym',
    equipment: ['barbell', 'rack', 'bench', 'dumbbell'],
  });
}

describe('AI client safeguards', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await freshDb();
    await setup(db);
  });
  afterEach(() => db.close());

  it('refuses to send anything without explicit opt-in and consent for the current policy', async () => {
    const r = await requestAi(db, {
      task: 'coach_question',
      input: {
        question: 'hi',
        context: {
          profile: null,
          programmeSummary: null,
          recentSessions: [],
          weekSummary: null,
          campaign: null,
        },
      },
    });
    expect(r).toMatchObject({ ok: false, error: 'consent_required' });
    await updatePreferences(db, { aiEnabled: true });
    await recordConsent(db, true, 'some-old-policy');
    expect(await hasValidConsent(db, AI_POLICY_VERSION)).toBe(false);
    await recordConsent(db, true, AI_POLICY_VERSION);
    expect(await hasValidConsent(db, AI_POLICY_VERSION)).toBe(true);
    await recordConsent(db, false, AI_POLICY_VERSION); // revoke
    expect(await hasValidConsent(db, AI_POLICY_VERSION)).toBe(false);
  });

  it('without a configured backend (and mock off) AI is unavailable but nothing else breaks', async () => {
    await updatePreferences(db, { aiEnabled: true });
    await recordConsent(db, true, AI_POLICY_VERSION);
    const r = await requestAi(db, {
      task: 'coach_question',
      input: {
        question: 'hi',
        context: {
          profile: null,
          programmeSummary: null,
          recentSessions: [],
          weekSummary: null,
          campaign: null,
        },
      },
    });
    expect(r).toMatchObject({ ok: false, error: 'ai_unavailable' });
  });

  it('AI context is minimal: no name, age, body weight, photos or local file paths', async () => {
    await addPhoto(db, {
      localUri: 'file:///private/secret.jpg',
      category: 'front',
      campaignId: null,
      notes: 'private note',
      cloudBackup: false,
    });
    const ctx = await coachContext(db);
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/Private Name|secret\.jpg|file:\/\/|private note/);
    expect(json).not.toMatch(/"age"|body_weight|height/);
    expect(Object.keys(ctx.profile).sort()).toEqual(
      [
        'avoidPatterns',
        'customGoal',
        'equipment',
        'experience',
        'goals',
        'limitationsNote',
        'preferredWeekdays',
        'sessionMinutes',
        'sessionsPerWeek',
        'units',
      ].sort(),
    );
  });

  it('catalogue only offers exercises doable with the user’s equipment and preferences', async () => {
    const ex = await getExerciseMap(db);
    const cat = catalogueFor(ex, { ...(await getProfile(db))!, avoid_patterns: ['hinge'] });
    expect(cat.every((c) => c.pattern !== 'hinge')).toBe(true);
    expect(
      cat.every((c) =>
        c.equipment.every((e) => ['barbell', 'rack', 'bench', 'dumbbell'].includes(e)),
      ),
    ).toBe(true);
    expect(profileContext(null).goals).toEqual([]);
  });

  it('mock AI programme draft is saved as a DRAFT only — never activated — and passes validation', async () => {
    await updatePreferences(db, { aiEnabled: true, mockAi: true });
    await recordConsent(db, true, AI_POLICY_VERSION);
    const steps: string[] = [];
    const r = await generateProgrammeDraft(db, (p) => steps.push(p.step));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mock).toBe(true);
    expect(r.programme.status).toBe('draft');
    expect(r.programme.source).toBe('ai');
    expect(await getActiveProgramme(db)).toBeNull();
    const detail = await getProgrammeDetail(db, r.programme.id);
    expect(detail!.days).toHaveLength(3);
    expect(detail!.days.map((d) => d.day.weekday)).toEqual([1, 3, 5]);
    const errors = (await validateProgrammeById(db, r.programme.id)).filter(
      (i) => i.level === 'error',
    );
    expect(errors).toEqual([]);
    expect(steps.length).toBeGreaterThan(2);
  });
});
