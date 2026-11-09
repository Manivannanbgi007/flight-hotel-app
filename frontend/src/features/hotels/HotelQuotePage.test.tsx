import { screen, waitFor, within } from '@testing-library/react';

import { futureIso, quoteFixture } from '@/features/bookings/testData';
import { ApiError } from '@/lib/api/apiError';
import { formatShortDate } from '@/lib/format';
import { renderRoutes } from '@/test/renderRoutes';
import { hotelApi } from './hotelApi';
import { HotelQuotePage } from './HotelQuotePage';
import type { HotelDetails } from './types';

// The cover photo comes from the hotel's details; without one the page draws a gradient instead.
vi.mock('./hotelApi', () => ({ hotelApi: { getQuote: vi.fn(), details: vi.fn(() => Promise.reject(new Error('no photo'))) } }));

const open = () => renderRoutes([{ path: '/hotels/quote/:quoteId', element: <HotelQuotePage /> }], { path: '/hotels/quote/quote-1' });

/** The "Price details" section. */
const priceCard = () => screen.getByRole('heading', { name: 'Price details' }).parentElement as HTMLElement;
/** A fact of the stay ("Check-in", "Room", ...): the group of its term and value(s). */
const fact = (term: string) => screen.getByText(term, { selector: 'dt' }).closest('dl > div') as HTMLElement;

describe('HotelQuotePage', () => {
  it('shows the stay, the cancellation terms and every night of the price', async () => {
    vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture());
    open();

    expect(await screen.findByRole('heading', { level: 1, name: 'Review your stay' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sea Breeze Resort' })).toBeInTheDocument();
    expect(screen.getByText('Demo listing')).toBeInTheDocument();
    expect(screen.getByText('Calangute Beach Road, Goa')).toBeInTheDocument();
    expect(fact('Check-in')).toHaveTextContent(`Check-in${formatShortDate('2099-03-10')}from 14:00`);
    expect(fact('Check-out')).toHaveTextContent(`Check-out${formatShortDate('2099-03-12')}until 11:00`);
    expect(fact('Length of stay')).toHaveTextContent('2 nights');
    expect(fact('Room')).toHaveTextContent('Deluxe Sea View');
    expect(fact('Rate')).toHaveTextContent('Flexible with breakfast');
    expect(fact('Guests')).toHaveTextContent('2 adults · 1 room');
    expect(screen.getByRole('heading', { name: 'Free cancellation' })).toBeInTheDocument();
    expect(screen.getByText('Free cancellation until 2 days before check-in.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'What happens next' })).getAllByRole('listitem').map((step) => step.textContent))
      .toEqual(['1Guest detailsWho is staying and how to reach you', '2ReviewCheck everything once more', '3PaymentPay securely to confirm']);

    const price = within(priceCard());
    expect(price.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      `${formatShortDate('2099-03-10')}₹1,250.00`,
      `${formatShortDate('2099-03-11')}₹1,250.00`,
    ]);
    expect(price.getByText('Subtotal').nextSibling).toHaveTextContent('₹2,500.00');
    expect(price.getByText('GST 5%').nextSibling).toHaveTextContent('₹125.00');
    expect(price.getByText('Total').nextSibling).toHaveTextContent('₹2,625.00');
    expect(hotelApi.getQuote).toHaveBeenCalledWith('quote-1');
  });

  it('shows the hotel photo at the top when the hotel has one', async () => {
    vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture());
    vi.mocked(hotelApi.details).mockResolvedValue({
      images: [{ id: 'i1', url: '/media/sea-breeze.jpg', thumbUrl: '/media/sea-breeze-t.jpg', caption: null, roomTypeId: null, width: 1600, height: 900 }],
    } as unknown as HotelDetails);
    const { container } = open();

    await screen.findByRole('heading', { name: 'Sea Breeze Resort' });
    // Decorative (the hotel's name is the heading beside it): an empty alt, the small version of the photo.
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', '/media/sea-breeze-t.jpg'));
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(hotelApi.details).toHaveBeenCalledWith('sea-breeze-resort-goa');
  });

  it('holds the price for a while and continues to guest details', async () => {
    vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture({ expiresAt: futureIso(10) }));
    open();

    expect(await screen.findByText(/^Price held for (9|10):\d\d/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to guest details' })).toHaveAttribute('href', '/book/hotel/quote-1');
    expect(screen.getByRole('link', { name: 'Change room or dates' })).toHaveAttribute('href',
      '/hotels/sea-breeze-resort-goa?checkIn=2099-03-10&checkOut=2099-03-12&rooms=1&adults=2#rooms');
  });

  it('prices every room and keeps the children in the link back to the hotel', async () => {
    vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture({
      rooms: 2, adults: 3, children: 1, childAges: [6], demo: false, nights: 1,
      nightlyPrices: [{ date: '2099-03-10', price: 1250, season: 'Holi' }],
    }));
    open();

    expect(await screen.findByText('3 adults, 1 child · 2 rooms')).toBeInTheDocument();
    expect(fact('Length of stay')).toHaveTextContent('1 night');
    expect(screen.queryByText('Demo listing')).not.toBeInTheDocument();
    expect(within(priceCard()).getByRole('listitem')).toHaveTextContent(`${formatShortDate('2099-03-10')} · Holi × 2₹2,500.00`);
    expect(screen.getByRole('link', { name: 'Change room or dates' })).toHaveAttribute('href',
      '/hotels/sea-breeze-resort-goa?checkIn=2099-03-10&checkOut=2099-03-12&rooms=2&adults=3&children=1&childAges=6#rooms');
  });

  it('stops the booking once the held price has expired', async () => {
    vi.mocked(hotelApi.getQuote).mockResolvedValue(quoteFixture({ expiresAt: futureIso(-1) }));
    open();

    expect(await screen.findByText('This price has expired.')).toBeInTheDocument();
    expect(screen.getByText('Check availability again to book.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue to guest details' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check availability again' })).toHaveAttribute('href', expect.stringMatching(/#rooms$/));
  });

  it('explains an unknown or expired quote and links back to the search', async () => {
    vi.mocked(hotelApi.getQuote).mockRejectedValue(new ApiError(404, 'QUOTE_NOT_FOUND', 'Not found.'));
    open();

    const error = await screen.findByRole('alert');
    expect(within(error).getByRole('heading', { name: 'This price has expired' })).toBeInTheDocument();
    expect(error).toHaveTextContent('Prices are held for 15 minutes. Please check availability again.');
    expect(within(error).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search hotels' })).toHaveAttribute('href', '/hotels');
  });

  it('offers a retry for other failures', async () => {
    vi.mocked(hotelApi.getQuote)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hotel service is not reachable.'))
      .mockResolvedValueOnce(quoteFixture());
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Hotel service is not reachable.');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Review your stay' })).toBeInTheDocument();
  });
});
