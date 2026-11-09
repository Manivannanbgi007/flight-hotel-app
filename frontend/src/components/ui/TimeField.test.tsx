import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TimeField, type TimeFieldProps } from './TimeField';

function Controlled({ initial = '', onChange, ...props }: Partial<TimeFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      label="Check-in from"
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const field = () => screen.getByRole('combobox', { name: 'Check-in from' });
const list = () => screen.getByRole('listbox', { name: 'Suggested times' });

describe('TimeField', () => {
  it('lists every half hour with its 12-hour form and marks the chosen time', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="14:00" hint="Guests can arrive from this time" />);

    expect(field()).toHaveValue('14:00');
    expect(field()).toHaveAccessibleDescription('Guests can arrive from this time');
    await user.click(field());
    const options = within(list()).getAllByRole('option');
    expect(options).toHaveLength(48);
    expect(options[0]).toHaveTextContent('00:0012:00 AM');
    expect(options[29]).toHaveTextContent('14:302:30 PM');
    expect(within(list()).getByRole('option', { selected: true })).toHaveTextContent('14:00');
    expect(field()).toHaveAttribute('aria-activedescendant', options[28]!.id);
  });

  it('chooses a time with a click, keeping focus in the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(field());
    await user.click(within(list()).getByRole('option', { name: /^11:30/ }));
    expect(onChange).toHaveBeenLastCalledWith('11:30');
    expect(field()).toHaveValue('11:30');
    expect(field()).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves through the list from the keyboard and closes only itself with Escape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<Controlled initial="10:00" onChange={onChange} />);

    field().focus();
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', within(list()).getByRole('option', { name: /^10:00/ }).id);
    await user.keyboard('{ArrowDown}{ArrowDown}{PageDown}{ArrowUp}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('12:30');

    await user.keyboard('{ArrowUp}{End}');
    expect(field()).toHaveAttribute('aria-activedescendant', within(list()).getByRole('option', { name: /^23:30/ }).id);
    await user.keyboard('{Home}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(outer.mock.calls.some(([event]) => (event as KeyboardEvent).key === 'Escape')).toBe(false);
    document.removeEventListener('keydown', outer);
  });

  it('takes typed times in 24-hour or 12-hour form and shows the chosen time again after unfinished text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <>
        <Controlled onChange={onChange} onBlur={onBlur} />
        <button type="button">Next</button>
      </>,
    );

    await user.type(field(), '2:30 pm');
    expect(onChange).toHaveBeenLastCalledWith('14:30');
    await user.clear(field());
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.type(field(), '1100');
    expect(onChange).toHaveBeenLastCalledWith('11:00');
    await user.type(field(), '{Backspace}{Backspace}{Backspace}:');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(field()).toHaveValue('11:00');
    expect(onBlur).toHaveBeenCalled();
  });

  it('suggests only the times between min and max at the given step', async () => {
    const user = userEvent.setup();
    render(<Controlled min="09:00" max="11:00" step={15} />);

    await user.click(field());
    expect(within(list()).getAllByRole('option').map((option) => option.textContent?.slice(0, 5))).toEqual([
      '09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00',
    ]);
  });
});
