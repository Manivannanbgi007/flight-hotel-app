import { screen, waitFor, within } from '@testing-library/react';
import { Outlet, type RouteObject } from 'react-router';

import { ApiError } from '@/lib/api/apiError';
import { admin, currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { GlobalSearch } from './GlobalSearch';
import { searchApi } from './searchApi';
import { goaSuggestions, group, hotel, result } from './testData';
import type { SuggestResponse } from './types';

vi.mock('./searchApi', () => ({ searchApi: { suggest: vi.fn(), search: vi.fn() } }));

/** The search sits in the layout, as in the app's headers, so it survives the navigation to a result. */
function Layout() {
  return (
    <>
      <GlobalSearch variant="inline" />
      <Outlet />
    </>
  );
}

const pages = (prefix: string): RouteObject[] => [{
  path: prefix || '/',
  element: <Layout />,
  children: [
    { index: true, element: <p>start page</p> },
    { path: 'search', element: <p>results page</p> },
    { path: '*', element: <p>some page</p> },
  ],
}];

const openSearch = (path = '/', auth = fakeAuth()) => {
  const prefix = path.startsWith('/admin') ? '/admin' : '';
  return renderRoutes(pages(prefix), { path, auth });
};

const field = () => screen.getByRole('combobox', { name: 'Search hotels, flights, bookings and more' });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise the test settles itself (to see the loading state). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('GlobalSearch', () => {
  it('sends nothing for a single character and asks for more', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user } = openSearch();

    await user.type(field(), 'g');

    // Said on screen and to screen readers.
    expect(screen.getAllByText('Type at least 2 characters to search.')).toHaveLength(2);
    await pause(400);
    expect(searchApi.suggest).not.toHaveBeenCalled();
  });

  it('waits for a pause in typing: one request for the whole word, with a signal to cancel it', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user } = openSearch();

    await user.type(field(), 'goa beach');

    await screen.findByRole('option', { name: /^Sea Breeze Resort/ });
    expect(searchApi.suggest).toHaveBeenCalledTimes(1);
    expect(searchApi.suggest).toHaveBeenCalledWith('goa beach', expect.any(AbortSignal));
  });

  it('cancels the request for words already typed past', async () => {
    vi.mocked(searchApi.suggest).mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(goaSuggestions());
    const { user } = openSearch();

    await user.type(field(), 'go');
    await waitFor(() => expect(searchApi.suggest).toHaveBeenCalledTimes(1));
    const first = vi.mocked(searchApi.suggest).mock.calls[0]![1]!;
    await user.type(field(), 'a');

    await screen.findByRole('option', { name: /^Sea Breeze Resort/ });
    expect(searchApi.suggest).toHaveBeenLastCalledWith('goa', expect.any(AbortSignal));
    expect(first.aborted).toBe(true);
  });

  it('groups the results under their category and marks the matched words', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user } = openSearch('/', fakeAuth({ user: customer }));

    await user.type(field(), 'goa');

    await screen.findByRole('option', { name: /^Sea Breeze Resort/ });
    const list = screen.getByRole('listbox', { name: 'Search suggestions' });
    expect(within(list).getAllByRole('group')).toHaveLength(3);
    expect(within(list).getByRole('group', { name: 'Hotels' })).toBeInTheDocument();
    expect(within(list).getByRole('group', { name: 'Destinations' })).toBeInTheDocument();
    const trips = within(list).getByRole('group', { name: 'My trips' });
    expect(within(trips).getByRole('option', { name: /HT-7K3M9Q2X/ })).toHaveTextContent('Confirmed');
    // 7 trips match, 1 is shown: "See all" opens the category.
    expect(within(trips).getByRole('option', { name: 'See all 7 My trips' })).toBeInTheDocument();
    expect([...list.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Goa', 'Goa']);
    expect(within(list).getByRole('option', { name: 'View all results for “goa”' })).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', list.id);
    expect(screen.getByRole('status')).toHaveTextContent('3 results. Use the arrow keys to choose one.');
  });

  it('moves through the options with the arrow keys and opens the chosen one with Enter', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch();

    await user.type(field(), 'goa');
    await screen.findByRole('option', { name: /^Sea Breeze Resort/ });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Sea Breeze ResortCalangute, Goa4-star', 'GoaIndia · 24 hotels', 'HT-7K3M9Q2XSea Breeze Resort · 1–3 Dec 2026Confirmed',
      'See all 7 My trips', 'View all results for “goa”',
    ]);

    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', options[2]!.id);
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveAttribute('aria-activedescendant', options[1]!.id);
    expect(options[2]).toHaveAttribute('aria-selected', 'false');
    // Up from the first wraps to "View all".
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(field()).toHaveAttribute('aria-activedescendant', options[4]!.id);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(currentLocation(router)).toBe('/hotels/search?destination=Goa');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('opens the results page of the area with Enter when no option is chosen', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch();

    await user.type(field(), 'goa{Enter}');

    expect(currentLocation(router)).toBe('/search?q=goa');
  });

  it('opens the admin portal results page from the admin portal', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch('/admin', fakeAuth({ user: admin }));

    await user.type(field(), 'goa resort{Enter}');

    expect(currentLocation(router)).toBe('/admin/search?q=goa+resort');
    expect(screen.getByText('results page')).toBeInTheDocument();
  });

  it('opens a category from "See all" and everything from "View all"', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch();

    await user.type(field(), 'goa');
    await user.click(await screen.findByRole('option', { name: 'See all 7 My trips' }));
    expect(currentLocation(router)).toBe('/search?q=goa&category=BOOKINGS');

    await user.type(field(), 'goa');
    await user.click(await screen.findByRole('option', { name: 'View all results for “goa”' }));
    expect(currentLocation(router)).toBe('/search?q=goa');
  });

  it('closes with Escape and opens again with the arrow key', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user } = openSearch();

    await user.type(field(), 'goa');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes when the focus or a click goes elsewhere', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user } = openSearch();

    await user.type(field(), 'goa');
    await screen.findByRole('listbox');
    await user.click(screen.getByText('start page'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(field());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens a result with a click', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch();

    await user.type(field(), 'goa');
    await user.click(await screen.findByRole('option', { name: /HT-7K3M9Q2X/ }));

    expect(currentLocation(router)).toBe('/my-trips/b1');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('never follows a result url that is not an app path, and opens the results page instead', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions({
      groups: [group('PAGES', 'Pages', [
        result({ id: 'PAGES:x', category: 'PAGES', title: 'Elsewhere', url: 'https://evil.example/login' }),
        result({ id: 'PAGES:y', category: 'PAGES', title: 'Other host', url: '//evil.example/login' }),
      ])],
    }));
    const { user, router } = openSearch();

    await user.type(field(), 'goa');
    await user.click(await screen.findByRole('option', { name: 'Elsewhere' }));
    expect(currentLocation(router)).toBe('/search?q=goa');

    await user.type(field(), 'goa');
    await user.click(await screen.findByRole('option', { name: 'Other host' }));
    expect(currentLocation(router)).toBe('/search?q=goa');
  });

  it('shows that it is searching while the answer is on its way', async () => {
    const answer = deferred<SuggestResponse>();
    vi.mocked(searchApi.suggest).mockReturnValue(answer.promise);
    const { user } = openSearch();

    await user.type(field(), 'goa');

    await waitFor(() => expect(searchApi.suggest).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.getByTestId('search-loading')).toBeInTheDocument();
    expect(screen.getByTestId('search-spinner')).toBeInTheDocument();
    // "View all" can be chosen before the suggestions arrive.
    expect(screen.getByRole('option', { name: 'View all results for “goa”' })).toBeInTheDocument();

    answer.resolve(goaSuggestions());
    expect(await screen.findByRole('option', { name: /^Sea Breeze Resort/ })).toBeInTheDocument();
    expect(screen.queryByTestId('search-loading')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, with a hint', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue({ query: 'zzzz', tookMs: 4, groups: [] });
    const { user } = openSearch('/', fakeAuth({ user: customer }));

    await user.type(field(), 'zzzz');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No results for “zzzz”'));
    expect(screen.getAllByText('No results for “zzzz”')).toHaveLength(2);
    expect(screen.getByText(/A booking reference or an e-mail address finds a booking/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it("shows the server's message when search is not available", async () => {
    vi.mocked(searchApi.suggest).mockRejectedValue(
      new ApiError(503, 'SEARCH_UNAVAILABLE', 'Search is not available right now. Try again in a moment.', [], 'corr-9'),
    );
    const { user } = openSearch();

    await user.type(field(), 'goa');

    const message = 'Search is not available right now. Try again in a moment.';
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
    expect(screen.getAllByText(message)).toHaveLength(2);
    // The results page (with its own retry) is still one Enter away.
    expect(screen.getByRole('option', { name: 'View all results for “goa”' })).toBeInTheDocument();
  });

  it('remembers recent searches per user, offers them in the empty field, and can forget them', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch('/', fakeAuth({ user: customer }));

    await user.type(field(), 'goa{Enter}');
    await user.type(field(), 'chennai{Enter}');
    expect(JSON.parse(window.localStorage.getItem(`fh.search.recent.${customer.id}`) ?? '[]')).toEqual(['chennai', 'goa']);
    expect(window.localStorage.getItem('fh.search.recent.anon')).toBeNull();

    await user.click(field());
    const list = screen.getByRole('listbox', { name: 'Recent searches' });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['chennai', 'goa', 'Clear recent searches']);
    await user.click(within(list).getByRole('option', { name: 'goa' }));
    expect(currentLocation(router)).toBe('/search?q=goa');
    expect(JSON.parse(window.localStorage.getItem(`fh.search.recent.${customer.id}`) ?? '[]')).toEqual(['goa', 'chennai']);

    await user.click(field());
    await user.click(screen.getByRole('option', { name: 'Clear recent searches' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`fh.search.recent.${customer.id}`)).toBeNull();
  });

  it('keeps working when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions());
    const { user, router } = openSearch();

    await user.type(field(), 'goa{Enter}');

    expect(currentLocation(router)).toBe('/search?q=goa');
  });

  it('jumps into the field with Ctrl+K, ⌘+K and "/"', async () => {
    const { user } = openSearch();

    await user.keyboard('{Control>}k{/Control}');
    expect(field()).toHaveFocus();
    field().blur();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(field()).toHaveFocus();
    field().blur();
    await user.keyboard('/');
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue('');
  });

  it('leaves "/" alone while another field has the focus', async () => {
    const { user } = renderRoutes([{
      path: '/',
      element: <><GlobalSearch variant="inline" /><label>Notes<input /></label></>,
    }]);

    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'a/b');

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('a/b');
    expect(field()).not.toHaveFocus();
  });

  it('opens under the header from the search button on small screens', async () => {
    vi.mocked(searchApi.suggest).mockResolvedValue(goaSuggestions({ groups: [group('HOTELS', 'Hotels', [hotel])] }));
    const { user } = renderRoutes([{ path: '/', element: <GlobalSearch variant="staff" /> }], { auth: fakeAuth({ user: admin }) });

    const toggle = screen.getByRole('button', { name: 'Open search' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Close search' })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(field()).toHaveFocus());
    // Escape closes the dropdown, then the bar (the focus goes back to the button).
    await user.keyboard('{Escape}{Escape}');
    expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus();
  });
});
