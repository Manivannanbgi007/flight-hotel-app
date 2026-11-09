import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { managerApi } from './managerApi';
import { operationsApi } from './operationsApi';
import { pageOf, reservationRow, reservationSummaryFixture } from './opsTestData';
import { ReservationsPage } from './ReservationsPage';

vi.mock('./operationsApi', () => ({ operationsApi: { reservations: vi.fn(), reservationSummary: vi.fn() } }));
vi.mock('./managerApi', () => ({ managerApi: { roomTypes: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', email: 'manager@example.com', roles: ['HOTEL_MANAGER'] };
const DEFAULTS = { status: '', dateField: 'CHECK_IN', from: '', to: '', q: '', sort: 'createdAt,desc', page: 0, roomTypeId: '' };
const lastSummaryFilters = () => vi.mocked(operationsApi.reservationSummary).mock.lastCall?.[1];

const open = (path = '/hotel-manager/hotels/h1/reservations') => renderRoutes([
  { path: '/hotel-manager/hotels/:hotelId/reservations', element: <ReservationsPage /> },
  { path: '/hotel-manager/hotels/:hotelId/reservations/:reservationId', element: <p>reservation page</p> },
], { path, auth: fakeAuth({ user: manager }) });
const lastFilters = () => vi.mocked(operationsApi.reservations).mock.lastCall?.[1];

beforeEach(() => {
  vi.mocked(operationsApi.reservations).mockResolvedValue(pageOf([]));
  vi.mocked(operationsApi.reservationSummary).mockResolvedValue(reservationSummaryFixture());
  vi.mocked(managerApi.roomTypes).mockResolvedValue([
    { id: 'rt1', name: 'Deluxe Sea View' }, { id: 'rt2', name: 'Garden Room' },
  ] as Awaited<ReturnType<typeof managerApi.roomTypes>>);
});

describe('ReservationsPage', () => {
  it('lists reservations with guest, stay, room, status and amount, and opens one', async () => {
    vi.mocked(operationsApi.reservations).mockResolvedValue(pageOf([
      reservationRow(),
      reservationRow({ reservationId: 'r2', leadGuest: null, bookingReference: 'HT-BBBB2222', confirmationNumber: null, status: 'CHECKED_IN',
        rooms: 2, adults: 4, children: 1, totalAmount: 9000 }),
    ]));
    const { user, router } = open();

    const table = await screen.findByRole('table', { name: 'Reservations' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(within(first!).getByText('HT-7K3M9Q2X · Conf. SBR-10293')).toBeInTheDocument();
    expect(within(first!).getByText('Confirmed')).toBeInTheDocument();
    expect(within(first!).getByText('1 × Deluxe Sea View')).toBeInTheDocument();
    expect(within(first!).getByText('₹2,625.00')).toBeInTheDocument();
    expect(within(second!).getByRole('link', { name: 'HT-BBBB2222' })).toBeInTheDocument();
    expect(within(second!).getByText('Checked in')).toBeInTheDocument();
    expect(within(second!).getByText('4 adults, 1 child')).toBeInTheDocument();
    expect(screen.getByText('2 reservations')).toBeInTheDocument();
    expect(operationsApi.reservations).toHaveBeenCalledWith('h1', DEFAULTS, 25);

    await user.click(within(first!).getByRole('link', { name: 'Asha Rao' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations/r1');
  });

  it('filters by status, dates and sort, all kept in the URL', async () => {
    const { user, router } = open();
    await screen.findByText('No reservations yet');

    // Status, room type and dates are behind "Filters"; the sort is always there.
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Held, not paid yet');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Dates by' }), 'Booking date');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2099-03-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2099-03-31' } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Check-in: earliest first');

    await waitFor(() => expect(lastFilters()).toEqual({
      ...DEFAULTS, status: 'HELD', dateField: 'CREATED', from: '2099-03-01', to: '2099-03-31', sort: 'checkIn,asc',
    }));
    expect(currentLocation(router)).toBe(
      '/hotel-manager/hotels/h1/reservations?status=HELD&dateField=CREATED&from=2099-03-01&to=2099-03-31&sort=checkIn%2Casc');
    expect(await screen.findByText('No reservations match')).toBeInTheDocument();
    // The pill of the chosen status follows the select.
    expect(within(screen.getByRole('list', { name: 'Reservations by status' })).getByRole('button', { name: /^Pending payment/ }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the filters by itself when the link already sets one, and presses no pill for a status without one', async () => {
    open('/hotel-manager/hotels/h1/reservations?status=NO_SHOW');

    expect(await screen.findByRole('combobox', { name: 'Status' })).toHaveValue('NO_SHOW');
    expect(screen.getByRole('button', { name: 'Filters, 1 set' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('list', { name: 'Reservations by status' })).getAllByRole('button')
      .filter((pill) => pill.getAttribute('aria-pressed') === 'true')).toEqual([]);
  });

  it('shows the counts per status and filters the list by clicking a pill', async () => {
    const { user, router } = open();

    const cards = await screen.findByRole('list', { name: 'Reservations by status' });
    await waitFor(() => expect(within(cards).getByRole('button', { name: /^Confirmed\s*12$/ })).toBeInTheDocument());
    expect(within(cards).getByRole('button', { name: /^All\s*40$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cards).getByRole('button', { name: /^Pending payment\s*3$/ })).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: /^Checked in\s*5$/ })).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: /^Checked out\s*18$/ })).toBeInTheDocument();
    expect(within(cards).getByRole('button', { name: /^Cancelled\s*4$/ })).toBeInTheDocument();

    await user.click(within(cards).getByRole('button', { name: /^Cancelled/ }));
    await waitFor(() => expect(lastFilters()).toEqual({ ...DEFAULTS, status: 'CANCELLED' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations?status=CANCELLED');
    expect(within(cards).getByRole('button', { name: /^Cancelled/ })).toHaveAttribute('aria-pressed', 'true');
    // The counts follow the other filters, never the status the cards set.
    expect(lastSummaryFilters()).toMatchObject({ from: '', to: '', q: '', roomTypeId: '' });

    await user.click(within(cards).getByRole('button', { name: /^Cancelled/ }));
    await waitFor(() => expect(lastFilters()).toEqual(DEFAULTS));
  });

  it('filters by room type, for the list and for the counts', async () => {
    const { user, router } = open();
    await screen.findByText('No reservations yet');
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    await screen.findByRole('option', { name: 'Garden Room' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Room type' }), 'Garden Room');

    await waitFor(() => expect(lastFilters()).toEqual({ ...DEFAULTS, roomTypeId: 'rt2' }));
    await waitFor(() => expect(lastSummaryFilters()).toMatchObject({ roomTypeId: 'rt2' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations?roomType=rt2');
    expect(await screen.findByText('No reservations match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters, 1 set' })).toBeInTheDocument();
  });

  it('searches by booking reference, confirmation number or guest name', async () => {
    const { user, router } = open();
    await screen.findByText('No reservations yet');

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), ' Asha Rao ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(lastFilters()).toEqual({ ...DEFAULTS, q: 'Asha Rao' }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations?q=Asha+Rao');

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(lastFilters()).toEqual(DEFAULTS));
  });

  it('shows the filters in force as chips that remove them one by one', async () => {
    vi.mocked(operationsApi.reservations).mockResolvedValue(pageOf([reservationRow()]));
    const { user, router } = open('/hotel-manager/hotels/h1/reservations?q=Asha&roomType=rt2&from=2099-03-01');

    await user.click(await screen.findByRole('button', { name: 'Remove filter “Asha”' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations?roomType=rt2&from=2099-03-01'));

    await user.click(await screen.findByRole('button', { name: 'Remove filter Garden Room' }));
    await waitFor(() => expect(lastFilters()).toEqual({ ...DEFAULTS, from: '2099-03-01' }));
    expect(screen.getByRole('button', { name: /^Remove filter Check-in from/ })).toBeInTheDocument();
  });

  it('does not search with a start date after the end date', async () => {
    open('/hotel-manager/hotels/h1/reservations?from=2099-03-20&to=2099-03-10');

    expect(await screen.findByText('The start date must be on or before the end date.')).toBeInTheDocument();
    expect(operationsApi.reservations).not.toHaveBeenCalled();
  });

  it('pages through the results', async () => {
    // The server answers with the page it was asked for.
    vi.mocked(operationsApi.reservations).mockImplementation(async (_hotelId, filters) =>
      ({ ...pageOf([reservationRow()], 3), page: filters.page }));
    const { user, router } = open('/hotel-manager/hotels/h1/reservations?status=CONFIRMED');

    await user.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => expect(lastFilters()).toEqual({ ...DEFAULTS, status: 'CONFIRMED', page: 1 }));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations?status=CONFIRMED&page=1');
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('asks for another page size from the first page, keeping the filters', async () => {
    vi.mocked(operationsApi.reservations).mockImplementation(async (_hotelId, filters, size = 20) => ({
      content: [reservationRow()], page: filters.page, size, totalElements: 120, totalPages: Math.ceil(120 / size),
    }));
    const { user, router } = open('/hotel-manager/hotels/h1/reservations?status=CONFIRMED&page=2');

    expect(await screen.findByText('Page 3 of 5')).toBeInTheDocument();
    const sizes = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(sizes).toHaveValue('25');
    expect(within(sizes).getAllByRole('option').map((option) => option.textContent)).toEqual(['10', '25', '50', '100']);

    await user.selectOptions(sizes, '50');

    await waitFor(() =>
      expect(operationsApi.reservations).toHaveBeenLastCalledWith('h1', { ...DEFAULTS, status: 'CONFIRMED', page: 0 }, 50));
    expect(currentLocation(router)).toBe('/hotel-manager/hotels/h1/reservations?status=CONFIRMED&size=50');
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('shows the support reference when loading fails', async () => {
    vi.mocked(operationsApi.reservations).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side.', [], 'corr-500'));
    open();

    expect(await screen.findByText('Support reference: corr-500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('tells a manager when the hotel is not assigned to them', async () => {
    vi.mocked(operationsApi.reservations).mockRejectedValue(new ApiError(403, 'HOTEL_NOT_ASSIGNED', 'Forbidden', [], 'corr-403'));
    open();

    expect(await screen.findByRole('heading', { name: 'This hotel is not assigned to you' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My hotels' })).toHaveAttribute('href', '/hotel-manager');
  });
});
