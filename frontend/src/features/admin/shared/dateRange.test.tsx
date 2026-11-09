import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DateRangePicker } from './DateRangePicker';
import { rangeDays, rangeQuery, rangeSearchParams, readRange, validateCustomRange, type DateRange } from './dateRange';

describe('date ranges', () => {
  it('reads a preset from the URL and falls back to the last 30 days', () => {
    expect(readRange(new URLSearchParams('range=LAST_7_DAYS'))).toEqual({ preset: 'LAST_7_DAYS', from: '', to: '' });
    expect(readRange(new URLSearchParams(''))).toEqual({ preset: 'LAST_30_DAYS', from: '', to: '' });
    expect(readRange(new URLSearchParams('range=YESTERDAY'))).toEqual({ preset: 'LAST_30_DAYS', from: '', to: '' });
  });

  it('only accepts a sensible custom range', () => {
    expect(readRange(new URLSearchParams('range=CUSTOM&from=2026-10-01&to=2026-10-31'))).toEqual({ preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-31' });
    expect(readRange(new URLSearchParams('range=CUSTOM&from=2026-10-31&to=2026-10-01')).preset).toBe('LAST_30_DAYS');
    expect(validateCustomRange('', '2026-10-01')).toBe('Choose a start and an end date.');
    expect(validateCustomRange('2026-02-30', '2026-03-01')).toBe('Choose a start and an end date.');
    expect(validateCustomRange('2026-10-02', '2026-10-01')).toBe('The start date must be on or before the end date.');
    // 366 days (both inclusive) is the most.
    expect(validateCustomRange('2025-01-01', '2026-01-01')).toBeNull();
    expect(validateCustomRange('2025-01-01', '2026-01-02')).toBe('Choose at most 366 days.');
  });

  it('writes the URL (default preset left out) and the API parameters', () => {
    expect(rangeSearchParams({ preset: 'LAST_30_DAYS', from: '', to: '' })).toEqual({ range: null, from: null, to: null });
    expect(rangeSearchParams({ preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-05' })).toEqual({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-05' });
    expect(rangeQuery({ preset: 'THIS_MONTH', from: '', to: '' })).toEqual({ range: 'THIS_MONTH' });
    expect(rangeQuery({ preset: 'CUSTOM', from: '2026-10-01', to: '2026-10-05' })).toEqual({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-05' });
    expect(rangeDays({ from: '2026-10-07', to: '2026-11-05' })).toBe('7 Oct 2026 – 5 Nov 2026');
    expect(rangeDays({ from: '2026-11-05', to: '2026-11-05' })).toBe('5 Nov 2026');
  });
});

describe('DateRangePicker', () => {
  function Harness({ onChange }: { onChange: (range: DateRange) => void }) {
    const [range, setRange] = useState<DateRange>({ preset: 'LAST_30_DAYS', from: '', to: '' });
    return <DateRangePicker value={range} onChange={(next) => { setRange(next); onChange(next); }} />;
  }

  it('applies a preset at once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'Previous month');

    expect(onChange).toHaveBeenCalledWith({ preset: 'PREVIOUS_MONTH', from: '', to: '' });
  });

  it('checks custom dates before applying them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'Custom dates');
    expect(onChange).not.toHaveBeenCalled();
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    await user.type(from, '2026-10-10');
    await user.type(to, '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The start date must be on or before the end date.');
    expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();

    await user.clear(to);
    await user.type(to, '2026-10-20');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith({ preset: 'CUSTOM', from: '2026-10-10', to: '2026-10-20' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
