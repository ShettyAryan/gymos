import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack as RouterStack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ErrorState,
  Header,
  IconButton,
  LoadingState,
  Metric,
  MetricRow,
  NumberField,
  ProgressBar,
  Screen,
  Section,
  Segmented,
  Split,
  Text,
  TextField,
} from '@/components';
import { DateField } from '@/components/DateField';
import { animateNextLayout, Reveal } from '@/components/motion';
import { useMutation, useQuery } from '@/data/DatabaseProvider';
import { today } from '@/data/local/repositories/attendance';
import {
  createCampaign,
  deleteMilestone,
  getActiveCampaign,
  listMilestones,
  saveMilestone,
  setMilestoneDone,
  updateCampaign,
  type Milestone,
  type MilestoneKind,
} from '@/data/local/repositories/campaign';
import { getProfile } from '@/data/local/repositories/profile';
import { listProgressEntries } from '@/data/local/repositories/progress';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatDateKey, isDateKey } from '@/utils/dates';
import { haptics } from '@/utils/haptics';
import { displayLoad, loadUnit, parseDecimal, parseLoad, type UnitSystem } from '@/utils/units';

/** What each milestone kind means, shown as you switch between them. */
const KINDS: Record<
  MilestoneKind,
  { label: string; tag: string; help: string; placeholder: string }
> = {
  custom: {
    label: 'General',
    tag: 'Checkpoint',
    help: 'Any checkpoint you want to tick off — a lift, a habit, an event.',
    placeholder: 'e.g. Squat 100 kg for 5',
  },
  photoshoot: {
    label: 'Photo',
    tag: 'Photo',
    help: 'A reminder to take private progress photos (front, side, back) on the due date. Photos never leave your device unless you enable backup.',
    placeholder: 'e.g. Week 6 progress photos',
  },
  body_weight: {
    label: 'Weight',
    tag: 'Weight',
    help: 'A body-weight target. Progress uses your latest weigh-in from Progress → Body.',
    placeholder: 'e.g. Reach 75 kg',
  },
  sessions: {
    label: 'Sessions',
    tag: 'Sessions',
    help: 'A number of completed sessions since the campaign started. Counts automatically as you train.',
    placeholder: 'e.g. 24 sessions',
  },
};

export default function CampaignScreen() {
  const q = useQuery(async (db) => {
    const campaign = await getActiveCampaign(db);
    const [profile, entries] = await Promise.all([getProfile(db), listProgressEntries(db)]);
    const latestWeight =
      [...entries].reverse().find((e) => e.body_weight_kg !== null)?.body_weight_kg ?? null;
    const sessions = campaign
      ? ((
          await db.first<{ n: number }>(
            `SELECT COUNT(*) AS n FROM workout_session WHERE deleted_at IS NULL AND session_date >= ?
             AND status IN ('completed_as_planned','completed_adapted','partially_completed')`,
            [campaign.start_date],
          )
        )?.n ?? 0)
      : 0;
    return {
      campaign,
      milestones: campaign ? await listMilestones(db, campaign.id) : [],
      units: profile?.unit_system ?? ('metric' as UnitSystem),
      latestWeight,
      sessions,
    };
  });

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <LoadingState />;
  if (!q.data.campaign) return <NewCampaign />;
  return <ActiveCampaign {...q.data} campaign={q.data.campaign} />;
}

function NewCampaign() {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [target, setTarget] = useState('');
  const create = useMutation((db) =>
    createCampaign(db, {
      name,
      goal: goal.trim() || null,
      start_date: today(),
      target_date: isDateKey(target) ? target : null,
    }),
  );
  const onCreate = async () => {
    try {
      await create.run();
      haptics.success();
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : '');
    }
  };
  return (
    <Screen
      edges={['bottom']}
      footer={
        <Button
          label="Start campaign"
          onPress={onCreate}
          disabled={!name.trim()}
          loading={create.pending}
        />
      }
    >
      <RouterStack.Screen options={{ title: 'Campaign' }} />
      <Header
        eyebrow="New campaign"
        title="One focused block"
        subtitle="A target date and a few milestones. One campaign at a time."
      />
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. 12-week strength block"
        maxLength={60}
      />
      <TextField
        label="Goal"
        optional
        value={goal}
        onChangeText={setGoal}
        placeholder="What does success look like?"
        maxLength={200}
      />
      <DateField
        label="Target date"
        optional
        value={target}
        onChange={setTarget}
        quick={[
          { label: '8 weeks', days: 56 },
          { label: '12 weeks', days: 84 },
          { label: '16 weeks', days: 112 },
        ]}
      />
    </Screen>
  );
}

type ActiveProps = {
  campaign: NonNullable<Awaited<ReturnType<typeof getActiveCampaign>>>;
  milestones: Milestone[];
  units: UnitSystem;
  latestWeight: number | null;
  sessions: number;
};

function ActiveCampaign({ campaign, milestones, units, latestWeight, sessions }: ActiveProps) {
  const [composing, setComposing] = useState(false);
  const toggle = useMutation((db, id: string, done: boolean) => setMilestoneDone(db, id, done));
  const remove = useMutation((db, id: string) => deleteMilestone(db, id));
  const complete = useMutation((db) => updateCampaign(db, campaign.id, { status: 'completed' }));

  const daysLeft = campaign.target_date
    ? Math.max(0, Math.round((Date.parse(campaign.target_date) - Date.parse(today())) / 86_400_000))
    : null;
  const doneCount = milestones.filter((m) => m.status === 'done').length;

  const onToggle = (m: Milestone) => {
    const done = m.status !== 'done';
    if (done) haptics.success();
    else haptics.select();
    toggle.run(m.id, done);
  };

  const onDelete = (m: Milestone) =>
    Alert.alert('Delete milestone?', m.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          animateNextLayout();
          remove.run(m.id);
        },
      },
    ]);

  return (
    <Screen edges={['bottom']}>
      <RouterStack.Screen options={{ title: 'Campaign' }} />
      <Header
        eyebrow={`Since ${formatDateKey(campaign.start_date, { day: 'numeric', month: 'short', year: 'numeric' })}`}
        title={campaign.name}
        subtitle={campaign.goal ?? undefined}
      />

      <Card>
        <MetricRow>
          <Metric
            label="Days left"
            value={daysLeft === null ? '—' : String(daysLeft)}
            hint={
              campaign.target_date
                ? formatDateKey(campaign.target_date, { day: 'numeric', month: 'short' })
                : 'No target date'
            }
            live={daysLeft !== null}
          />
          <Metric label="Milestones" value={`${doneCount}/${milestones.length}`} hint="done" />
          <Metric label="Sessions" value={String(sessions)} hint="this campaign" />
        </MetricRow>
      </Card>

      <Section
        title="Milestones"
        action={
          !composing ? (
            <Button
              label="Add"
              compact
              variant="secondary"
              onPress={() => {
                animateNextLayout();
                setComposing(true);
              }}
            />
          ) : undefined
        }
      >
        {composing ? (
          <Reveal>
            <Composer
              campaignId={campaign.id}
              units={units}
              onClose={() => {
                animateNextLayout();
                setComposing(false);
              }}
            />
          </Reveal>
        ) : null}

        {milestones.length === 0 && !composing ? (
          <Text muted>
            No milestones yet. Add a few checkpoints between today and your target date.
          </Text>
        ) : null}

        {milestones.length ? (
          <View style={styles.list}>
            {milestones.map((m) => (
              <MilestoneRow
                key={m.id}
                m={m}
                units={units}
                latestWeight={latestWeight}
                sessions={sessions}
                onToggle={() => onToggle(m)}
                onDelete={() => onDelete(m)}
              />
            ))}
          </View>
        ) : null}
      </Section>

      <Text variant="caption" faint>
        Milestones earn a small, one-time XP bonus. Progress is about consistency, not maximum
        volume.
      </Text>
      <Button
        label="Mark campaign complete"
        variant="secondary"
        onPress={() =>
          Alert.alert('Complete campaign?', 'You can start a new one afterwards.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Complete',
              onPress: async () => {
                await complete.run();
                haptics.success();
              },
            },
          ])
        }
      />
    </Screen>
  );
}

function MilestoneRow({
  m,
  units,
  latestWeight,
  sessions,
  onToggle,
  onDelete,
}: {
  m: Milestone;
  units: UnitSystem;
  latestWeight: number | null;
  sessions: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const done = m.status === 'done';
  const target = m.target_value;
  const progress =
    m.kind === 'sessions' && target
      ? { value: sessions / target, caption: `${Math.min(sessions, target)} of ${target} sessions` }
      : null;
  const weightLine =
    m.kind === 'body_weight' && target
      ? `Target ${displayLoad(target, units)} ${loadUnit(units)}${latestWeight !== null ? ` · now ${displayLoad(latestWeight, units)} ${loadUnit(units)}` : ' · no weigh-in yet'}`
      : null;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={m.title}
        onPress={onToggle}
        style={styles.rowMain}
      >
        <View style={[styles.box, done ? styles.boxOn : null]}>
          {done ? <Ionicons name="checkmark" size={14} color={colors.onInk} /> : null}
        </View>
        <View style={styles.rowText}>
          <Text variant="label" faint>
            {KINDS[m.kind].tag}
            {m.due_date
              ? ` · ${formatDateKey(m.due_date, { day: 'numeric', month: 'short' })}`
              : ''}
          </Text>
          <Text color={done ? colors.textMuted : colors.text} style={done ? styles.struck : null}>
            {m.title}
          </Text>
          {weightLine ? (
            <Text variant="caption" muted>
              {weightLine}
            </Text>
          ) : null}
          {progress && !done ? (
            <View style={styles.progress}>
              <ProgressBar value={progress.value} label={progress.caption} />
              <Text variant="caption" muted>
                {progress.caption}
              </Text>
            </View>
          ) : null}
          {m.kind === 'photoshoot' && !done ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/progress/photos')}
              hitSlop={8}
              style={styles.link}
            >
              <Text variant="caption" color={colors.accent}>
                Open photos →
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      <IconButton
        icon="close"
        size={16}
        label={`Delete ${m.title}`}
        color={colors.textFaint}
        onPress={onDelete}
      />
    </View>
  );
}

function Composer({
  campaignId,
  units,
  onClose,
}: {
  campaignId: string;
  units: UnitSystem;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MilestoneKind>('custom');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [targetText, setTargetText] = useState('');

  const targetValue =
    kind === 'body_weight'
      ? parseLoad(targetText, units)
      : kind === 'sessions'
        ? parseDecimal(targetText)
        : null;
  const needsTarget = kind === 'body_weight' || kind === 'sessions';
  const canSave = !!title.trim() && (!needsTarget || (targetValue !== null && targetValue > 0));

  const add = useMutation((db) =>
    saveMilestone(db, {
      campaign_id: campaignId,
      title,
      kind,
      target_value: needsTarget
        ? kind === 'sessions'
          ? Math.round(targetValue!)
          : targetValue
        : null,
      due_date: isDateKey(due) ? due : null,
      status: 'open',
      completed_at: null,
    }),
  );

  const onAdd = async () => {
    try {
      await add.run();
      haptics.success();
      onClose();
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : '');
    }
  };

  return (
    <Card>
      <Segmented
        label="Type"
        options={(Object.keys(KINDS) as MilestoneKind[]).map((k) => ({
          value: k,
          label: KINDS[k].label,
        }))}
        value={kind}
        onChange={(k) => {
          animateNextLayout();
          setKind(k);
          setTargetText('');
        }}
      />
      <Text variant="caption" muted>
        {KINDS[kind].help}
      </Text>
      <TextField
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder={KINDS[kind].placeholder}
        maxLength={80}
      />
      {kind === 'body_weight' ? (
        <NumberField
          label="Target weight"
          unit={loadUnit(units)}
          value={targetText}
          onChangeText={setTargetText}
        />
      ) : null}
      {kind === 'sessions' ? (
        <NumberField
          label="Sessions to complete"
          value={targetText}
          onChangeText={setTargetText}
          decimal={false}
        />
      ) : null}
      <DateField
        label="Due date"
        optional={kind !== 'photoshoot'}
        value={due}
        onChange={setDue}
        quick={[
          { label: '2 weeks', days: 14 },
          { label: '4 weeks', days: 28 },
          { label: '6 weeks', days: 42 },
        ]}
      />
      <Split>
        <Button label="Cancel" variant="secondary" onPress={onClose} />
        <Button label="Add milestone" onPress={onAdd} disabled={!canSave} loading={add.pending} />
      </Split>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  box: {
    width: 22,
    height: 22,
    marginTop: 16,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  struck: { textDecorationLine: 'line-through' },
  progress: { gap: spacing.xs, marginTop: spacing.sm },
  link: { alignSelf: 'flex-start', paddingTop: spacing.xs },
});
