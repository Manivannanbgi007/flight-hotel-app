import { screen, waitFor, within } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { HotelReportsPage } from './HotelReportsPage';
import { managerApi } from './managerApi';
import { operationsApi } from './operationsApi';
import { occupancyFixture, revenueFixture, roomTypeReportFixture } from './opsTestData';

vi.mock('./operationsApi', () => ({
  operationsApi: { occupancyReport: vi.fn(), revenueReport: vi.fn(), roomTypeReport: vi.fn() },
}));
vi.mock('./managerApi', () => ({ managerApi: { myHotels: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', email: 'manager@example.com', roles: ['HOTEL_MANAGER'] };

const open = (path = '/hotel-manager/hotels/h1/reports') => renderRoutes([
  { path: '/hotel-manager/hotels/:hotelId/reports', element: <HotelReportsPage /> },
], { path, auth: fakeAuth({ user: manager }) });

/** Opens the Export menu and downloads `format`; returns the saved file and its name. */
async function exportAs(user: ReturnType<typeof open>['user'], format: RegExp) {
  const files = stubFileSaving();
  await user.click(screen.getByRole('button', { name: 'Export' }));
  await user.click(within(screen.getByRole('dialog', { name: /^Export / })).getByRole('button', { name: format }));
  await waitFor(() => expect(files.saved).toHaveLength(1));
  return { blob: files.blobs[0]!, fileName: files.saved[0]!.fileName };
}

const lines = async (blob: Blob) => (await blob.text()).split('\r\n').filter(Boolean);

beforeEach(() => {
  vi.mocked(managerApi.myHotels).mockResolvedValue([{ id: 'h1', name: 'Sea Breeze Resort' }] as Awaited<ReturnType<typeof managerApi.myHotels>>);
  vi.mocked(operationsApi.occupancyReport).mockResolvedValue(occupancyFixture());
  vi.mocked(operationsApi.revenueReport).mockResolvedValue(revenueFixture());
  vi.mocked(operationsApi.roomTypeReport).mockResolvedValue(roomTypeReportFixture());
});

describe('HotelReportsPage', () => {
  it('shows how each room type performed, with totals, in the URL', async () => {
    const { user, router } = open();
    await screen.findByRole('table', { name: 'Occupancy per night' });

    await user.click(screen.getByRole('button', { name: 'Room types' }));

    const table = await screen.findByRole('table', { name: 'Room type performance' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Deluxe Sea View820₹1,00,000₹5,00080%');
    expect(rows[2]).toHaveTextContent('Garden Room410₹25,000₹2,50020%');
    expect(rows[3]).toHaveTextContent('Total1230₹1,25,000');
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reports?report=room-types');
    expect(operationsApi.roomTypeReport).toHaveBeenCalledWith('h1', { range: 'LAST_30_DAYS' });
    expect(screen.getByRole('button', { name: 'Room types' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  it('says when no room night was sold in the period', async () => {
    vi.mocked(operationsApi.roomTypeReport).mockResolvedValue(roomTypeReportFixture({ rows: [], roomNights: 0, revenue: 0 }));
    open('/hotel-manager/hotels/h1/reports?report=room-types');

    expect(await screen.findByText('No room nights sold in this period')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('shows occupancy per night as a chart and a table with totals', async () => {
    open();

    const chart = await screen.findByRole('img', { name: /^Occupancy per night, 30 Oct 2026 – 31 Oct 2026\. Overall 85%/ });
    expect(chart).toHaveAccessibleName(expect.stringContaining('Highest 95% on 31 Oct 2026, lowest 75% on 30 Oct 2026.'));
    expect(chart.querySelectorAll('path')).toHaveLength(2);

    const table = screen.getByRole('table', { name: 'Occupancy per night' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('30 Oct 2026201575%');
    expect(rows[2]).toHaveTextContent('31 Oct 2026201995%');
    expect(rows[3]).toHaveTextContent('Total403485%');
    expect(operationsApi.occupancyReport).toHaveBeenCalledWith('h1', { range: 'LAST_30_DAYS' });
    expect(operationsApi.revenueReport).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Occupancy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the totals of the period above the chart, with the busiest night', async () => {
    open();

    const totals = await screen.findByRole('list', { name: 'Occupancy totals' });
    const tile = (label: string) => within(totals).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    await waitFor(() => expect(tile('Occupancy')).toHaveTextContent('85%'));
    await waitFor(() => expect(tile('Room nights for sale')).toHaveTextContent('40'));
    await waitFor(() => expect(tile('Room nights sold')).toHaveTextContent('34'));
    expect(tile('Busiest night')).toHaveTextContent('95%31 Oct 2026');
  });

  it('shows the revenue totals with the best night, and the room types with the top one', async () => {
    const { user } = open('/hotel-manager/hotels/h1/reports?report=revenue');

    const revenueTotals = await screen.findByRole('list', { name: 'Revenue totals' });
    const revenueTile = (label: string) =>
      within(revenueTotals).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    expect(revenueTile('Best night')).toHaveTextContent('₹1,04,50031 Oct 2026');
    await waitFor(() => expect(revenueTile('Room revenue')).toHaveTextContent('₹1,79,500'));

    await user.click(screen.getByRole('button', { name: 'Room types' }));

    const roomTotals = await screen.findByRole('list', { name: 'Room type totals' });
    const roomTile = (label: string) =>
      within(roomTotals).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    expect(roomTile('Top room type')).toHaveTextContent('Deluxe Sea View80% of the revenue');
    await waitFor(() => expect(roomTile('Stays')).toHaveTextContent('12'));
  });

  it('switches to revenue and keeps the report and the period in the URL', async () => {
    const { user, router } = open('/hotel-manager/hotels/h1/reports?range=LAST_7_DAYS');
    await screen.findByRole('table', { name: 'Occupancy per night' });

    await user.click(screen.getByRole('button', { name: 'Revenue' }));

    const table = await screen.findByRole('table', { name: 'Room revenue per night' });
    expect(within(table).getAllByRole('row')[3]).toHaveTextContent('Total34₹1,79,500₹5,279');
    expect(screen.getByRole('img', { name: /^Room revenue per night, 30 Oct 2026 – 31 Oct 2026\. Total ₹1,79,500/ })).toBeInTheDocument();
    expect(operationsApi.revenueReport).toHaveBeenCalledWith('h1', { range: 'LAST_7_DAYS' });
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reports?range=LAST_7_DAYS&report=revenue');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'This month');
    await waitFor(() => expect(operationsApi.revenueReport).toHaveBeenLastCalledWith('h1', { range: 'THIS_MONTH' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reports?range=THIS_MONTH&report=revenue');
  });

  it('says so when the period has no nights', async () => {
    vi.mocked(operationsApi.occupancyReport).mockResolvedValue(occupancyFixture({ rows: [], totals: { roomNights: 0, bookedRoomNights: 0, occupancyPercent: 0 } }));
    open();

    expect(await screen.findByText('No nights in this period')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exports the occupancy report as CSV, every night and the Total row, named after the report, hotel and period', async () => {
    const { user } = open('/hotel-manager/hotels/h1/reports?range=LAST_7_DAYS');
    await screen.findByRole('table', { name: 'Occupancy per night' });

    const file = await exportAs(user, /^CSV/);

    expect(await lines(file.blob)).toEqual([
      '"Night","Rooms for sale","Rooms sold","Occupancy (%)"',
      '2026-10-30,20,15,75',
      '2026-10-31,20,19,95',
      '"Total",40,34,85',
    ]);
    expect(file.fileName).toMatch(/^occupancy-report-sea-breeze-resort-2026-10-30-2026-10-31-\d{4}-\d{2}-\d{2}\.csv$/);
    // Made in the browser from the report on screen: the server's CSV endpoint is not used any more.
  });

  it('exports the revenue report with money in rupees and the Total row', async () => {
    const { user } = open('/hotel-manager/hotels/h1/reports?report=revenue');
    await screen.findByRole('table', { name: 'Room revenue per night' });

    const file = await exportAs(user, /^CSV/);

    expect(await lines(file.blob)).toEqual([
      '"Night","Room nights sold","Revenue (INR)","Average daily rate (INR)"',
      '2026-10-30,15,75000.00,5000.00',
      '2026-10-31,19,104500.00,5500.00',
      '"Total",34,179500.00,5279.41',
    ]);
  });

  it('exports the room types with their Total row, and names the report, hotel, period and filters in Excel', async () => {
    const { user } = open('/hotel-manager/hotels/h1/reports?report=room-types');
    await screen.findByRole('table', { name: 'Room type performance' });

    const csv = await exportAs(user, /^CSV/);
    expect(await lines(csv.blob)).toEqual([
      '"Room type","Stays","Room nights sold","Revenue (INR)","Average daily rate (INR)","Share of revenue (%)"',
      '"Deluxe Sea View",8,20,100000.00,5000.00,80',
      '"Garden Room",4,10,25000.00,2500.00,20',
      '"Total",12,30,125000.00,4166.67,',
    ]);

    const xlsx = await exportAs(user, /^Excel/);
    expect(xlsx.fileName).toMatch(/^room-types-report-sea-breeze-resort-2026-10-02-2026-10-31-.*\.xlsx$/);
    const workbook = unzipSync(new Uint8Array(await xlsx.blob.arrayBuffer()));
    const about = strFromU8(workbook['xl/worksheets/sheet2.xml']!);
    for (const text of ['Room types report', 'Sea Breeze Resort · 2 Oct 2026 – 31 Oct 2026', 'Report', 'Room types', 'Period',
      'Last 30 days (2 Oct 2026 – 31 Oct 2026)']) {
      expect(about).toContain(text);
    }
    // The filter covers the room types; the bold Total row stays below it.
    const sheet = strFromU8(workbook['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<autoFilter ref="A1:F3"/>');
    expect(sheet).toContain('<c r="A4" t="inlineStr" s="12"><is><t>Total</t></is></c>');
  });

  it('cannot export while the period has no nights', async () => {
    vi.mocked(operationsApi.occupancyReport).mockResolvedValue(occupancyFixture({ rows: [], totals: { roomNights: 0, bookedRoomNights: 0, occupancyPercent: 0 } }));
    open();

    expect(await screen.findByText('No nights in this period')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('tells a manager when the hotel is not assigned to them', async () => {
    vi.mocked(operationsApi.occupancyReport).mockRejectedValue(new ApiError(403, 'HOTEL_NOT_ASSIGNED', 'Forbidden'));
    open();

    expect(await screen.findByRole('heading', { name: 'This hotel is not assigned to you' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });
});
