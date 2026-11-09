import { createRef, useState, type Ref } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DateField, type DateFieldProps } from './DateField';

/** "Today" is Friday 6 November 2026 in these tests (only Date is faked; timers stay real for user-event). */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 6, 10, 0) });
});
afterEach(() => {
  vi.useRealTimers();
});

function Controlled({
  initial = '',
  onChange,
  ...props
}: Partial<DateFieldProps> & { initial?: string; ref?: Ref<HTMLInputElement> }) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="Check-in"
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const field = () => screen.getByRole('combobox', { name: 'Check-in' });
const calendar = () => screen.getByRole('dialog', { name: 'Choose date' });
const day = (name: RegExp) => within(calendar()).getByRole('button', { name });

describe('DateField', () => {
  it('shows the chosen day with its weekday, keeps the ISO value and is described by its hint or error', () => {
    const { rerender } = render(<DateField label="Check-in" value="2026-12-12" onChange={vi.fn()} hint="From 2 PM" />);

    expect(field()).toHaveValue('Sat, 12 Dec 2026');
    expect(field()).toHaveAttribute('data-value', '2026-12-12');
    expect(field()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveAccessibleDescription('From 2 PM');

    rerender(<DateField label="Check-in" value="" onChange={vi.fn()} error="Choose a check-in date" />);
    expect(field()).toHaveValue('');
    expect(field()).toHaveAttribute('placeholder', 'DD/MM/YYYY');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAccessibleDescription('Choose a check-in date');
  });

  it('opens a calendar on the chosen month and chooses a day with a click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="2026-12-12" onChange={onChange} />);

    await user.click(field());
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', calendar().id);
    expect(within(calendar()).getByRole('gridcell', { selected: true })).toHaveTextContent('12');

    await user.click(day(/^24 December 2026,/));
    expect(onChange).toHaveBeenLastCalledWith('2026-12-24');
    expect(field()).toHaveValue('Thu, 24 Dec 2026');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it('takes a typed date (day first, ISO or spelled out) and puts back the chosen one when the text is unfinished', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <Controlled onChange={onChange} />
        <button type="button">Next</button>
      </>,
    );

    await user.type(field(), '25/12/2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-25');
    await user.clear(field());
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.type(field(), '2026-12-31');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(field()).toHaveValue('Thu, 31 Dec 2026');

    onChange.mockClear();
    await user.clear(field());
    await user.type(field(), '3 Jan 2027');
    expect(onChange).toHaveBeenLastCalledWith('2027-01-03');
    await user.type(field(), '{Backspace}');
    // Tab closes the calendar and moves on to the next field.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field()).toHaveValue('Sun, 3 Jan 2027');
  });

  it('strikes out days before min and after max and offers Today only when today can be chosen', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Controlled min="2026-11-06" max="2026-11-20" />);

    await user.click(field());
    expect(day(/^5 November 2026,/)).toBeDisabled();
    expect(day(/^21 November 2026,/)).toBeDisabled();
    expect(day(/^20 November 2026,/)).toBeEnabled();
    await user.click(within(calendar()).getByRole('button', { name: 'Today' }));
    expect(field()).toHaveAttribute('data-value', '2026-11-06');
    unmount();

    render(<Controlled min="2026-12-01" />);
    await user.click(field());
    expect(within(calendar()).queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('works from the keyboard: ↓ moves into the calendar, arrows move, Enter chooses, Escape closes only the calendar', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const outerEscape = vi.fn();
    document.addEventListener('keydown', outerEscape);
    render(<Controlled initial="2026-12-12" onChange={onChange} />);

    field().focus();
    await user.keyboard('{ArrowDown}');
    expect(day(/^12 December 2026,/)).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(day(/^20 December 2026,/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-20');
    expect(field()).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field()).toHaveFocus();
    expect(outerEscape.mock.calls.some(([event]) => (event as KeyboardEvent).key === 'Escape')).toBe(false);

    await user.click(field());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    document.removeEventListener('keydown', outerEscape);
  });

  it('has month and year menus for far-off dates and pages with arrows on a travel calendar', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Controlled initial="1990-04-12" max="2026-11-06" label="Date of birth" />);

    await user.click(screen.getByRole('combobox', { name: 'Date of birth' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose date' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /year/i }), '1985');
    expect(within(dialog).getByRole('grid')).toHaveAccessibleName(/April 1985/);
    unmount();

    render(<Controlled initial="2026-12-12" months={2} />);
    await user.click(field());
    expect(within(calendar()).queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(within(calendar()).getByRole('button', { name: /next month/i }));
    expect(within(calendar()).getByRole('grid')).toHaveAccessibleName(/January 2027/);
  });

  it('shades a stay between the start and the chosen end day and previews it on hover', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="2026-12-15" rangeStart="2026-12-12" label="Check-out" />);

    await user.click(screen.getByRole('combobox', { name: 'Check-out' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose date' });
    const cell = (date: string) => dialog.querySelector(`[data-day="${date}"]`);
    expect(cell('2026-12-12')).toHaveClass('cal-range-start');
    expect(cell('2026-12-13')).toHaveClass('cal-range-middle');
    expect(cell('2026-12-15')).toHaveClass('cal-range-end');
    expect(cell('2026-12-16')).not.toHaveClass('cal-range-middle');

    await user.hover(within(dialog).getByRole('button', { name: /^18 December 2026,/ }));
    expect(cell('2026-12-16')).toHaveClass('cal-range-middle');
    expect(cell('2026-12-18')).toHaveClass('cal-range-end');
  });

  it('clears an optional date, submits the ISO value under its name and reports blur and ref', async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    const { container } = render(
      <>
        <Controlled initial="2026-12-12" optional name="checkIn" onBlur={onBlur} onChange={onChange} ref={ref} />
        <button type="button">Elsewhere</button>
      </>,
    );

    const optionalField = screen.getByRole('combobox', { name: /Check-in/ });
    expect(ref.current).toBe(optionalField);
    expect(container.querySelector('input[type="hidden"][name="checkIn"]')).toHaveValue('2026-12-12');
    await user.click(optionalField);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(optionalField).toHaveValue('');
    expect(onBlur).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('closes on a press outside and does not open when disabled', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <>
        <Controlled />
        <p>Outside</p>
      </>,
    );
    await user.click(field());
    expect(calendar()).toBeInTheDocument();
    await user.click(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    render(<Controlled disabled />);
    expect(field()).toBeDisabled();
    await user.click(field());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
