import { screen, waitFor, within } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';

import { ApiError } from '@/lib/api/apiError';
import type { Page } from '@/lib/api/types';
import type { ExportColumn } from '@/lib/export';
import { stubFileSaving } from '@/test/downloads';
import { admin, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { ExportMenu, type ExportMenuProps } from './ExportMenu';

interface Booking {
  id: string;
  guest: string;
  amount: number;
}

const COLUMNS: ExportColumn<Booking>[] = [
  { header: 'Guest', value: (row) => row.guest },
  { header: 'Amount', value: (row) => row.amount, type: 'money' },
];
const booking = (index: number): Booking => ({ id: `b${index}`, guest: `Guest ${index}`, amount: 1000 + index });
const ALL = Array.from({ length: 60 }, (_, index) => booking(index));
const pageOf = (page: number, size: number): Page<Booking> => ({
  content: ALL.slice(page * size, page * size + size), page, size, totalElements: ALL.length, totalPages: Math.ceil(ALL.length / size),
});

const open = (props: Partial<ExportMenuProps<Booking>> = {}) => renderRoutes([{
  path: '/',
  element: <ExportMenu title="Bookings" subtitle="All hotels" fileName="bookings" columns={COLUMNS} rows={ALL.slice(0, 25)} {...props} />,
}], { path: '/', auth: fakeAuth({ user: { ...admin, firstName: 'Meera', lastName: 'Shah' } }) });

const textOf = (blob: Blob) => blob.text();

describe('ExportMenu', () => {
  it('exports the rows on screen as CSV, named after the export and the day', async () => {
    const files = stubFileSaving();
    const { user } = open();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export bookings' });
    // A list that is not paged by the server: no choice of rows.
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^bookings-\d{4}-\d{2}-\d{2}\.csv$/);
    // UTF-8 with a byte order mark (Excel then reads ₹ and accents right); `text()` drops the mark when decoding.
    expect([...new Uint8Array(await files.blobs[0]!.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await textOf(files.blobs[0]!);
    expect(csv.split('\r\n')[0]).toBe('"Guest","Amount (INR)"');
    expect(csv.split('\r\n')).toHaveLength(27);
    expect(await screen.findByText('CSV file downloaded')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('collects every matching row through the same API for "All matching rows", and writes who and what into Excel', async () => {
    const files = stubFileSaving();
    const fetchPage = vi.fn(async (page: number) => pageOf(page, 25));
    const { user } = open({
      fetchPage, total: 60, pageLabel: 'Page 1 of 3', rowKey: (row) => row.id,
      filters: [{ label: 'Status', value: 'Confirmed' }],
    });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export bookings' });
    expect(within(panel).getByRole('radio', { name: /This page/ })).toBeChecked();
    expect(within(panel).getByText('Page 1 of 3 · 25 rows')).toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^Excel/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([0, 1, 2]);
    expect(files.saved[0]!.fileName).toMatch(/\.xlsx$/);
    const workbook = unzipSync(new Uint8Array(await files.blobs[0]!.arrayBuffer()));
    const sheet = strFromU8(workbook['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<autoFilter ref="A1:B61"/>');
    const about = strFromU8(workbook['xl/worksheets/sheet2.xml']!);
    for (const text of ['Bookings', 'All hotels', 'Meera Shah (Administrator)', 'All 60 rows matching the filters', 'Status', 'Confirmed']) {
      expect(about).toContain(text);
    }
  });

  it('adds the totals row only when the file holds every row', async () => {
    const files = stubFileSaving();
    const fetchPage = vi.fn(async (page: number) => pageOf(page, 25));
    const { user } = open({ fetchPage, total: 60, totals: ['Total', 61770] });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.blobs).toHaveLength(1));
    expect(await textOf(files.blobs[0]!)).not.toContain('"Total"');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));
    await waitFor(() => expect(files.blobs).toHaveLength(2));
    expect((await textOf(files.blobs[1]!)).trimEnd().split('\r\n').at(-1)).toBe('"Total",61770.00');
  });

  it('offers no "All matching rows" above the limit, and no PDF of more than 2,000 rows', async () => {
    const big = Array.from({ length: 2500 }, (_, index) => booking(index));
    const { user } = open({ rows: big, fetchPage: vi.fn(), total: 12_000 });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export bookings' });
    expect(within(panel).getByRole('radio', { name: /All matching rows/ })).toBeDisabled();
    expect(within(panel).getByText('12,000 rows: more than 10,000, narrow the filters')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /^PDF/ })).toBeDisabled();
    expect(within(panel).getByText('At most 2,000 rows: choose Excel or CSV')).toBeInTheDocument();
  });

  it('says why when collecting fails, and keeps the menu open to try again', async () => {
    stubFileSaving();
    const fetchPage = vi.fn().mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is not available right now.'));
    const { user } = open({ fetchPage, total: 60 });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The service is not available right now.');
    expect(screen.getByRole('dialog', { name: 'Export bookings' })).toBeInTheDocument();
  });

  it('is disabled with nothing to export, reminds about personal data, and Escape closes it', async () => {
    const { unmount } = open({ rows: [] });
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    unmount();

    const again = open({ personalData: true });
    const button = screen.getByRole('button', { name: 'Export' });
    await again.user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/The file holds personal data/)).toBeInTheDocument();
    await again.user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  describe('above the limit, with an export prepared on the server', () => {
    const NOTE = 'The server prepares the file and we tell you when it’s ready.';

    it('offers every matching row, asks the server for Excel or CSV (not PDF), and closes with a toast', async () => {
      const files = stubFileSaving();
      const start = vi.fn().mockResolvedValue(undefined);
      const fetchPage = vi.fn();
      const { user } = open({ fetchPage, total: 12_000, serverExport: { start, note: NOTE } });

      const button = screen.getByRole('button', { name: 'Export' });
      await user.click(button);
      const panel = screen.getByRole('dialog', { name: 'Export bookings' });
      const all = within(panel).getByRole('radio', { name: /All matching rows/ });
      expect(all).toBeEnabled();
      expect(within(panel).getByText(NOTE)).toBeInTheDocument();
      expect(within(panel).queryByText(/narrow the filters/)).not.toBeInTheDocument();
      await user.click(all);
      expect(within(panel).getByRole('button', { name: /^PDF/ })).toBeDisabled();

      await user.click(within(panel).getByRole('button', { name: /^Excel/ }));

      // Who exported goes to the server too (the file names them); no row is fetched or saved in the browser.
      await waitFor(() => expect(start).toHaveBeenCalledWith('xlsx', { exportedBy: 'Meera Shah (Administrator)' }));
      expect(fetchPage).not.toHaveBeenCalled();
      expect(files.saved).toHaveLength(0);
      expect(await screen.findByText('Preparing your export')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });

    it('still exports this page in the browser', async () => {
      const files = stubFileSaving();
      const start = vi.fn();
      const { user } = open({ fetchPage: vi.fn(), total: 12_000, serverExport: { start, note: NOTE } });

      await user.click(screen.getByRole('button', { name: 'Export' }));
      expect(screen.getByRole('radio', { name: /This page/ })).toBeChecked();
      await user.click(screen.getByRole('button', { name: /^CSV/ }));

      await waitFor(() => expect(files.saved).toHaveLength(1));
      expect(start).not.toHaveBeenCalled();
    });

    it('says why when the server refuses, and keeps the menu open', async () => {
      const start = vi.fn().mockRejectedValue(new ApiError(409, 'EXPORT_LIMIT_REACHED', 'You already have 2 exports in progress.'));
      const { user } = open({ fetchPage: vi.fn(), total: 12_000, serverExport: { start, note: NOTE } });

      await user.click(screen.getByRole('button', { name: 'Export' }));
      await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
      await user.click(screen.getByRole('button', { name: /^CSV/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent('You already have 2 exports in progress.');
      expect(start).toHaveBeenCalledWith('csv', expect.anything());
      expect(screen.getByRole('dialog', { name: 'Export bookings' })).toBeInTheDocument();
    });

    it('is not used at or below the limit: the browser collects the rows as before', async () => {
      const files = stubFileSaving();
      const start = vi.fn();
      const fetchPage = vi.fn(async (page: number) => pageOf(page, 25));
      const { user } = open({ fetchPage, total: 60, serverExport: { start, note: NOTE } });

      await user.click(screen.getByRole('button', { name: 'Export' }));
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
      await user.click(screen.getByRole('button', { name: /^CSV/ }));

      await waitFor(() => expect(files.saved).toHaveLength(1));
      expect(start).not.toHaveBeenCalled();
    });
  });
});
