import { Stack as RouterStack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import {
  Button,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  LoadingState,
  Metric,
  MetricRow,
  Notice,
  OfflineBanner,
  ProgressBar,
  Row,
  Screen,
  Split,
  Text,
  UndoBar,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getPreferences, incrementCounter } from '@/data/local/repositories/settings';
import {
  cancelSession,
  deleteSet,
  elapsedSeconds,
  finishSession,
  getActiveSession,
  getLatestRecommendation,
  getPreviousPerformance,
  getSessionDetail,
  NoSetsLoggedError,
  pauseSession,
  restoreSet,
  resumeSession,
} from '@/data/local/repositories/workouts';
import { isTargetSet, type WorkoutSet } from '@/domain/models/types';
import { classifyCompletion, STATUS_LABEL } from '@/domain/rules/sessionState';
import { ExerciseCard } from '@/features/workout/ExerciseCard';
import { useUnits } from '@/features/workout/useUnits';
import { useRestTimer } from '@/state/restTimer';
import { Reveal } from '@/components/motion';
import { useNow } from '@/state/useNow';
import { colors, spacing } from '@/theme/tokens';
import { formatClock } from '@/utils/dates';
import { haptics } from '@/utils/haptics';

export default function ActiveWorkoutScreen() {
  const units = useUnits();
  const q = useQuery(async (db) => {
    const session = await getActiveSession(db);
    if (!session) return null;
    const detail = (await getSessionDetail(db, session.id))!;
    const ids = [...new Set(detail.items.map((i) => i.we.exercise_id))];
    const previous = new Map(
      await Promise.all(
        ids.map(async (id) => [id, await getPreviousPerformance(db, id, session.id)] as const),
      ),
    );
    const recos = new Map(
      await Promise.all(
        ids.map(async (id) => [id, await getLatestRecommendation(db, id)] as const),
      ),
    );
    return { detail, previous, recos, prefs: await getPreferences(db) };
  });
  const now = useNow(1000);
  const rest = useRestTimer();
  const [undo, setUndo] = useState<WorkoutSet | null>(null);

  const pause = useMutation((db, id: string) => pauseSession(db, id));
  const resume = useMutation((db, id: string) => resumeSession(db, id));
  const del = useMutation((db, id: string) => deleteSet(db, id));
  const restore = useMutation((db, id: string) => restoreSet(db, id));
  const finish = useMutation(async (db, id: string) => {
    const r = await finishSession(db, id);
    await incrementCounter(db, 'session_completed');
    return r;
  });
  const cancel = useMutation((db, id: string) => cancelSession(db, id));
  const dismissUndo = useCallback(() => setUndo(null), []);
  // Rest finished: one gentle haptic, then clear the timer.
  const restEndsAt = rest.endsAt;
  const restOver = !!restEndsAt && now.getTime() >= restEndsAt;
  const stopRest = rest.stop;
  useEffect(() => {
    if (!restOver) return;
    haptics.alert();
    stopRest();
  }, [restOver, stopRest]);

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (q.data === undefined) return <LoadingState label="Loading workout…" />;
  if (q.data === null) {
    return (
      <Screen>
        <EmptyState
          title="No active workout"
          message="Start one from Home or Train."
          action={<Button label="Go home" onPress={() => router.replace('/')} />}
        />
      </Screen>
    );
  }

  const { detail, previous, recos, prefs } = q.data;
  const { session, items } = detail;
  const paused = !!session.paused_at;
  const elapsed = elapsedSeconds(session, now);
  const restLeft = rest.endsAt ? Math.max(0, Math.ceil((rest.endsAt - now.getTime()) / 1000)) : 0;
  const adaptation = session.adaptation as { proposal?: { rationale?: string[] } } | null;

  const preview = classifyCompletion(
    session.session_type,
    items.map((i) => ({
      disposition: i.we.disposition,
      targetSets: i.we.target?.sets ?? null,
      loggedWorkingSets: i.sets.filter(isTargetSet).length,
    })),
  );
  const targets = items.filter(
    (i) => i.we.target && (i.we.disposition === 'included' || i.we.disposition === 'substituted'),
  );
  const met = targets.filter(
    (i) => i.sets.filter(isTargetSet).length >= (i.we.target?.sets ?? 0),
  ).length;
  // Superset labels in order of first appearance (A, B, …) and who comes next within each group.
  const groupLetter = new Map<string, string>();
  for (const i of items) {
    const g = i.we.superset_group;
    if (g && !groupLetter.has(g)) groupLetter.set(g, String.fromCharCode(65 + groupLetter.size));
  }
  const nextInGroup = (idx: number): string | null => {
    const g = items[idx]?.we.superset_group;
    if (!g) return null;
    const next = items.slice(idx + 1).find((i) => i.we.superset_group === g);
    return next ? (next.exercise?.name ?? 'next exercise') : null;
  };
  const totalSets = items.reduce((n, i) => n + i.sets.filter(isTargetSet).length, 0);

  const onFinish = () => {
    if (!preview) {
      Alert.alert(
        'Nothing logged yet',
        'Log at least one working set to finish, or cancel this workout.',
        [
          { text: 'Keep going', style: 'cancel' },
          { text: 'Cancel workout', style: 'destructive', onPress: onCancel },
        ],
      );
      return;
    }
    const msg =
      session.session_type === 'freeform'
        ? 'Save this freeform workout?'
        : `This will be saved as "${STATUS_LABEL[preview]}" — ${met} of ${targets.length} exercises reached their target.`;
    Alert.alert('Finish workout?', msg, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          try {
            await finish.run(session.id);
            haptics.success();
            rest.stop();
            router.replace({
              pathname: '/workout/[id]',
              params: { id: session.id, justFinished: '1' },
            });
          } catch (e) {
            Alert.alert(
              e instanceof NoSetsLoggedError ? 'Nothing logged yet' : 'Could not finish',
              e instanceof Error ? e.message : '',
            );
          }
        },
      },
    ]);
  };

  function onCancel() {
    Alert.alert(
      'Cancel workout?',
      'The session is marked cancelled. Any sets you logged stay in your history.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Cancel workout',
          style: 'destructive',
          onPress: async () => {
            await cancel.run(session.id);
            rest.stop();
            router.replace('/');
          },
        },
      ],
    );
  }

  return (
    <Screen
      edges={['bottom']}
      footer={
        <View style={{ gap: spacing.sm }}>
          {undo ? (
            <UndoBar
              message="Set deleted"
              onUndo={() => {
                restore.run(undo.id);
                setUndo(null);
              }}
              onDismiss={dismissUndo}
            />
          ) : null}
          {rest.endsAt && restLeft > 0 ? (
            <Reveal>
              <View
                style={{ gap: spacing.sm }}
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Rest ${formatClock(restLeft)} remaining`}
              >
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text variant="label" muted>
                      Rest
                    </Text>
                    <Text variant="metric" color={colors.accent}>
                      {formatClock(restLeft)}
                    </Text>
                  </View>
                  <Button label="+30s" compact variant="secondary" onPress={() => rest.add(30)} />
                  <Button label="Skip" compact variant="ghost" onPress={rest.stop} />
                </Row>
                <ProgressBar
                  value={rest.duration ? restLeft / rest.duration : 0}
                  label="Rest remaining"
                />
              </View>
            </Reveal>
          ) : null}
          <Split>
            <Button
              label="Add exercise"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/exercises',
                  params: { pick: 'add_to_workout', target: session.id },
                })
              }
            />
            <Button label="Finish" onPress={onFinish} loading={finish.pending} />
          </Split>
        </View>
      }
    >
      <RouterStack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Row gap={0}>
              <IconButton
                icon={paused ? 'play' : 'pause'}
                label={paused ? 'Resume workout' : 'Pause workout'}
                onPress={() => (paused ? resume.run(session.id) : pause.run(session.id))}
              />
              <IconButton
                icon="close"
                label="Cancel workout"
                onPress={onCancel}
                color={colors.textMuted}
              />
            </Row>
          ),
        }}
      />
      <OfflineBanner />
      <Header
        live={!paused}
        eyebrow={
          session.session_type === 'adapted'
            ? 'Adapted session'
            : session.session_type === 'planned'
              ? 'Planned session'
              : 'Freeform session'
        }
        title={session.title}
      />
      <MetricRow>
        <Metric label={paused ? 'Paused' : 'Elapsed'} value={formatClock(elapsed)} live={!paused} />
        <Metric label="Sets" value={String(totalSets)} />
        <Metric
          label="Done"
          value={targets.length ? `${met}/${targets.length}` : '—'}
          hint={targets.length ? 'exercises' : undefined}
        />
      </MetricRow>
      <Text variant="caption" faint>
        Every set is saved on this device the moment you log it.
      </Text>
      {session.session_type === 'adapted' ? (
        <Notice
          tone="info"
          title="Adapted from your plan"
          message={`Your original ${session.original_plan_snapshot?.title ?? 'session'} is preserved unchanged. ${adaptation?.proposal?.rationale?.join(' ') ?? ''}`}
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="Add your first exercise" message="Use “Add exercise” below." />
      ) : null}
      {items.map((item, idx) => (
        <ExerciseCard
          key={item.we.id}
          item={item}
          hasNext={idx < items.length - 1}
          supersetLabel={
            item.we.superset_group ? `Superset ${groupLetter.get(item.we.superset_group)}` : null
          }
          nextInSuperset={nextInGroup(idx)}
          units={units}
          previous={previous.get(item.we.exercise_id) ?? null}
          recommendation={recos.get(item.we.exercise_id) ?? null}
          replacedName={
            item.we.replaced_exercise_id
              ? (session.original_plan_snapshot?.exercises.find(
                  (e) => e.exerciseId === item.we.replaced_exercise_id,
                )?.exerciseName ?? null)
              : null
          }
          onLogged={(secs, label) => prefs.restTimerAuto && rest.start(secs, label)}
          onDeleteSet={async (s) => {
            await del.run(s.id);
            setUndo(s);
          }}
        />
      ))}
    </Screen>
  );
}
