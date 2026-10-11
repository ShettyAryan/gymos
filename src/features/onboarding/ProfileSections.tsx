import { ChipGroup, Notice, Segmented, Stack, Stepper, Text, TextField } from '@/components';
import {
  EQUIPMENT,
  EXPERIENCE,
  GOALS,
  LOCATION_EQUIPMENT,
  LOCATIONS,
  MOVEMENT_PATTERNS,
} from '@/domain/models/constants';
import { colors } from '@/theme/tokens';
import { WEEKDAY_SHORT } from '@/utils/dates';
import { lengthUnit, loadUnit } from '@/utils/units';

import { switchUnits, type DraftErrors, type ProfileDraft } from './profileDraft';

type SectionProps = {
  draft: ProfileDraft;
  onChange: (d: ProfileDraft) => void;
  errors?: DraftErrors;
};

/** Short labels so four options fit one row on narrow phones. */
const SHORT_LOCATION: Record<(typeof LOCATIONS)[number]['value'], string> = {
  full_gym: 'Gym',
  home_gym: 'Home',
  minimal: 'Minimal',
  custom: 'Custom',
};

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export function GoalsSection({ draft, onChange, errors }: SectionProps) {
  return (
    <Stack gap={20}>
      <ChipGroup
        label="Goals (pick any)"
        options={[...GOALS]}
        selected={draft.goals}
        onToggle={(g) => onChange({ ...draft, goals: toggle(draft.goals, g) })}
      />
      {errors?.goals ? (
        <Text color={colors.danger} variant="caption">
          {errors.goals}
        </Text>
      ) : null}
      {draft.goals.includes('custom') ? (
        <TextField
          label="Describe your goal"
          value={draft.custom_goal}
          onChangeText={(t) => onChange({ ...draft, custom_goal: t })}
          maxLength={200}
        />
      ) : null}
      <Segmented
        label="Experience"
        options={[...EXPERIENCE]}
        value={draft.experience}
        onChange={(v) => onChange({ ...draft, experience: v })}
      />
      {errors?.experience ? (
        <Text color={colors.danger} variant="caption">
          {errors.experience}
        </Text>
      ) : null}
      <TextField
        label="Training history"
        optional
        placeholder="e.g. lifted on and off for 2 years"
        value={draft.training_history}
        onChangeText={(t) => onChange({ ...draft, training_history: t })}
        maxLength={300}
      />
    </Stack>
  );
}

export function BodySection({ draft, onChange, errors }: SectionProps) {
  const u = draft.unit_system;
  return (
    <Stack gap={20}>
      <Segmented
        label="Units"
        options={[
          { value: 'metric', label: 'kg / cm' },
          { value: 'imperial', label: 'lb / in' },
        ]}
        value={u}
        onChange={(v) => onChange(switchUnits(draft, v))}
      />
      <Notice
        tone="info"
        title="Why we ask"
        message="Height, weight and age are optional. They give context to your progress and to AI suggestions you choose to request. They stay on this device unless you enable cloud backup."
      />
      <TextField
        label={`Height (${lengthUnit(u)})`}
        optional
        keyboardType="decimal-pad"
        value={draft.height}
        onChangeText={(t) => onChange({ ...draft, height: t })}
        error={errors?.height}
      />
      <TextField
        label={`Body weight (${loadUnit(u)})`}
        optional
        keyboardType="decimal-pad"
        value={draft.body_weight}
        onChangeText={(t) => onChange({ ...draft, body_weight: t })}
        error={errors?.body_weight}
      />
      <TextField
        label="Age"
        optional
        keyboardType="number-pad"
        value={draft.age}
        onChangeText={(t) => onChange({ ...draft, age: t.replace(/[^0-9]/g, '') })}
        error={errors?.age}
      />
    </Stack>
  );
}

export function AvailabilitySection({ draft, onChange }: SectionProps) {
  return (
    <Stack gap={20}>
      <Stepper
        label="Sessions per week"
        value={draft.weekly_target}
        min={1}
        max={7}
        onChange={(v) => onChange({ ...draft, weekly_target: v })}
      />
      <ChipGroup
        label="Preferred training days"
        options={WEEKDAY_SHORT.map((d, i) => ({ value: String(i), label: d }))}
        selected={draft.preferred_days.map(String)}
        onToggle={(v) =>
          onChange({ ...draft, preferred_days: toggle(draft.preferred_days, Number(v)) })
        }
      />
      <Stepper
        label="Typical session length"
        value={draft.session_minutes}
        min={15}
        max={180}
        step={5}
        format={(v) => `${v} min`}
        onChange={(v) => onChange({ ...draft, session_minutes: v })}
      />
      <Text variant="caption" faint>
        Your weekly commitment drives adherence and streaks. Planned rest days never break a streak.
      </Text>
    </Stack>
  );
}

export function EquipmentSection({ draft, onChange, errors }: SectionProps) {
  const custom = draft.location === 'custom';
  const shown =
    draft.location && draft.location !== 'custom'
      ? LOCATION_EQUIPMENT[draft.location]
      : draft.equipment;
  return (
    <Stack gap={20}>
      <Segmented
        label="Where do you usually train?"
        options={LOCATIONS.map((l) => ({ value: l.value, label: SHORT_LOCATION[l.value] }))}
        value={draft.location}
        onChange={(v) =>
          onChange({ ...draft, location: v, equipment: v === 'custom' ? shown : draft.equipment })
        }
      />
      {errors?.location ? (
        <Text color={colors.danger} variant="caption">
          {errors.location}
        </Text>
      ) : null}
      <ChipGroup
        label={custom ? 'Available equipment' : 'Included equipment (choose Custom to edit)'}
        options={[...EQUIPMENT]}
        selected={shown}
        onToggle={(v) => custom && onChange({ ...draft, equipment: toggle(draft.equipment, v) })}
      />
      <Text variant="caption" faint>
        Bodyweight exercises are always available. Adaptive Day can use a different equipment set on
        any given day.
      </Text>
    </Stack>
  );
}

export function LimitationsSection({ draft, onChange }: SectionProps) {
  return (
    <Stack gap={20}>
      <Notice
        tone="info"
        message="Optional. List movements you prefer to avoid — this is a preference, not a diagnosis. GymOS will leave them out of suggestions and adaptations. For pain or injury, please talk to a qualified professional."
      />
      <ChipGroup
        label="Movement patterns to avoid"
        options={[...MOVEMENT_PATTERNS]}
        selected={draft.avoid_patterns}
        onToggle={(v) => onChange({ ...draft, avoid_patterns: toggle(draft.avoid_patterns, v) })}
      />
      <TextField
        label="Notes"
        optional
        multiline
        placeholder="e.g. prefer machines over overhead barbell work"
        value={draft.limitations_note}
        onChangeText={(t) => onChange({ ...draft, limitations_note: t })}
        maxLength={500}
      />
    </Stack>
  );
}
