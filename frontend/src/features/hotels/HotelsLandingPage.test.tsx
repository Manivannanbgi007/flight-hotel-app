import { screen, waitFor, within } from '@testing-library/react';

import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { hotelApi } from './hotelApi';
import { HotelsLandingPage } from './HotelsLandingPage';
import { defaultStay } from './searchParams';

vi.mock('./hotelApi', () => ({ hotelApi: { destinations: vi.fn() } }));

const open = () => renderRoutes([
  { path: '/hotels', element: <HotelsLandingPage /> },
  { path: '/hotels/search', element: <p>search results</p> },
], { path: '/hotels' });

/** The search URL for a destination with the default stay (a week from today, two nights, two adults). */
const searchUrl = (destination: string) => {
  const stay = defaultStay();
  return `/hotels/search?destination=${destination}&checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&rooms=1&adults=2`;
};

afterEach(() => localStorage.clear());

describe('HotelsLandingPage', () => {
  it('lists the destinations that have hotels and searches one with the default stay', async () => {
    vi.mocked(hotelApi.destinations).mockResolvedValue([
      { city: 'Goa', countryCode: 'IN', hotels: 3 },
      { city: 'Shimla', countryCode: 'IN', hotels: 1 },
    ]);
    const { user, router } = open();

    expect(screen.getByRole('heading', { level: 1, name: 'Find a hotel' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Shimla\s*1 hotel$/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Goa\s*3 hotels$/ }));

    expect(await screen.findByText('search results')).toBeInTheDocument();
    expect(currentLocation(router)).toBe(searchUrl('Goa'));
    expect(hotelApi.destinations).toHaveBeenCalledWith('');
  });

  it('explains what booking here offers, in words and without figures', async () => {
    vi.mocked(hotelApi.destinations).mockResolvedValue([]);
    open();

    const promises = screen.getByRole('list', { name: 'Why book hotels with us' });
    expect(within(promises).getAllByRole('listitem')).toHaveLength(3);
    for (const title of ['Taxes included', 'Free cancellation filter', 'Live availability']) {
      expect(within(promises).getByText(title)).toBeInTheDocument();
    }
    expect(promises.textContent).not.toMatch(/[0-9]/);
    expect(screen.getByRole('search', { name: 'Search hotels' })).toBeInTheDocument();
  });

  it('searches what the visitor types', async () => {
    vi.mocked(hotelApi.destinations).mockResolvedValue([]);
    const { user, router } = open();

    await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Kochi');
    await user.click(screen.getByRole('button', { name: 'Search hotels' }));

    await waitFor(() => expect(currentLocation(router)).toBe(searchUrl('Kochi')));
    expect(screen.queryByRole('heading', { name: 'Destinations' })).not.toBeInTheDocument();
  });
});
