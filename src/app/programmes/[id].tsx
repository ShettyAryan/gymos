import { Stack as RouterStack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  List,
  ErrorState,
  IconButton,
  ListRow,
  LoadingState,
  Notice,
  Row,
  Screen,
  Section,
  Stack,
  StatusPill,
  Text,
  TextField,
} from '@/components';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { getExerciseMap } from '@/data/local/repositories/exercises';
import { getProfile } from '@/data/local/repositories/profile';
import {
  addDay,
  approveProgramme,
  archiveProgramme,
  deleteProgramme,
  getProgrammeDetail,
  listVersions,
  moveDay,
  moveProgrammeExercise,
  renameProgramme,
} from '@/data/local/repositories/programmes';
import { incrementCounter } from '@/data/local/repositories/settings';
import { labelOf, PRIORITIES } from '@/domain/models/constants';
import { estimateSessionMinutes } from '@/domain/rules/timeEstimate';
import { hasErrors, validateProgramme } from '@/domain/validation/programme';
import { formatPrescription, weekdayLabel } from '@/features/programme/format';
import { applyReminders } from '@/features/settings/reminders';
import { colors, spacing } from '@/theme/tokens';

export default function ProgrammeEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery(
    async (db) => {
      const [detail, exercises, profile, versions] = await Promise.all([
        getProgrammeDetail(db, id),
        getExerciseMap(db),
        getProfile(db),
        listVersions(db, id),
      ]);
      return { detail, exercises, profile, versions };
    },
    [id],
  );
  const [name, setName] = useState<string | null>(null);
  const rename = useMutation((db, n: string) => renameProgramme(db, id, n));
  const newDay = useMutation(async (db) => {
    const count = q.data?.detail?.days.length ?? 0;
    return addDay(db, id, {
      title: `Day ${count + 1}`,
      weekday: null,
      intended_minutes: q.data?.profile?.session_minutes ?? 60,
    });
  });
  const approve = useMutation(async (db) => {
    const v = await approveProgramme(db, id, {
      avoidPatterns: q.data?.profile?.avoid_patterns ?? [],
    });
    await incrementCounter(db, 'programme_approved');
    await applyReminders(db).catch(() => undefined); // keep opt-in reminders aligned with the new schedule
    return v;
  });
  const move = useMutation((db, itemId: string, dir: -1 | 1) =>
    moveProgrammeExercise(db, itemId, dir),
  );
  const moveD = useMutation((db, dayId: string, dir: -1 | 1) => moveDay(db, dayId, dir));
  const archive = useMutation((db) => archiveProgramme(db, id));
  const remove = useMutation((db) => deleteProgramme(db, id));

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingState />;
  const { detail, exercises, profile, versions } = q.data;
  if (!detail) return <ErrorState title="Programme not found" />;

  const { programme, days } = detail;
  const issues = validateProgramme(detail, exercises, {
    avoidPatterns: profile?.avoid_patterns ?? [],
  });
  const blocked = hasErrors(issues);
  const pendingChanges = programme.status !== 'active' || programme.has_unapproved_changes;
  const nextVersion = (versions[0]?.version_number ?? 0) + 1;

  const onApprove = () => {
    Alert.alert(
      programme.status === 'active' ? `Approve version ${nextVersion}?` : 'Approve and activate?',
      `"${programme.name}" will become your active programme from today. Past sessions keep the version they were logged against.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              await approve.run();
            } catch (e) {
              Alert.alert('Not approved', e instanceof Error ? e.message : '');
            }
          },
        },
      ],
    );
  };

  const onAddDay = async () => {
    const d = await newDay.run();
    router.push({ pathname: '/programmes/day/[id]', params: { id: d.id } });
  };

  const onDelete = () =>
    Alert.alert('Delete programme?', 'This removes the draft. Logged sessions are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await remove.run();
          router.back();
        },
      },
    ]);

  return (
    <Screen
      edges={['bottom']}
      footer={
        pendingChanges ? (
          <Button
            label={
              programme.status === 'active'
                ? `Approve changes (v${nextVersion})`
                : 'Approve & activate'
            }
            onPress={onApprove}
            disabled={blocked}
            loading={approve.pending}
            accessibilityHint={blocked ? 'Fix the errors listed above first' : undefined}
          />
        ) : undefined
      }
    >
      <RouterStack.Screen
        options={{ title: programme.status === 'draft' ? 'Draft programme' : 'Programme' }}
      />
      <Row gap={spacing.lg}>
        <StatusPill
          label={
            programme.status === 'active'
              ? `Active · v${versions[0]?.version_number ?? 1}`
              : programme.status === 'draft'
                ? 'Draft — not active'
                : 'Archived'
          }
          tone={
            programme.status === 'active'
              ? 'success'
              : programme.status === 'draft'
                ? 'warning'
                : 'neutral'
          }
        />
        {programme.source === 'ai' ? <StatusPill label="AI-drafted" tone="info" /> : null}
      </Row>
      <TextField
        label="Programme name"
        value={name ?? programme.name}
        onChangeText={setName}
        maxLength={60}
      />
      {name !== null && name !== programme.name ? (
        <Button
          label="Save name"
          variant="secondary"
          compact
          inline
          onPress={() => rename.run(name).then(() => setName(null))}
        />
      ) : null}
      {programme.status === 'active' && programme.has_unapproved_changes ? (
        <Notice
          tone="warning"
          title="Edits not live yet"
          message={`Your workouts still use version ${versions[0]?.version_number}. Approve to make these edits version ${nextVersion}.`}
        />
      ) : null}
      {programme.rationale ? (
        <Notice
          tone="info"
          title="AI rationale (suggestion, not advice)"
          message={programme.rationale}
        />
      ) : null}

      {days.map(({ day, exercises: items }, di) => {
        const est = estimateSessionMinutes(
          items.map((pe) => ({
            sets: pe.sets,
            repMax: pe.rep_max,
            restSeconds: pe.rest_seconds,
            loggingType: exercises.get(pe.exercise_id)?.logging_type ?? 'weight_reps',
          })),
        );
        return (
          <Card key={day.id}>
            <Row align="flex-start">
              <Pressable
                style={{ flex: 1, gap: spacing.xs }}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${day.title}`}
                onPress={() =>
                  router.push({ pathname: '/programmes/day/[id]', params: { id: day.id } })
                }
              >
                <Text variant="label" muted>
                  {weekdayLabel(day.weekday)} · {day.intended_minutes} min · est. ~{est}
                </Text>
                <Text variant="heading">{day.title}</Text>
              </Pressable>
              <IconButton
                icon="chevron-up"
                label={`Move ${day.title} up`}
                disabled={di === 0}
                onPress={() => moveD.run(day.id, -1)}
              />
              <IconButton
                icon="chevron-down"
                label={`Move ${day.title} down`}
                disabled={di === days.length - 1}
                onPress={() => moveD.run(day.id, 1)}
              />
            </Row>
            <View>
              {items.map((pe, i) => {
                const ex = exercises.get(pe.exercise_id);
                return (
                  <View key={pe.id} style={styles.itemRow}>
                    <Text variant="caption" faint style={styles.index}>
                      {i + 1}
                    </Text>
                    <Pressable
                      style={({ pressed }) => [
                        { flex: 1, paddingVertical: spacing.sm },
                        pressed ? { opacity: 0.55 } : null,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${ex?.name ?? 'exercise'}`}
                      onPress={() =>
                        router.push({ pathname: '/programmes/item/[id]', params: { id: pe.id } })
                      }
                    >
                      <Text numberOfLines={1}>{ex?.name ?? 'Missing exercise'}</Text>
                      <Text variant="caption" muted numberOfLines={1}>
                        {formatPrescription({
                          sets: pe.sets,
                          repMin: pe.rep_min,
                          repMax: pe.rep_max,
                          restSeconds: pe.rest_seconds,
                          targetRir: pe.target_rir,
                          loggingType: ex?.logging_type,
                        })}{' '}
                        · {labelOf(PRIORITIES, pe.priority)}
                      </Text>
                    </Pressable>
                    <IconButton
                      icon="arrow-up"
                      size={16}
                      label="Move up"
                      disabled={i === 0}
                      onPress={() => move.run(pe.id, -1)}
                    />
                    <IconButton
                      icon="arrow-down"
                      size={16}
                      label="Move down"
                      disabled={i === items.length - 1}
                      onPress={() => move.run(pe.id, 1)}
                    />
                  </View>
                );
              })}
            </View>
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                label="Add exercise"
                variant="secondary"
                compact
                onPress={() =>
                  router.push({
                    pathname: '/exercises',
                    params: { pick: 'add_to_day', target: day.id },
                  })
                }
              />
            </View>
          </Card>
        );
      })}
      <Button
        label="Add training day"
        variant="secondary"
        onPress={onAddDay}
        loading={newDay.pending}
      />

      {issues.length > 0 ? (
        <Section title="Checks before approval">
          <Stack gap={spacing.md}>
            {issues.map((iss, i) => (
              <Notice
                key={i}
                tone={iss.level === 'error' ? 'danger' : 'warning'}
                message={iss.message}
              />
            ))}
          </Stack>
        </Section>
      ) : null}

      {versions.length > 0 ? (
        <Section title="Approved versions">
          <List>
            {versions.map((v) => (
              <ListRow
                key={v.id}
                title={`Version ${v.version_number}`}
                subtitle={v.change_summary ?? undefined}
                value={new Date(v.approved_at).toLocaleDateString()}
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Section title="Manage">
        {programme.status === 'active' ? (
          <Button
            label="Archive programme"
            variant="secondary"
            onPress={() =>
              Alert.alert(
                'Archive?',
                'You will have no active programme until you approve another.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Archive', onPress: () => archive.run() },
                ],
              )
            }
          />
        ) : (
          <Button label="Delete programme" variant="danger" onPress={onDelete} />
        )}
        <Text variant="caption" faint>
          Editing never changes sessions you have already logged.
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  index: { width: 24 },
});
