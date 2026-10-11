import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { DateField } from '@/components/DateField';
import { NavHeader } from '@/components/NavHeader';
import { setClock, resetClock } from '@/utils/clock';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

describe('NavHeader (edge-to-edge safe)', () => {
  it('sits below the status bar and renders back, title and right action', async () => {
    const goBack = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavHeader
          {...({
            navigation: { goBack },
            route: { key: 'k', name: 'campaign' },
            back: { title: 'Today', href: undefined },
            options: { title: 'Campaign', headerRight: () => <Button label="Add" compact /> },
          } as unknown as NativeStackHeaderProps)}
        />
      </SafeAreaProvider>,
    );
    const title = screen.getByRole('header', { name: 'Campaign' });
    expect(title).toBeTruthy();
    // The outer wrapper is padded by the top inset so nothing overlaps the status bar.
    let node = title.parent;
    let padded = false;
    while (node) {
      if (StyleSheet.flatten(node.props.style)?.paddingTop === 47) padded = true;
      node = node.parent;
    }
    expect(padded).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(goBack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('hides the back button when a screen turns it off', async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavHeader
          {...({
            navigation: { goBack: jest.fn() },
            route: { key: 'k', name: 'x' },
            back: { title: 'Prev', href: undefined },
            options: { title: 'Summary', headerBackVisible: false },
          } as unknown as NativeStackHeaderProps)}
        />
      </SafeAreaProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('DateField', () => {
  beforeEach(() => setClock(() => new Date('2026-10-12T09:00:00')));
  afterEach(() => resetClock());

  it('shows a readable placeholder, sets dates from quick picks and can be cleared', async () => {
    const onChange = jest.fn();
    const view = await render(
      <DateField
        label="Due date"
        optional
        value=""
        onChange={onChange}
        quick={[{ label: '2 weeks', days: 14 }]}
      />,
    );
    expect(screen.getByText('Choose a date')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '2 weeks from today' }));
    expect(onChange).toHaveBeenCalledWith('2026-10-26');

    await view.rerender(<DateField label="Due date" value="2026-10-26" onChange={onChange} />);
    expect(screen.queryByText('Choose a date')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear Due date' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
