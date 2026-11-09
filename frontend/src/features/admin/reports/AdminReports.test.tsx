import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, renderAdmin } from '../testUtils';
import { AdminReportPage } from './AdminReportPage';
import { AdminReportsPage } from './AdminReportsPage';
import { reportApi, type ReportResult } from './reportApi';
import { formatCell, occupancyReport } from './reports';

vi.mock('./reportApi', () => ({ reportApi: { get: vi.fn(), occupancy: vi.fn() } }));

const bookingsReport = (overrides: Partial<ReportResult> = {}): ReportResult => ({
  range: { preset: 'LAST_30_DAYS', from: '2026-10-07', to: '2026-11-05' },
  columns: [
    { key: 'reference', label: 'Reference', type: 'TEXT' },
    { key: 'travelDate', label: 'Travel date', type: 'DATE' },
    { key: 'totalAmount', label: 'Amount', type: 'MONEY' },
    { key: 'refundedAmount', label: 'Refunded', type: 'MONEY' },
    { key: 'createdAt', label: 'Created', type: 'DATETIME' },
  ],
  content: [
    { reference: 'HT-7K3M9Q2X', travelDate: '2026-12-10', totalAmount: 6300, refundedAmount: 0, createdAt: '2026-11-01T10:00:00Z', bookingId: 'b1' },
    { reference: 'FL-AB12CD34', travelDate: '2026-12-01', totalAmount: 4500.5, refundedAmount: null, createdAt: '2026-11-02T10:00:00Z', bookingId: 'b2' },
  ],
  page: 0, size: 20, totalElements: 2, totalPages: 1,
  totals: { count: 2, totalAmount: 10800.5, refundedAmount: 0 },
  ...overrides,
});

const routes = [
  { path: '/admin/reports', element: <AdminReportsPage /> },
  { path: '/admin/reports/:report', element: <AdminReportPage /> },
];
const lastQuery = () => vi.mocked(reportApi.get).mock.lastCall?.[1];

describe('AdminReportsPage', () => {
  it('offers the 7 reports and the hotel occupancy', async () => {
    const { user, router } = renderAdmin(routes, '/admin/reports');

    const list = screen.getByRole('list', { name: 'Reports' });
    expect(within(list).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/reports/bookings', '/admin/reports/revenue', '/admin/reports/payments', '/admin/reports/refunds',
      '/admin/reports/cancellations', '/admin/reports/destinations', '/admin/reports/customers', '/admin/reports/occupancy',
    ]);
    vi.mocked(reportApi.get).mockResolvedValue(bookingsReport());
    await user.click(within(list).getByRole('link', { name: /Revenue/ }));
    expect(currentLocation(router)).toBe('/admin/reports/revenue');
  });
});

describe('AdminReportPage', () => {
  it('shows the columns formatted by type, with a totals row and the row count', async () => {
    vi.mocked(reportApi.get).mockResolvedValue(bookingsReport());
    renderAdmin(routes, '/admin/reports/bookings');

    const table = await screen.findByRole('table', { name: 'Bookings report' });
    const rows = within(table).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('ReferenceTravel dateAmountRefundedCreated');
    expect(rows[1]).toHaveTextContent('HT-7K3M9Q2X10 Dec 2026₹6,300.00₹0.00');
    expect(rows[2]).toHaveTextContent('FL-AB12CD341 Dec 2026₹4,500.50—');
    expect(rows[3]).toHaveTextContent('Total₹10,800.50₹0.00');
    // Rows carry the booking id (not a column): the reference opens the booking.
    expect(within(rows[1]!).getByRole('link', { name: 'HT-7K3M9Q2X' })).toHaveAttribute('href', '/admin/bookings/b1');
    expect(screen.getByLabelText('Totals')).toHaveTextContent('Rows:2');
    expect(screen.getByText(/7 Oct 2026 – 5 Nov 2026/)).toBeInTheDocument();
    expect(reportApi.get).toHaveBeenCalledWith('bookings', { range: { preset: 'LAST_30_DAYS', from: '', to: '' }, q: '', type: '', status: '', sort: '', page: 0 }, 25);
  });

  it('sorts by a column header, filters, searches and pages (all in the URL)', async () => {
    vi.mocked(reportApi.get).mockResolvedValue(bookingsReport({ totalElements: 45, totalPages: 3 }));
    const { user, router } = renderAdmin(routes, '/admin/reports/bookings');
    await screen.findByRole('table', { name: 'Bookings report' });

    // Only the sortable columns have a sort button.
    expect(screen.queryByRole('button', { name: /Reference/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Amount/ }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'totalAmount,desc' }));
    expect(screen.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'descending');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Flights');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Cancelled');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'goa');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'goa', type: 'FLIGHT', status: 'CANCELLED', sort: 'totalAmount,desc', page: 0 }));

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 1 }));
    expect(currentLocation(router)).toBe('/admin/reports/bookings?sort=totalAmount%2Cdesc&type=FLIGHT&status=CANCELLED&q=goa&page=1');
  });

  it('asks for another date range', async () => {
    vi.mocked(reportApi.get).mockResolvedValue(bookingsReport());
    const { user } = renderAdmin(routes, '/admin/reports/revenue');
    await screen.findByRole('table');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'This month');

    await waitFor(() => expect(lastQuery()).toMatchObject({ range: { preset: 'THIS_MONTH', from: '', to: '' } }));
  });

  it('exports a report like every table: every matching row through the report API, with the totals row', async () => {
    const files = stubFileSaving();
    // Two pages of one row each; the totals cover both.
    vi.mocked(reportApi.get).mockImplementation(async (_report, query) => bookingsReport({
      content: [bookingsReport().content[query.page]!], page: query.page, size: 1, totalElements: 2, totalPages: 2,
    }));
    const { user } = renderAdmin(routes, '/admin/reports/bookings?type=HOTEL&sort=createdAt,asc');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();

    // This page: no totals row (the totals are those of every row, not of this page).
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.blobs).toHaveLength(1));
    expect((await files.blobs[0]!.text()).trimEnd().split('\r\n')).toEqual([
      '"Reference","Travel date","Amount (INR)","Refunded (INR)","Created"',
      expect.stringMatching(/^"HT-7K3M9Q2X",2026-12-10,6300\.00,0\.00,2026-11-01 \d{2}:\d{2}$/),
    ]);

    // Every matching row: the same range, type and sort for each page, then the totals row.
    vi.mocked(reportApi.get).mockClear();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.blobs).toHaveLength(2));
    expect(vi.mocked(reportApi.get).mock.calls.map(([report, query, size]) => [report, query.page, query.type, query.sort, size])).toEqual([
      ['bookings', 0, 'HOTEL', 'createdAt,asc', 100], ['bookings', 1, 'HOTEL', 'createdAt,asc', 100],
    ]);
    const lines = (await files.blobs[1]!.text()).trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('"Total",,10800.50,0.00,');
    expect(files.saved[1]!.fileName).toMatch(/^bookings-report-2026-10-07-2026-11-05-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('offers every matching row only up to the export limit', async () => {
    vi.mocked(reportApi.get).mockResolvedValue(bookingsReport({ totalElements: 12_000, totalPages: 480 }));
    const { user } = renderAdmin(routes, '/admin/reports/bookings');
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByRole('radio', { name: /All matching rows/ })).toBeDisabled();
    expect(screen.getByText('12,000 rows: more than 10,000, narrow the filters')).toBeInTheDocument();
  });

  it('shows hotel occupancy per hotel with totals and search, and exports what the search shows', async () => {
    const files = stubFileSaving();
    vi.mocked(reportApi.occupancy).mockResolvedValue({
      range: { preset: 'LAST_7_DAYS', from: '2026-10-30', to: '2026-11-05' },
      hotels: [
        { hotelId: 'h1', name: 'Sea Breeze Resort', city: 'Goa', roomNights: 300, bookedRoomNights: 240, occupancyPercent: 80, revenue: 600000 },
        { hotelId: 'h2', name: 'City Lights Hotel', city: 'Mumbai', roomNights: 100, bookedRoomNights: 40, occupancyPercent: 40, revenue: 150000 },
      ],
      totals: { roomNights: 400, bookedRoomNights: 280, occupancyPercent: 70, revenue: 750000 },
    });
    const { user } = renderAdmin(routes, '/admin/reports/occupancy?range=LAST_7_DAYS');

    const table = await screen.findByRole('table', { name: 'Hotel occupancy report' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Sea Breeze ResortGoa30024080.0%₹6,00,000.00');
    expect(rows[3]).toHaveTextContent('Total40028070.0%₹7,50,000.00');
    expect(reportApi.occupancy).toHaveBeenCalledWith({ preset: 'LAST_7_DAYS', from: '', to: '' });
    expect(screen.getByText(/30 Oct 2026 – 5 Nov 2026/)).toBeInTheDocument();
    // The server's occupancy CSV ignores the search: the Export menu writes what the screen shows instead.
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Occupancy/ }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Sea Breeze Resort');
    await user.click(screen.getByRole('button', { name: /Occupancy/ }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('City Lights Hotel');

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'mumbai');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3));
    // The totals follow the search.
    expect(within(screen.getByRole('table')).getAllByRole('row')[2]).toHaveTextContent('Total1004040.0%₹1,50,000.00');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Export hotel occupancy' })).getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^hotel-occupancy-2026-10-30-2026-11-05-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"Hotel","City","Room nights","Booked room nights","Occupancy (%)","Revenue (INR)"',
      '"City Lights Hotel","Mumbai",100,40,40,150000.00',
      // The totals row, for what the search shows (like the table's foot).
      '"Total",,100,40,40,150000.00',
      '',
    ]);
  });

  it('exports every matching hotel of the occupancy list, searched and sorted like the screen, across its pages', async () => {
    const files = stubFileSaving();
    vi.mocked(reportApi.occupancy).mockResolvedValue({
      range: { preset: 'LAST_7_DAYS', from: '2026-10-30', to: '2026-11-05' },
      hotels: Array.from({ length: 14 }, (_, index) => ({
        hotelId: `h${index}`, name: `Hotel ${index}`, city: index < 12 ? 'Goa' : 'Pune', roomNights: 100, bookedRoomNights: index,
        occupancyPercent: index, revenue: 1000 * index,
      })),
      totals: null,
    });
    const { user } = renderAdmin(routes, '/admin/reports/occupancy?range=LAST_7_DAYS&q=goa&sort=revenue,desc&size=10');
    await screen.findByRole('table', { name: 'Hotel occupancy report' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export hotel occupancy' });
    expect(within(panel).getByText('Page 1 of 2 · 10 rows')).toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    const lines = (await files.blobs[0]!.text()).split('\r\n').filter(Boolean);
    // The 12 hotels in Goa, highest revenue first, then their totals row; the list is not loaded again.
    expect(lines).toHaveLength(14);
    expect(lines[13]).toMatch(/^"Total",,1200,66,/);
    expect(lines[1]).toBe('"Hotel 11","Goa",100,11,11,11000.00');
    expect(lines[12]).toBe('"Hotel 0","Goa",100,0,0,0.00');
    expect(reportApi.occupancy).toHaveBeenCalledTimes(1);
  });

  it('says when a report does not exist', () => {
    renderAdmin(routes, '/admin/reports/profits');

    expect(screen.getByRole('heading', { name: 'This report does not exist' })).toBeInTheDocument();
    expect(reportApi.get).not.toHaveBeenCalled();
  });

  it('shows loading errors with the support reference', async () => {
    vi.mocked(reportApi.get).mockRejectedValue(new ApiError(400, 'INVALID_RANGE', 'Choose at most 366 days.', [], 'corr-14'));
    renderAdmin(routes, '/admin/reports/customers');

    expect(await screen.findByText('Choose at most 366 days.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-14')).toBeInTheDocument();
  });

  it('is closed without REPORT_VIEW', () => {
    renderAdmin(routes, '/admin/reports/bookings', adminWithout('REPORT_VIEW'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(reportApi.get).not.toHaveBeenCalled();
  });
});

describe('report formatting', () => {
  it('formats each column type', () => {
    expect(formatCell(1234.5, 'MONEY')).toBe('₹1,234.50');
    expect(formatCell(123456, 'NUMBER')).toBe('1,23,456');
    expect(formatCell(66.666, 'PERCENT')).toBe('66.7%');
    expect(formatCell('2026-11-05', 'DATE')).toBe('5 Nov 2026');
    expect(formatCell(null, 'TEXT')).toBe('—');
  });

  it('pages the occupancy list here and keeps the totals for every hotel', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ hotelId: `h${index}`, name: `Hotel ${index}`, city: 'Goa', roomNights: 10,
      bookedRoomNights: 5, occupancyPercent: 50, revenue: 1000 }));
    const report = occupancyReport({ range: null, hotels: rows, totals: null }, { q: '', sort: '', page: 1 });
    expect(report.content).toHaveLength(5);
    expect(report.totalPages).toBe(2);
    expect(report.totals).toEqual({ roomNights: 250, bookedRoomNights: 125, occupancyPercent: 50, revenue: 25000 });
  });
});
