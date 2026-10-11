import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Metric, Segmented, Text } from '@/components';
import { Reveal } from '@/components/motion';
import { useMotion } from '@/state/motion';
import { familyFor, fonts } from '@/theme/fonts';

describe('typography', () => {
  it('maps weights to bundled Poppins files and keeps DM Mono for mono text', () => {
    expect(familyFor(fonts.regular, '400')).toBe(fonts.regular);
    expect(familyFor(fonts.regular, '500')).toBe(fonts.medium);
    expect(familyFor(fonts.medium, '600')).toBe(fonts.semibold);
    expect(familyFor(undefined, 'bold')).toBe(fonts.bold);
    expect(familyFor(fonts.mono, '600')).toBe(fonts.monoMedium);
    expect(familyFor(fonts.mono, undefined)).toBe(fonts.mono);
  });

  it('Text never passes fontWeight through (Android ignores it for custom fonts)', async () => {
    await render(
      <Text variant="body" style={{ fontWeight: '600' }}>
        Hello
      </Text>,
    );
    const style = StyleSheet.flatten(screen.getByText('Hello').props.style);
    expect(style.fontWeight).toBeUndefined();
    expect(style.fontFamily).toBe(fonts.semibold);
  });

  it('labels and metrics use DM Mono', async () => {
    await render(
      <>
        <Text variant="label">Sets</Text>
        <Text variant="metric">42</Text>
      </>,
    );
    expect(StyleSheet.flatten(screen.getByText('Sets').props.style).fontFamily).toBe(
      fonts.monoMedium,
    );
    expect(StyleSheet.flatten(screen.getByText('42').props.style).fontFamily).toBe(
      fonts.monoMedium,
    );
  });
});

describe('motion respects Reduce Motion', () => {
  afterEach(async () => {
    await act(async () => useMotion.setState({ reduced: false }));
  });

  it('Reveal renders content fully visible immediately when motion is reduced', async () => {
    useMotion.setState({ reduced: true });
    await render(
      <Reveal>
        <Text>Ready</Text>
      </Reveal>,
    );
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('Metric shows the final value straight away with reduced motion', async () => {
    useMotion.setState({ reduced: true });
    await render(<Metric label="Streak" value="12/20" />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('/20')).toBeTruthy();
  });

  it('Segmented still reports selection (with the sliding indicator)', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        label="Energy"
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
        value="low"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'High' }));
    expect(onChange).toHaveBeenCalledWith('high');
    expect(screen.getByRole('radio', { name: 'Low' })).toBeSelected();
  });
});
