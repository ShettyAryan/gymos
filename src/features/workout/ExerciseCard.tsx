import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, IconButton, Notice, Row, StatusPill, Text } from '@/components';
import { animateNextLayout, PopIn, Reveal } from '@/components/motion';
import { useMutation } from '@/data/DatabaseProvider';
import {
  deferExercise,
  logSet,
  setIssueFlag,
  setRecommendationStatus,
  undeferExercise,
  updateSet,
  type PerformanceEntry,
  type Recommendation,
  type SessionItem,
} from '@/data/local/repositories/workouts';
import type { WorkoutSet } from '@/domain/models/types';
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
  onLogged: (restSeconds: number, label: string) => void;
  onDeleteSet: (set: WorkoutSet) => void;
};

export function ExerciseCard({
  item,
  units,
  previous,
  recommendation,
  replacedName,
  onLogged,
  onDeleteSet,
}: Props) {
  const { we, exercise, sets } = item;
  const t = exercise?.logging_type ?? 'weight_reps';
  const working = sets.filter((s) => !s.is_warmup);
  const target = we.target;
  const done = target ? working.length >= target.sets : false;
  const inactive = we.disposition === 'deferred' || we.disposition === 'removed';

  const initial = (): SetDraft => {
    const last = sets[sets.length - 1];
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
  const [expanded, setExpanded] = useState(!inactive);

  const log = useMutation((db, d: SetDraft) => logSet(db, we.id, valuesFromDraft(d, t, units)));
  const edit = useMutation((db, s: WorkoutSet, d: SetDraft) =>
    updateSet(db, s.id, valuesFromDraft(d, t, units)),
  );
  const flag = useMutation((db, v: boolean) => setIssueFlag(db, we.id, v));
  const skip = useMutation((db) => deferExercise(db, we.id, 'Skipped during the workout.'));
  const unskip = useMutation((db) => undeferExercise(db, we.id));
  const reco = useMutation((db, status: 'accepted' | 'dismissed') =>
    setRecommendationStatus(db, recommendation!.id, status),
  );

  const submit = async () => {
    try {
      if (editing) {
        await edit.run(editing, draft);
        haptics.success();
        setEditing(null);
        return;
      }
      await log.run(draft);
      // Persisted — now it is safe to acknowledge (haptic + rest timer only after the write).
      haptics.success();
      animateNextLayout(); // the refreshed set list slides the new row in
      if (!draft.warmup && target) onLogged(target.restSeconds, exercise?.name ?? 'Rest');
      else if (!draft.warmup && exercise) onLogged(exercise.default_rest_seconds, exercise.name);
      setDraft((d) => ({ ...d, warmup: false }));
    } catch (e) {
      Alert.alert('Set not saved', e instanceof Error ? e.message : 'Please check the values.');
    }
  };

  const openMenu = () => {
    const options = [
      'Substitute exercise',
      working.length === 0 ? 'Skip for today' : null,
      we.issue_flag ? 'Clear "something felt off"' : 'Something felt off',
      exercise ? 'Exercise details & history' : null,
      'Cancel',
    ].filter((x): x is string => !!x);
    const handle = (label: string) => {
      if (label === 'Substitute exercise')
        router.push({
          pathname: '/exercises',
          params: { pick: 'substitute_workout_exercise', target: we.id },
        });
      if (label === 'Skip for today') animateNextLayout();
      skip.run().catch((e) => Alert.alert('Not skipped', String(e?.message ?? e)));
      if (label.includes('felt off')) {
        flag.run(!we.issue_flag);
        if (!we.issue_flag)
          Alert.alert(
            'Noted',
            'No progression will be suggested for this exercise from today. If you have pain, stop and consider a qualified professional — GymOS cannot assess injuries.',
          );
      }
      if (label.startsWith('Exercise details') && exercise)
        router.push({ pathname: '/exercises/[id]', params: { id: exercise.id } });
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1 },
        (i) => handle(options[i]!),
      );
    } else {
      Alert.alert(
        exercise?.name ?? 'Exercise',
        undefined,
        options.map((o) => ({
          text: o,
          style: o === 'Cancel' ? 'cancel' : 'default',
          onPress: () => handle(o),
        })),
      );
    }
  };

  const onSetPress = (s: WorkoutSet) =>
    Alert.alert(`Set ${s.set_order + 1}`, formatSet(s, t, units), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Edit',
        onPress: () => {
          setEditing(s);
          setDraft({
            ...draftFromSet(s, t, units),
            warmup: s.is_warmup,
            effort: s.rir !== null ? `rir:${s.rir}` : s.rpe !== null ? `rpe:${s.rpe}` : 'none',
          });
          setExpanded(true);
        },
      },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteSet(s) },
    ]);

  const tags = [
    we.disposition === 'substituted'
      ? {
          label: replacedName ? `Instead of ${replacedName}` : 'Substituted',
          tone: 'info' as const,
        }
      : null,
    we.disposition === 'deferred' ? { label: 'Deferred today', tone: 'warning' as const } : null,
    we.disposition === 'removed' ? { label: 'Removed today', tone: 'neutral' as const } : null,
    we.issue_flag ? { label: 'Felt off', tone: 'danger' as const } : null,
  ].filter((x): x is { label: string; tone: 'info' | 'warning' | 'neutral' | 'danger' } => !!x);
  const showReco =
    !!recommendation &&
    recommendation.status === 'pending' &&
    recommendation.decision !== 'insufficient_data';

  return (
    <Card style={[inactive ? styles.inactive : null, done ? styles.done : null]}>
      <Row align="flex-start">
        <Pressable
          style={styles.flex}
          onPress={() => {
            animateNextLayout();
            setExpanded((e) => !e);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${exercise?.name ?? 'Exercise'}${done ? ', target complete' : ''}`}
        >
          <Text variant="heading">{exercise?.name ?? 'Unknown exercise'}</Text>
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
            color={done ? colors.success : colors.text}
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
          label={`Options for ${exercise?.name ?? 'exercise'}`}
          onPress={openMenu}
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
              {sets.map((s) => (
                <Reveal key={s.id}>
                  <Pressable
                    onPress={() => onSetPress(s)}
                    accessibilityRole="button"
                    accessibilityLabel={`Set ${s.set_order + 1}: ${formatSet(s, t, units)}${s.is_warmup ? ', warm-up' : ''}. Saved. Tap to edit or delete.`}
                    style={({ pressed }) => [
                      styles.setRow,
                      editing?.id === s.id ? styles.setRowEditing : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text variant="caption" faint style={styles.labelCol}>
                      {s.is_warmup ? 'W' : working.indexOf(s) + 1}
                    </Text>
                    <Text style={[styles.flex, styles.tabular]}>{formatSet(s, t, units)}</Text>
                    <PopIn>
                      <Ionicons name="checkmark" size={16} color={colors.success} />
                    </PopIn>
                  </Pressable>
                </Reveal>
              ))}
            </View>
          ) : null}

          {inactive ? (
            <View style={styles.start}>
              <Button
                label="Do it anyway"
                compact
                variant="secondary"
                onPress={() => {
                  animateNextLayout();
                  unskip.run();
                }}
              />
            </View>
          ) : (
            <SetInput
              loggingType={t}
              units={units}
              draft={draft}
              onChange={setDraft}
              onSubmit={submit}
              submitting={log.pending || edit.pending}
              submitLabel={editing ? `Save set ${editing.set_order + 1}` : 'Log set'}
            />
          )}
          {editing ? (
            <Button
              label="Cancel edit"
              variant="ghost"
              compact
              inline
              onPress={() => {
                setEditing(null);
                setDraft(initial());
              }}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  inactive: { opacity: 0.6 },
  done: { borderLeftWidth: 2, borderLeftColor: colors.success },
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
  setRowEditing: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.55 },
  start: { alignSelf: 'flex-start' },
});
