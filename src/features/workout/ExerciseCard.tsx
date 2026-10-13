import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, IconButton, Notice, Row, StatusPill, Text } from '@/components';
import { animateNextLayout, PopIn, Reveal } from '@/components/motion';
import { ActionSheet, type SheetAction } from '@/components/Sheet';
import { useMutation } from '@/data/DatabaseProvider';
import {
  deferExercise,
  logSet,
  setExerciseFinished,
  setIssueFlag,
  setRecommendationStatus,
  toggleSessionSuperset,
  undeferExercise,
  undoSubstitution,
  updateSet,
  type PerformanceEntry,
  type Recommendation,
  type SessionItem,
} from '@/data/local/repositories/workouts';
import { isTargetSet, type WorkoutSet } from '@/domain/models/types';
import { DECISION_LABEL } from '@/domain/rules/progression';
import { formatPrescription } from '@/features/programme/format';
import { colors, spacing } from '@/theme/tokens';
import { formatDateKey } from '@/utils/dates';
import { haptics } from '@/utils/haptics';
import { formatLoad, type UnitSystem } from '@/utils/units';

import { formatSet, formatSetList } from './formatSet';
import { draftFromSet, SetInput, valuesFromDraft, type SetDraft } from './SetInput';

type Props = {
  item: SessionItem;
  units: UnitSystem;
  previous: PerformanceEntry | null;
  recommendation: Recommendation | null;
  replacedName: string | null;
  /** Superset label (e.g. "Superset A") when this exercise is part of one. */
  supersetLabel?: string | null;
  /** Name of the next exercise in the superset; null when this is the last one (rest after it). */
  nextInSuperset?: string | null;
  /** Whether there is an exercise after this one (to offer "superset with next"). */
  hasNext: boolean;
  onLogged: (restSeconds: number, label: string) => void;
  onDeleteSet: (set: WorkoutSet) => void;
};

const kindOf = (s: WorkoutSet) =>
  s.is_warmup ? 'warmup' : s.set_kind === 'drop' ? 'drop' : 'normal';

export function ExerciseCard({
  item,
  units,
  previous,
  recommendation,
  replacedName,
  supersetLabel,
  nextInSuperset,
  hasNext,
  onLogged,
  onDeleteSet,
}: Props) {
  const { we, exercise, sets } = item;
  const t = exercise?.logging_type ?? 'weight_reps';
  const working = sets.filter(isTargetSet);
  const target = we.target;
  const targetMet = target ? working.length >= target.sets : false;
  const finished = !!we.finished_at;
  const inactive = we.disposition === 'deferred' || we.disposition === 'removed';
  const name = exercise?.name ?? 'Exercise';

  const initial = (): SetDraft => {
    const last = [...sets].reverse().find((s) => !s.is_warmup);
    if (last) return draftFromSet(last, t, units);
    if (
      recommendation &&
      recommendation.status !== 'dismissed' &&
      recommendation.suggestion.loadKg !== null
    ) {
      return draftFromSet(
        {
          load_kg: recommendation.suggestion.loadKg,
          reps: recommendation.suggestion.reps,
          duration_seconds: recommendation.suggestion.durationSeconds,
        },
        t,
        units,
      );
    }
    if (previous?.sets[0]) return draftFromSet(previous.sets[0], t, units);
    return draftFromSet(target ? { reps: target.repMin } : null, t, units);
  };
  const [draft, setDraft] = useState<SetDraft>(initial);
  const [editing, setEditing] = useState<WorkoutSet | null>(null);
  const [expanded, setExpanded] = useState(!inactive && !finished);
  const [menuOpen, setMenuOpen] = useState(false);
  const [setMenu, setSetMenu] = useState<WorkoutSet | null>(null);
  const [confirmFlag, setConfirmFlag] = useState(false);

  const log = useMutation((db, d: SetDraft) => logSet(db, we.id, valuesFromDraft(d, t, units)));
  const edit = useMutation((db, s: WorkoutSet, d: SetDraft) =>
    updateSet(db, s.id, valuesFromDraft(d, t, units)),
  );
  const flag = useMutation((db, v: boolean) => setIssueFlag(db, we.id, v));
  const skip = useMutation((db) => deferExercise(db, we.id, 'Skipped during the workout.'));
  const unskip = useMutation((db) => undeferExercise(db, we.id));
  const unsub = useMutation((db) => undoSubstitution(db, we.id));
  const finish = useMutation((db, v: boolean) => setExerciseFinished(db, we.id, v));
  const superset = useMutation((db) => toggleSessionSuperset(db, we.id));
  const reco = useMutation((db, status: 'accepted' | 'dismissed') =>
    setRecommendationStatus(db, recommendation!.id, status),
  );

  const fail = (title: string) => (e: unknown) =>
    Alert.alert(title, e instanceof Error ? e.message : String(e));

  const submit = async () => {
    try {
      if (editing) {
        await edit.run(editing, draft);
        haptics.success();
        setEditing(null);
        return;
      }
      const kind = draft.kind;
      await log.run(draft);
      // Persisted — now it is safe to acknowledge (haptic + rest timer only after the write).
      haptics.success();
      animateNextLayout(); // the refreshed set list slides the new row in
      // Rest: none after warm-ups; none between exercises of a superset (rest after the last one).
      if (kind !== 'warmup' && nextInSuperset == null) {
        onLogged(target?.restSeconds ?? exercise?.default_rest_seconds ?? 90, name);
      }
      setDraft((d) => ({ ...d, kind: kind === 'warmup' ? 'warmup' : 'normal' }));
    } catch (e) {
      Alert.alert('Set not saved', e instanceof Error ? e.message : 'Please check the values.');
    }
  };

  const onFinish = async (v: boolean) => {
    animateNextLayout();
    try {
      await finish.run(v);
      if (v) {
        haptics.success();
        setExpanded(false);
        setEditing(null);
      } else setExpanded(true);
    } catch (e) {
      fail('Not updated')(e);
    }
  };

  const actions: SheetAction[] = [
    ...(finished
      ? [{ label: 'Reopen exercise', description: 'Log more sets', onPress: () => onFinish(false) }]
      : []),
    {
      label: 'Substitute exercise',
      description: working.length
        ? 'Logged sets stay with this exercise'
        : 'Swap for an alternative',
      onPress: () =>
        router.push({
          pathname: '/exercises',
          params: { pick: 'substitute_workout_exercise', target: we.id },
        }),
    },
    ...(we.disposition === 'substituted' && we.replaced_exercise_id && working.length === 0
      ? [
          {
            label: 'Undo substitution',
            description: replacedName ? `Back to ${replacedName}` : 'Back to the planned exercise',
            onPress: () => unsub.run().catch(fail('Not undone')),
          },
        ]
      : []),
    ...(we.superset_group
      ? [
          {
            label: 'Remove from superset',
            onPress: () => {
              animateNextLayout();
              superset.run().catch(fail('Not updated'));
            },
          },
        ]
      : hasNext
        ? [
            {
              label: 'Superset with next exercise',
              description: 'Back to back, rest after the second',
              onPress: () => {
                animateNextLayout();
                superset.run().catch(fail('Not updated'));
              },
            },
          ]
        : []),
    ...(working.length === 0 && !inactive
      ? [
          {
            label: 'Skip for today',
            description: 'Recorded as deferred, not removed from your plan',
            onPress: () => {
              animateNextLayout();
              skip.run().catch(fail('Not skipped'));
            },
          },
        ]
      : []),
    we.issue_flag
      ? { label: 'Clear "felt off"', onPress: () => flag.run(false) }
      : {
          label: 'Something felt off',
          description: 'Pauses progression suggestions for this exercise',
          destructive: true,
          onPress: () => setConfirmFlag(true),
        },
    ...(exercise
      ? [
          {
            label: 'Exercise details & history',
            onPress: () =>
              router.push({ pathname: '/exercises/[id]', params: { id: exercise.id } }),
          },
        ]
      : []),
  ];

  const tags = [
    supersetLabel
      ? {
          label: nextInSuperset
            ? `${supersetLabel} · then ${nextInSuperset}`
            : `${supersetLabel} · rest after`,
          tone: 'accent' as const,
        }
      : null,
    we.disposition === 'substituted'
      ? {
          label: replacedName ? `Instead of ${replacedName}` : 'Substituted',
          tone: 'info' as const,
        }
      : null,
    we.disposition === 'deferred' ? { label: 'Deferred today', tone: 'warning' as const } : null,
    we.disposition === 'removed' ? { label: 'Removed today', tone: 'neutral' as const } : null,
    finished
      ? {
          label:
            targetMet || !target ? 'Finished' : `Finished early · ${working.length}/${target.sets}`,
          tone: targetMet || !target ? ('success' as const) : ('warning' as const),
        }
      : null,
    we.issue_flag ? { label: 'Felt off', tone: 'danger' as const } : null,
  ].filter(
    (
      x,
    ): x is {
      label: string;
      tone: 'accent' | 'info' | 'warning' | 'neutral' | 'danger' | 'success';
    } => !!x,
  );
  const showReco =
    !!recommendation &&
    recommendation.status === 'pending' &&
    recommendation.decision !== 'insufficient_data';
  let workingIndex = 0;

  return (
    <Card
      style={[
        inactive ? styles.inactive : null,
        finished || targetMet ? styles.done : null,
        supersetLabel ? styles.superset : null,
      ]}
    >
      <Row align="flex-start">
        <Pressable
          style={styles.flex}
          onPress={() => {
            animateNextLayout();
            setExpanded((e) => !e);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${name}${targetMet ? ', target complete' : ''}${finished ? ', finished' : ''}. Tap to ${expanded ? 'collapse' : 'expand'}.`}
        >
          <Text variant="heading">{name}</Text>
          <Text variant="caption" muted>
            {target ? formatPrescription({ ...target, loggingType: t }) : 'No target · log freely'}
          </Text>
        </Pressable>
        <View
          style={styles.counter}
          accessibilityLabel={
            target ? `${working.length} of ${target.sets} sets done` : `${working.length} sets`
          }
        >
          <Text
            variant="heading"
            color={targetMet ? colors.success : colors.text}
            style={styles.tabular}
          >
            {working.length}
            <Text variant="heading" color={colors.textFaint}>
              {target ? `/${target.sets}` : ''}
            </Text>
          </Text>
        </View>
        <IconButton
          icon="ellipsis-horizontal"
          label={`Options for ${name}`}
          onPress={() => setMenuOpen(true)}
        />
      </Row>

      {tags.length ? (
        <Row wrap gap={spacing.md}>
          {tags.map((tag) => (
            <StatusPill key={tag.label} label={tag.label} tone={tag.tone} />
          ))}
        </Row>
      ) : null}
      {inactive && we.substitution_reason ? (
        <Text variant="caption" faint>
          {we.substitution_reason}
        </Text>
      ) : null}

      {expanded ? (
        <View style={styles.body}>
          <Row align="flex-start" style={styles.lastRow}>
            <Text variant="label" faint style={styles.labelCol}>
              Last
            </Text>
            <Text
              variant="caption"
              muted
              style={styles.flex}
              accessibilityLabel={
                previous
                  ? `Last time on ${previous.date}: ${formatSetList(previous.sets, t, units)}`
                  : 'No previous performance'
              }
            >
              {previous
                ? `${formatSetList(previous.sets, t, units)} · ${formatDateKey(previous.date, { day: 'numeric', month: 'short' })}`
                : 'No previous performance'}
            </Text>
          </Row>

          {showReco && recommendation ? (
            <Notice
              tone="accent"
              title={`${DECISION_LABEL[recommendation.decision]}${recommendation.suggestion.loadKg !== null ? ` · ${formatLoad(recommendation.suggestion.loadKg, units)}` : ''}`}
              message={recommendation.rationale}
            >
              <Row>
                <Button
                  label="Use"
                  compact
                  variant="secondary"
                  onPress={() => reco.run('accepted')}
                />
                <Button
                  label="Dismiss"
                  compact
                  variant="ghost"
                  onPress={() => reco.run('dismissed')}
                />
              </Row>
            </Notice>
          ) : null}

          {sets.length ? (
            <View>
              {sets.map((s) => {
                const kind = kindOf(s);
                const label =
                  kind === 'warmup' ? 'W' : kind === 'drop' ? 'D' : String(++workingIndex);
                return (
                  <Reveal key={s.id}>
                    <Pressable
                      onPress={() => setSetMenu(s)}
                      accessibilityRole="button"
                      accessibilityLabel={`${kind === 'warmup' ? 'Warm-up set' : kind === 'drop' ? 'Drop set' : `Set ${label}`}: ${formatSet(s, t, units)}. Saved. Tap for options.`}
                      style={({ pressed }) => [
                        styles.setRow,
                        kind === 'drop' ? styles.dropRow : null,
                        editing?.id === s.id ? styles.setRowEditing : null,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <Text
                        variant="label"
                        color={kind === 'drop' ? colors.accent : colors.textFaint}
                        style={styles.labelCol}
                      >
                        {label}
                      </Text>
                      <Text
                        style={[styles.flex, styles.tabular]}
                        color={kind === 'warmup' ? colors.textMuted : colors.text}
                      >
                        {formatSet(s, t, units)}
                      </Text>
                      <PopIn>
                        <Ionicons name="checkmark" size={16} color={colors.success} />
                      </PopIn>
                    </Pressable>
                  </Reveal>
                );
              })}
            </View>
          ) : null}

          {inactive ? (
            <Button
              label="Do it anyway"
              compact
              variant="secondary"
              inline
              onPress={() => {
                animateNextLayout();
                unskip.run();
              }}
            />
          ) : finished ? (
            <Button
              label="Reopen exercise"
              compact
              variant="secondary"
              inline
              onPress={() => onFinish(false)}
            />
          ) : (
            <>
              <SetInput
                loggingType={t}
                units={units}
                draft={draft}
                onChange={setDraft}
                onSubmit={submit}
                submitting={log.pending || edit.pending}
                submitLabel={
                  editing
                    ? 'Save changes'
                    : draft.kind === 'drop'
                      ? 'Log drop set'
                      : draft.kind === 'warmup'
                        ? 'Log warm-up'
                        : 'Log set'
                }
              />
              {editing ? (
                <Button
                  label="Cancel edit"
                  variant="secondary"
                  onPress={() => {
                    setEditing(null);
                    setDraft(initial());
                  }}
                />
              ) : sets.length ? (
                <Button
                  label={
                    targetMet || !target
                      ? 'Finish exercise'
                      : `Finish exercise early (${working.length}/${target.sets})`
                  }
                  variant="secondary"
                  onPress={() => onFinish(true)}
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={name}
        actions={actions}
      />

      <ActionSheet
        visible={!!setMenu}
        onClose={() => setSetMenu(null)}
        title={
          setMenu
            ? kindOf(setMenu) === 'drop'
              ? 'Drop set'
              : kindOf(setMenu) === 'warmup'
                ? 'Warm-up set'
                : 'Set'
            : ''
        }
        message={setMenu ? formatSet(setMenu, t, units) : undefined}
        actions={
          setMenu
            ? [
                {
                  label: 'Edit set',
                  onPress: () => {
                    const s = setMenu;
                    setEditing(s);
                    setDraft({
                      ...draftFromSet(s, t, units),
                      kind: kindOf(s),
                      effort:
                        s.rir !== null ? `rir:${s.rir}` : s.rpe !== null ? `rpe:${s.rpe}` : 'none',
                    });
                    setExpanded(true);
                  },
                },
                {
                  label: 'Delete set',
                  destructive: true,
                  description: 'You can undo straight after',
                  onPress: () => onDeleteSet(setMenu),
                },
              ]
            : []
        }
      />

      <ActionSheet
        visible={confirmFlag}
        onClose={() => setConfirmFlag(false)}
        title="Something felt off?"
        message="GymOS will stop suggesting progression for this exercise until you clear the flag. If you have pain, stop and consider a qualified professional — the app can't assess injuries."
        actions={[
          { label: 'Flag this exercise', destructive: true, onPress: () => flag.run(true) },
        ]}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  inactive: { opacity: 0.6 },
  done: { borderLeftWidth: 2, borderLeftColor: colors.success },
  superset: { borderLeftWidth: 2, borderLeftColor: colors.accent },
  counter: { minWidth: 44, alignItems: 'flex-end', paddingTop: 2 },
  body: { gap: spacing.md },
  lastRow: { paddingTop: spacing.xs },
  labelCol: { width: 36 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dropRow: { paddingLeft: spacing.md },
  setRowEditing: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.55 },
});
