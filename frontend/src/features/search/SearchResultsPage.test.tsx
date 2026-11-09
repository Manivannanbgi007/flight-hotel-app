import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { admin, currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { searchApi } from './searchApi';
import { SearchResultsPage } from './SearchResultsPage';
import { allResults, categoryResults, counts, destination, hotel, result, trip } from './testData';
import type { SearchRequest } from './types';

vi.mock('./searchApi', () => ({ searchApi: { suggest: vi.fn(), search: vi.fn() } }));

const openPage = (path: string, auth = fakeAuth({ user: customer })) => renderRoutes([
  { path: '/search', element: <SearchResultsPage /> },
  { path: '/admin/search', element: <SearchResultsPage /> },
  { path: '*', element: <p>another page</p> },
], { path, auth });

/** "All" for any words, a page of trips for the BOOKINGS category. */
function answerLikeTheServer() {
  vi.mocked(searchApi.search).mockImplementation(async ({ category, page = 0, size = 10 }: SearchRequest) => {
    if (category === 'BOOKINGS') {
      const trips = Array.from({ length: Math.max(0, Math.min(size, 27 - page * size)) }, (_, index) =>
        result({ ...trip, id: `BOOKINGS:b${page * size + index + 1}`, title: `HT-TRIP${page * size + index + 1}` }));
      return categoryResults('BOOKINGS', trips, { page, size, totalElements: 27, totalPages: Math.ceil(27 / size) });
    }
    return allResults();
  });
}

const lastRequest = () => vi.mocked(searchApi.search).mock.lastCall?.[0];

describe('SearchResultsPage', () => {
  it('shows the best results of every category, the count and time, and the category tabs with their counts', async () => {
    answerLikeTheServer();
    openPage('/search?q=goa');

    expect(screen.getByRole('heading', { level: 1, name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('goa');
    await screen.findByRole('heading', { level: 2, name: /Hotels/ });
    expect(searchApi.search).toHaveBeenCalledWith({ q: 'goa', category: 'ALL', page: 0, size: 10 }, expect.any(AbortSignal));
    expect(screen.getByText(/results \(0\.03 s\)/).closest('p')).toHaveTextContent('11 results (0.03 s)');

    // Only the categories the server returned, each with its count; "All" is their sum.
    const tabs = screen.getByRole('navigation', { name: 'Result categories' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'All11 results', 'Pages0 results', 'Hotels3 results', 'Destinations1 results', 'My trips7 results',
    ]);
    expect(within(tabs).getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).queryByRole('link', { name: /Users/ })).not.toBeInTheDocument();

    // One section per category with matches, in the server's order.
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Hotels3 results', 'Destinations1 results', 'My trips7 results',
    ]);
    const hotels = screen.getByRole('region', { name: /Hotels/ });
    expect(within(hotels).getByRole('link', { name: 'Sea Breeze Resort' })).toHaveAttribute('href', '/hotels/sea-breeze-resort');
    expect([...hotels.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Goa', 'Goa']);
    expect(within(hotels).getByText('4-star')).toBeInTheDocument();
    expect(within(hotels).getByText('From').nextSibling).toHaveTextContent('₹6,300.00');
    // A destination's extra links.
    const destinations = screen.getByRole('region', { name: /Destinations/ });
    expect(within(destinations).getByRole('link', { name: 'Flights to Goa' })).toHaveAttribute('href', '/flights/search?destination=GOI');
    expect(within(destinations).getByRole('link', { name: 'Hotels in Goa' })).toHaveAttribute('href', '/hotels/search?destination=Goa');
    // "See all" only where more matched than is shown.
    expect(within(destinations).queryByRole('link', { name: /See all/ })).not.toBeInTheDocument();
    expect(within(hotels).getByRole('link', { name: 'See all 3 Hotels' })).toHaveAttribute('href', '/search?q=goa&category=HOTELS');
  });

  it('"See all" switches to that category, with its results page by page', async () => {
    answerLikeTheServer();
    const { user, router } = openPage('/search?q=goa');

    await user.click(await screen.findByRole('link', { name: 'See all 7 My trips' }));

    expect(currentLocation(router)).toBe('/search?q=goa&category=BOOKINGS');
    expect(await screen.findByRole('link', { name: 'HT-TRIP1' })).toHaveAttribute('href', '/my-trips/b1');
    expect(lastRequest()).toEqual({ q: 'goa', category: 'BOOKINGS', page: 0, size: 10 });
    const tabs = screen.getByRole('navigation', { name: 'Result categories' });
    expect(within(tabs).getByRole('link', { name: /^My trips/ })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: /^All/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText(/results \(0\.02 s\)/).closest('p')).toHaveTextContent('27 results (0.02 s)');
  });

  it('pages through a category: the page and the page size are in the URL and the request', async () => {
    answerLikeTheServer();
    const { user, router } = openPage('/search?q=goa&category=BOOKINGS');

    await screen.findByRole('link', { name: 'HT-TRIP1' });
    expect(screen.getAllByRole('article')).toHaveLength(10);
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    await user.click(within(pages).getByRole('button', { name: 'Page 2' }));

    expect(currentLocation(router)).toBe('/search?q=goa&category=BOOKINGS&page=1');
    await waitFor(() => expect(lastRequest()).toEqual({ q: 'goa', category: 'BOOKINGS', page: 1, size: 10 }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Per page' }), '25');
    expect(currentLocation(router)).toBe('/search?q=goa&category=BOOKINGS&size=25');
    await waitFor(() => expect(lastRequest()).toEqual({ q: 'goa', category: 'BOOKINGS', page: 0, size: 25 }));
    // Only the sizes the API accepts.
    expect(within(screen.getByRole('combobox', { name: 'Per page' })).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['10', '25', '50']);
  });

  it('searches again from its own field', async () => {
    answerLikeTheServer();
    const { user, router } = openPage('/search?q=goa&category=BOOKINGS&page=2');

    const box = screen.getByRole('searchbox', { name: 'Search' });
    await user.clear(box);
    await user.type(box, 'chennai{Enter}');

    expect(currentLocation(router)).toBe('/search?q=chennai&category=BOOKINGS');
    await waitFor(() => expect(lastRequest()).toEqual({ q: 'chennai', category: 'BOOKINGS', page: 0, size: 10 }));
  });

  it('shows what the words were understood as', async () => {
    vi.mocked(searchApi.search).mockResolvedValue({
      ...categoryResults('BOOKINGS', [trip], { totalElements: 1 }),
      interpretation: 'Cancelled bookings',
    });
    openPage('/search?q=cancelled%20bookings&category=BOOKINGS');

    expect(await screen.findByText('Cancelled bookings')).toHaveTextContent('Understood as: Cancelled bookings');
    expect(screen.getByText(/result \(0\.02 s\)/).closest('p')).toHaveTextContent('1 result (0.02 s)');
  });

  it('says so when nothing matches, with tips', async () => {
    vi.mocked(searchApi.search).mockResolvedValue(allResults({
      total: 0, groups: [], categories: counts.map((count) => ({ ...count, total: 0 })),
    }));
    openPage('/search?q=zzzz');

    expect(await screen.findByRole('heading', { name: 'No results for “zzzz”' })).toBeInTheDocument();
    expect(screen.getByText('Check the spelling.')).toBeInTheDocument();
    expect(screen.getByText('Use fewer or more general words.')).toBeInTheDocument();
    expect(screen.getByText(/Try a booking reference/)).toBeInTheDocument();
  });

  it('offers "All" when only the chosen category has nothing', async () => {
    vi.mocked(searchApi.search).mockResolvedValue({ ...categoryResults('BOOKINGS', [], { totalElements: 0 }), total: 0 });
    openPage('/search?q=goa&category=BOOKINGS');

    expect(await screen.findByRole('heading', { name: 'No results in My trips for “goa”' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all results' })).toHaveAttribute('href', '/search?q=goa');
  });

  it('shows the error with a retry', async () => {
    vi.mocked(searchApi.search)
      .mockRejectedValueOnce(new ApiError(503, 'SEARCH_UNAVAILABLE', 'Search is not available right now. Try again in a moment.', [], 'corr-1'))
      .mockResolvedValue(allResults());
    const { user } = openPage('/search?q=goa');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The search could not be completed');
    expect(alert).toHaveTextContent('Search is not available right now. Try again in a moment.');
    expect(alert).toHaveTextContent('Support reference: corr-1');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { level: 2, name: /Hotels/ })).toBeInTheDocument();
    expect(searchApi.search).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['/search', 'What are you looking for?'],
    ['/search?q=g', 'Type a little more'],
    ['/search?q=%20%20g%20', 'Type a little more'],
  ])('asks for at least 2 characters at %s and sends nothing', async (path, title) => {
    openPage(path);

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(searchApi.search).not.toHaveBeenCalled();
  });

  it('does not link a result whose url is not an app path', async () => {
    vi.mocked(searchApi.search).mockResolvedValue(categoryResults('PAGES', [
      result({ id: 'PAGES:x', category: 'PAGES', title: 'Elsewhere', url: 'javascript:alert(1)',
        actions: [{ label: 'Bad', url: 'https://evil.example' }, { label: 'Help centre', url: '/help' }] }),
    ]));
    openPage('/search?q=goa&category=PAGES');

    expect(await screen.findByRole('heading', { level: 3, name: 'Elsewhere' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Elsewhere' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help centre' })).toHaveAttribute('href', '/help');
  });

  it('keeps its own portal path in the staff shells', async () => {
    answerLikeTheServer();
    openPage('/admin/search?q=goa', fakeAuth({ user: admin }));

    expect(screen.getByText('Admin portal')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'See all 7 My trips' })).toHaveAttribute('href', '/admin/search?q=goa&category=BOOKINGS');
    expect(screen.getByRole('link', { name: /^Destinations/ })).toHaveAttribute('href', '/admin/search?q=goa&category=DESTINATIONS');
    expect(screen.getByRole('link', { name: 'Goa' })).toHaveAttribute('href', destination.url);
    expect(screen.getByRole('link', { name: 'Sea Breeze Resort' })).toHaveAttribute('href', hotel.url);
  });
});
