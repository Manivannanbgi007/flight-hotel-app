import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { formatDate } from '@/lib/format';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { operationsApi } from './operationsApi';
import { day, reservationDetails } from './opsTestData';
import { ReservationDetailsPage } from './ReservationDetailsPage';

vi.mock('./operationsApi', () => ({
  operationsApi: { reservation: vi.fn(), checkIn: vi.fn(), checkOut: vi.fn(), noShow: vi.fn(), cancel: vi.fn() },
}));

const manager: AuthUser = { ...customer, id: 'm1', email: 'manager@example.com', roles: ['HOTEL_MANAGER'] };

const open = () => renderRoutes([
  { path: '/hotel-manager/hotels/:hotelId/reservations/:reservationId', element: <ReservationDetailsPage /> },
], { path: '/hotel-manager/hotels/h1/reservations/r1', auth: fakeAuth({ user: manager }) });

const actions = () => screen.queryByRole('region', { name: 'Actions' });
const button = (name: string) => screen.queryByRole('button', { name });

/** A confirmed stay that starts `offset` days from today, for two nights. */
const confirmedFrom = (offset: number) => reservationDetails({ status: 'CONFIRMED', checkIn: day(offset), checkOut: day(offset + 2) });

describe('ReservationDetailsPage', () => {
  it('shows the stay, the guests per room, the contact details and special requests', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(reservationDetails({
      guests: [
        { roomNo: 2, firstName: 'Meera', lastName: 'Iyer' },
        { roomNo: 1, firstName: 'Asha', lastName: 'Rao' },
        { roomNo: 1, firstName: 'Ravi', lastName: 'Rao' },
      ],
      rooms: 2,
    }));
    open();

    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('Booking HT-7K3M9Q2X · Confirmation no. SBR-10293')).toBeInTheDocument();
    const guests = screen.getByRole('list', { name: 'Guests per room' });
    const [room1, room2] = within(guests).getAllByRole('listitem');
    expect(room1).toHaveTextContent('Room 1: Asha Rao, Ravi Rao');
    expect(room2).toHaveTextContent('Room 2: Meera Iyer');
    expect(screen.getByRole('link', { name: 'asha@example.com' })).toHaveAttribute('href', 'mailto:asha@example.com');
    expect(screen.getByRole('link', { name: '+919876543210' })).toHaveAttribute('href', 'tel:+919876543210');
    expect(screen.getByText('Late arrival, around 22:00.')).toBeInTheDocument();
    expect(screen.getByText('₹2,625.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Reservations' })).toHaveAttribute('href', '/hotel-manager/hotels/h1/reservations');
  });

  it('offers check-in and a hotel cancellation on the check-in day', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(0));
    open();

    expect(await screen.findByRole('button', { name: 'Check in' })).toBeInTheDocument();
    expect(button('Cancel (hotel)')).toBeInTheDocument();
    expect(button('No-show')).not.toBeInTheDocument();
    expect(button('Check out')).not.toBeInTheDocument();
  });

  it('only offers the hotel cancellation before the check-in day, and says when check-in opens', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(3));
    open();

    expect(await screen.findByRole('button', { name: 'Cancel (hotel)' })).toBeInTheDocument();
    expect(button('Check in')).not.toBeInTheDocument();
    expect(button('No-show')).not.toBeInTheDocument();
    expect(screen.getByText(`Check-in opens on ${formatDate(day(3))}.`)).toBeInTheDocument();
  });

  it('offers check-in and no-show from the day after check-in', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(-1));
    open();

    expect(await screen.findByRole('button', { name: 'Check in' })).toBeInTheDocument();
    expect(button('No-show')).toBeInTheDocument();
    expect(button('Cancel (hotel)')).not.toBeInTheDocument();
  });

  it('offers only check-out to a guest in house', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(reservationDetails({
      status: 'CHECKED_IN', checkIn: day(-1), checkOut: day(0), checkedInAt: '2026-11-04T09:00:00Z',
    }));
    open();

    expect(await screen.findByRole('button', { name: 'Check out' })).toBeInTheDocument();
    expect(button('Check in')).not.toBeInTheDocument();
    expect(button('Cancel (hotel)')).not.toBeInTheDocument();
  });

  it.each(['CHECKED_OUT', 'NO_SHOW', 'CANCELLED', 'EXPIRED'] as const)('offers no actions for a %s reservation', async (status) => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(reservationDetails({ status, checkIn: day(-2), checkOut: day(0) }));
    open();

    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(actions()).not.toBeInTheDocument();
  });

  it('shows who cancelled and the cancellation reference', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(reservationDetails({
      status: 'CANCELLED', cancelledAt: '2099-03-05T10:00:00Z', cancelledBy: 'HOTEL', cancellationReference: 'CX-1234',
      cancellationReason: 'Water damage in the room', confirmedAt: '2099-03-01T10:02:00Z', taxes: 125,
    }));
    open();

    expect(await screen.findByText('By the hotel (guest refunded in full)')).toBeInTheDocument();
    expect(screen.getByText('CX-1234')).toBeInTheDocument();
    expect(screen.getByText('Water damage in the room')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('incl. ₹125.00 GST')).toBeInTheDocument();
  });

  it('shows when a guest was marked as no-show', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(reservationDetails({ status: 'NO_SHOW', noShowAt: '2099-03-11T09:00:00Z' }));
    open();

    expect(await screen.findByText('Marked as no-show')).toBeInTheDocument();
    expect(actions()).not.toBeInTheDocument();
  });

  it('checks a guest in and refreshes the reservation', async () => {
    vi.mocked(operationsApi.reservation)
      .mockResolvedValueOnce(confirmedFrom(0))
      .mockResolvedValue({ ...confirmedFrom(0), status: 'CHECKED_IN', checkedInAt: '2026-11-05T09:00:00Z' });
    vi.mocked(operationsApi.checkIn).mockResolvedValue(undefined);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Check in' }));

    await waitFor(() => expect(operationsApi.checkIn).toHaveBeenCalledWith('h1', 'r1'));
    expect(await screen.findByText('Guest checked in.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Check out' })).toBeInTheDocument();
    expect(operationsApi.reservation).toHaveBeenCalledTimes(2);
  });

  it('shows why check-in was refused (422 NOT_CHECK_IN_DAY) with the support reference', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(0));
    vi.mocked(operationsApi.checkIn).mockRejectedValue(
      new ApiError(422, 'NOT_CHECK_IN_DAY', 'Check-in opens on the arrival day (hotel time).', [], 'corr-422'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Check in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not check in');
    expect(alert).toHaveTextContent('Check-in opens on the arrival day (hotel time).');
    expect(alert).toHaveTextContent('Support reference: corr-422');
  });

  it('reloads the reservation when its state changed meanwhile (409 INVALID_RESERVATION_STATE)', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue({ ...confirmedFrom(-2), checkOut: day(1) });
    vi.mocked(operationsApi.noShow).mockRejectedValue(
      new ApiError(409, 'INVALID_RESERVATION_STATE', 'The guest has already checked in.', [], 'corr-409'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'No-show' }));
    expect(screen.getByRole('heading', { name: 'Mark as no-show?' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Yes, the guest did not arrive' }));

    await waitFor(() => expect(operationsApi.noShow).toHaveBeenCalledWith('h1', 'r1'));
    expect(await screen.findByText('The guest has already checked in.')).toBeInTheDocument();
    await waitFor(() => expect(operationsApi.reservation).toHaveBeenCalledTimes(2));
  });

  it('asks before an early check-out', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(reservationDetails({ status: 'CHECKED_IN', checkIn: day(-1), checkOut: day(2) }));
    vi.mocked(operationsApi.checkOut).mockResolvedValue(undefined);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Check out' }));
    expect(screen.getByRole('heading', { name: 'Check out early?' })).toHaveFocus();
    expect(operationsApi.checkOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Check out now' }));

    await waitFor(() => expect(operationsApi.checkOut).toHaveBeenCalledWith('h1', 'r1'));
    expect(await screen.findByText('Guest checked out. The booking is completed.')).toBeInTheDocument();
  });

  it('cancels for the hotel with a reason, explaining the full refund', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(3));
    vi.mocked(operationsApi.cancel).mockResolvedValue(undefined);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Cancel (hotel)' }));
    const panel = screen.getByRole('region', { name: 'Cancel this stay for the hotel' });
    expect(within(panel).getByRole('heading', { name: 'Cancel this stay for the hotel' })).toHaveFocus();
    expect(panel).toHaveTextContent('The guest gets a full refund of everything they paid, and the rooms go back on sale.');

    await user.type(within(panel).getByLabelText('Reason'), 'Oops');
    expect(within(panel).getByText('4 / 300 characters')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Cancel stay and refund in full' }));
    expect(await within(panel).findByText('Write at least 5 characters')).toBeInTheDocument();
    expect(operationsApi.cancel).not.toHaveBeenCalled();

    await user.type(within(panel).getByLabelText('Reason'), ' – overbooked after a system fault');
    await user.click(within(panel).getByRole('button', { name: 'Cancel stay and refund in full' }));

    await waitFor(() => expect(operationsApi.cancel).toHaveBeenCalledWith('h1', 'r1', 'Oops – overbooked after a system fault'));
    expect(await screen.findByText('Stay cancelled. The guest is refunded in full.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cancel this stay for the hotel' })).not.toBeInTheDocument();
  });

  it('keeps the reservation when the cancellation panel is closed', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(3));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Cancel (hotel)' }));
    await user.click(screen.getByRole('button', { name: 'Keep the reservation' }));

    expect(screen.queryByRole('region', { name: 'Cancel this stay for the hotel' })).not.toBeInTheDocument();
    expect(operationsApi.cancel).not.toHaveBeenCalled();
  });

  it('shows the server\'s answer when the hotel cancellation is refused', async () => {
    vi.mocked(operationsApi.reservation).mockResolvedValue(confirmedFrom(3));
    vi.mocked(operationsApi.cancel).mockRejectedValue(
      new ApiError(409, 'INVALID_RESERVATION_STATE', 'Only confirmed stays can be cancelled before check-in.', [], 'corr-c409'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Cancel (hotel)' }));
    await user.type(screen.getByLabelText('Reason'), 'Hotel closed for repairs');
    await user.click(screen.getByRole('button', { name: 'Cancel stay and refund in full' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The stay was not cancelled');
    expect(alert).toHaveTextContent('Only confirmed stays can be cancelled before check-in.');
    expect(alert).toHaveTextContent('Support reference: corr-c409');
  });

  it('tells a manager when the hotel is not assigned to them', async () => {
    vi.mocked(operationsApi.reservation).mockRejectedValue(new ApiError(403, 'HOTEL_NOT_ASSIGNED', 'Forbidden', [], 'corr-403'));
    open();

    expect(await screen.findByRole('heading', { name: 'This hotel is not assigned to you' })).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-403')).toBeInTheDocument();
  });

  it('says so when the reservation does not exist', async () => {
    vi.mocked(operationsApi.reservation).mockRejectedValue(new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found.'));
    open();

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
