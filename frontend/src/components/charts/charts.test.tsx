import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { cartesianModel, donutModel } from './chartModel';
import { BarChart, DonutChart, LineChart } from './Charts';
import { formatCompact, formatDateCategory, formatINR, formatINRCompact, formatPercent, resolveValueFormat } from './format';
import { CHART_SERIES_COLORS, seriesColor } from './palette';
import { Sparkline } from './Sparkline';

const rows = [
  { date: '2026-10-01', hotel: 3, flight: 2 },
  { date: '2026-10-02', hotel: 5, flight: 0 },
  { date: '2026-10-03', hotel: 0, flight: 4 },
];
const series = [{ key: 'hotel', label: 'Hotels' }, { key: 'flight', label: 'Flights' }];

describe('chart formats', () => {
  it('writes rupees with Indian grouping, compact on axes', () => {
    expect(formatINR(200000)).toBe('₹2,00,000');
    expect(formatINR(5913.6, { paise: true })).toBe('₹5,913.60');
    expect(formatINRCompact(9800)).toBe('₹9,800');
    expect(formatINRCompact(200000)).toBe('₹2L');
    expect(formatINRCompact(25000000)).toBe('₹2.5Cr');
    expect(formatCompact(1500000)).toBe('15L');
    expect(formatPercent(12.345)).toBe('12.3%');
  });

  it('reads the API intervals as dates', () => {
    expect(formatDateCategory('2026-10-07', 'DAY')).toBe('7 Oct');
    expect(formatDateCategory('2026-10-05', 'week')).toBe('5 Oct');
    expect(formatDateCategory('2026-10', 'MONTH')).toBe('Oct 2026');
    expect(formatDateCategory('2026', 'YEAR')).toBe('2026');
    expect(formatDateCategory('Hotels', 'DAY')).toBe('Hotels');
    expect(formatDateCategory('Q4', (value) => `Quarter ${value}`)).toBe('Quarter Q4');
  });

  it('pairs a full and an axis format', () => {
    const inr = resolveValueFormat('inr');
    expect([inr.full(250000), inr.tick(250000)]).toEqual(['₹2,50,000', '₹2.5L']);
    expect(resolveValueFormat('count').full(1284.4)).toBe('1,284');
  });
});

describe('chart colours', () => {
  it('keep their validated order and never invent a colour', () => {
    expect(seriesColor(0)).toBe('#2a78d6');
    expect(seriesColor(1)).toBe('#eb6834');
    expect(seriesColor(9)).toBe(CHART_SERIES_COLORS[1]);
    expect(seriesColor(0, '#123456')).toBe('#123456');
  });
});

describe('chart models', () => {
  it('summarise, tabulate and detect empty data', () => {
    const model = cartesianModel({ title: 'Bookings per day', data: rows, xKey: 'date', series, valueFormat: 'count', xFormat: 'DAY' });
    expect(model.summary).toBe('Bookings per day, 1 Oct to 3 Oct. Hotels: 8 in total, highest 5 on 2 Oct. Flights: 6 in total, highest 4 on 3 Oct.');
    expect(model.table).toEqual({ columns: ['Date', 'Hotels', 'Flights'], rows: [['1 Oct', '3', '2'], ['2 Oct', '5', '0'], ['3 Oct', '0', '4']] });
    expect(model.empty).toBe(false);
    expect(cartesianModel({ title: 'X', data: [{ date: 'a', hotel: 0 }], xKey: 'date', series }).empty).toBe(true);
  });

  it('give donut shares', () => {
    const model = donutModel({ title: 'Cancellations', data: [{ label: 'By customer', value: 3 }, { label: 'By hotel', value: 1 }], valueFormat: 'count' });
    expect(model.summary).toBe('Cancellations, 4 in total. By customer: 3 (75%). By hotel: 1 (25%).');
    expect(model.table.rows).toEqual([['By customer', '3', '75%'], ['By hotel', '1', '25%']]);
  });
});

describe('chart components', () => {
  // The plots are lazy-loaded; load recharts once up front, so no single test pays for it (slow under a full run).
  beforeAll(async () => {
    await import('./impl/rechartsPlots');
  }, 60_000);

  it('are an image with a summary, a legend for two series and the numbers as a table', async () => {
    const user = userEvent.setup();
    render(<BarChart title="Bookings per day" data={rows} xKey="date" xFormat="DAY" valueFormat="count" series={series} stacked />);

    expect(screen.getByRole('img', { name: /^Bookings per day, 1 Oct to 3 Oct\. Hotels: 8 in total/ })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Hotels', 'Flights']);
    const table = screen.getByRole('table', { name: 'Bookings per day' });
    expect(table.parentElement).toHaveClass('sr-only');
    expect(within(table).getAllByRole('row').map((row) => row.textContent)).toEqual(['DateHotelsFlights', '1 Oct32', '2 Oct50', '3 Oct04']);

    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(table.parentElement).not.toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Hide table' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('need no legend for one series', () => {
    render(<LineChart title="Revenue" data={rows} xKey="date" series={[series[0]!]} valueFormat="inr" />);
    expect(screen.queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Hotels: ₹8 in total/ })).toBeInTheDocument();
  });

  it('show a loading state and an empty state instead of the plot', () => {
    const { rerender } = render(<LineChart title="Revenue" data={rows} xKey="date" series={series} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Revenue…');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(<LineChart title="Revenue" data={[]} xKey="date" series={series} emptyMessage="No bookings in this period" />);
    expect(screen.getByText('No bookings in this period')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('put the total in the middle of a donut', () => {
    render(<DonutChart title="Cancellations" valueFormat="count" centerLabel="Cancelled"
      data={[{ label: 'By customer', value: 3 }, { label: 'By hotel', value: 1 }]} />);
    expect(screen.getByRole('img', { name: /Cancellations, 4 in total/ })).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('is decorative and needs two points', () => {
    const { container, rerender } = render(<Sparkline values={[1, 3, 2]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3);

    rerender(<Sparkline values={[4]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
