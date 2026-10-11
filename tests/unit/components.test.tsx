import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button, ChipGroup, StatusPill } from '@/components';

describe('design system controls', () => {
  it('Button exposes an accessible label and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<Button label="Start workout" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled Button does not fire', async () => {
    const onPress = jest.fn();
    await render(<Button label="Finish" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ChipGroup reports checked state for screen readers', async () => {
    await render(
      <ChipGroup
        options={[
          { value: 'a', label: 'Barbell' },
          { value: 'b', label: 'Dumbbell' },
        ]}
        selected={['a']}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Barbell' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Dumbbell' })).not.toBeChecked();
  });

  it('StatusPill renders a text label (colour-independent)', async () => {
    await render(<StatusPill label="Adapted" tone="info" />);
    expect(screen.getByText('Adapted')).toBeTruthy();
  });
});
