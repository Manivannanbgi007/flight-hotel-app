import { screen, waitFor, within } from '@testing-library/react';
import { addDays, format } from 'date-fns';

import { ApiError } from '@/lib/api/apiError';
import { currentLocation, renderRoutes } from '@/test/renderRoutes';
import { flightApi } from './flightApi';
import { FlightSearchForm } from './FlightSearchForm';
import { FlightSearchPage } from './FlightSearchPage';
import { FlightsLandingPage } from './FlightsLandingPage';
import { defaultFlightSearch, type FlightSearch } from './searchParams';
import { BOM, DEL, DXB, facetsFixture, optionFixture, searchFixture, tripFixture } from './testData';

vi.mock('./flightApi', () => ({
  flightApi: { searchAirports: vi.fn(), airlines: vi.fn(), popularRoutes: vi.fn(), search: vi.fn(), revalidate: vi.fn(), getTrip: vi.fn() },
}));

// The API accepts dates up to 330 days ahead, so the tests use dates relative to today.
const DEPART = format(addDays(new Date(), 30), 'yyyy-MM-dd');
const RETURN = format(addDays(new Date(), 34), 'yyyy-MM-dd');

beforeEach(() => {
  vi.mocked(flightApi.searchAirports).mockImplementation(async (query) =>
    [DEL, BOM, DXB].filter((a) => `${a.city} ${a.iataCode} ${a.name}`.toLowerCase().includes(query.toLowerCase())));
  vi.mocked(flightApi.popularRoutes).mockResolvedValue([]);
});

describe('FlightSearchForm', () => {
  const open = (onSearch: (search: FlightSearch) => void = vi.fn(), search = defaultFlightSearch()) =>
    renderRoutes(<FlightSearchForm search={search} onSearch={onSearch} />);

  it('suggests airports while typing and shows the chosen one as "City (CODE)"', async () => {
    const { user } = open();

    await user.type(screen.getByRole('combobox', { name: 'From' }), 'del');
    await user.click(await screen.findByRole('option', { name: /Delhi \(DEL\)/ }));

    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('Delhi (DEL)');
    expect(flightApi.searchAirports).toHaveBeenCalledWith('del');
  });

  it('only searches with airports chosen from the list and tells what is missing', async () => {
    const onSearch = vi.fn();
    const { user } = open(onSearch);

    await user.type(screen.getByRole('combobox', { name: 'From' }), 'Delhi');
    await user.click(screen.getByRole('button', { name: 'Search flights' }));
    expect(await screen.findByText('Choose where you fly from')).toBeInTheDocument();

    await user.clear(screen.getByRole('combobox', { name: 'From' }));
    await user.type(screen.getByRole('combobox', { name: 'From' }), 'del');
    await user.click(await screen.findByRole('option', { name: /Delhi/ }));
    await user.click(screen.getByRole('button', { name: 'Search flights' }));
    expect(await screen.findByText('Choose where you fly to')).toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('refuses the same airport twice', async () => {
    const onSearch = vi.fn();
    const { user } = open(onSearch, { ...defaultFlightSearch(), origin: 'DEL', destination: 'DEL' });

    await user.click(screen.getByRole('button', { name: 'Search flights' }));

    expect(await screen.findByText('The two airports must be different')).toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('searches one way by default and round trip when asked', async () => {
    const onSearch = vi.fn();
    const { user } = open(onSearch, { ...defaultFlightSearch(), origin: 'DEL', destination: 'BOM', departureDate: DEPART });

    expect(screen.getByLabelText('Return')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Search flights' }));
    expect(onSearch).toHaveBeenLastCalledWith(expect.objectContaining({ origin: 'DEL', destination: 'BOM', departureDate: DEPART, returnDate: '' }));

    await user.click(screen.getByRole('radio', { name: 'Round trip' }));
    expect(screen.getByLabelText('Return')).toBeEnabled();
    await user.clear(screen.getByLabelText('Return'));
    await user.type(screen.getByLabelText('Return'), RETURN);
    await user.click(screen.getByRole('button', { name: 'Search flights' }));
    expect(onSearch).toHaveBeenLastCalledWith(expect.objectContaining({ returnDate: RETURN }));
  });

  it('keeps the travellers within the limits (infants need an adult, nine seats at most)', async () => {
    const onSearch = vi.fn();
    const { user } = open(onSearch, { ...defaultFlightSearch(), origin: 'DEL', destination: 'BOM', departureDate: DEPART });

    const infants = screen.getByLabelText('Infants (under 2)');
    expect(within(infants).getAllByRole('option').map((o) => o.textContent)).toEqual(['0', '1']);
    await user.selectOptions(screen.getByLabelText('Adults (12+)'), '9');
    expect(within(screen.getByLabelText('Children (2–11)')).getAllByRole('option')).toHaveLength(1);
    expect(within(screen.getByLabelText('Infants (under 2)')).getAllByRole('option')).toHaveLength(10);
    await user.selectOptions(screen.getByLabelText('Travel class'), 'BUSINESS');
    await user.click(screen.getByRole('button', { name: 'Search flights' }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ adults: 9, children: 0, cabin: 'BUSINESS' }));
  });

  it('swaps the two airports', async () => {
    const { user } = open(vi.fn(), { ...defaultFlightSearch(), origin: 'DEL', destination: 'BOM' });

    await user.click(screen.getByRole('button', { name: 'Swap airports' }));

    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('BOM');
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('DEL');
  });
});

describe('FlightsLandingPage', () => {
  it('starts a search from the form and from a popular route', async () => {
    vi.mocked(flightApi.popularRoutes).mockResolvedValue([{ origin: DEL, destination: BOM, fromPrice: 3999, currency: 'INR' }]);
    const { user, router } = renderRoutes([
      { path: '/flights', element: <FlightsLandingPage /> },
      { path: '/flights/search', element: <p>results page</p> },
    ], { path: '/flights' });

    const route = await screen.findByRole('button', { name: /Delhi to Mumbai/ });
    expect(screen.getByText('from ₹3,999')).toBeInTheDocument();
    await user.click(route);

    await waitFor(() => expect(currentLocation(router)).toMatch(/^\/flights\/search\?origin=DEL&destination=BOM&departureDate=\d{4}-\d{2}-\d{2}&adults=1$/));
  });
});

describe('FlightSearchPage', () => {
  const URL = `/flights/search?origin=DEL&destination=BOM&departureDate=${DEPART}`;
  const routes = [
    { path: '/flights/search', element: <FlightSearchPage /> },
    { path: '/flights/trip/:id', element: <p>trip page</p> },
  ];
  const open = (url = URL) => renderRoutes(routes, { path: url });
  const roundTrip = () => searchFixture({
    tripType: 'ROUND_TRIP',
    inbound: { origin: BOM, destination: DEL, date: '2099-03-14', totalOptions: 1, options: [
      optionFixture({ offerId: 'back-1', airline: { code: 'UK', name: 'Vistara' }, flightNumber: 'UK 971', origin: BOM, destination: DEL, departureLocal: '2099-03-14T18:00', arrivalLocal: '2099-03-14T20:10', totalPrice: 6100 }),
    ] },
    inboundFacets: facetsFixture({ airlines: [{ code: 'UK', name: 'Vistara', count: 1, minPrice: 6100 }] }),
  });

  beforeEach(() => {
    vi.mocked(flightApi.search).mockResolvedValue(searchFixture());
    vi.mocked(flightApi.revalidate).mockResolvedValue(tripFixture());
  });

  it('shows every flight with times, stops, baggage, fare rules, seats and the demo label', async () => {
    open();

    expect(await screen.findByRole('heading', { name: 'Delhi to Mumbai', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/3 flights/)).toBeInTheDocument();
    const searched = screen.getByRole('list', { name: 'Your search' });
    expect(within(searched).getByText('1 adult')).toBeInTheDocument();
    expect(within(searched).getByText('Economy')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Flights' });
    expect(within(list).getAllByText('Demo inventory')).toHaveLength(3);
    expect(within(list).getByText('06:45')).toBeInTheDocument();
    expect(within(list).getByText('2h 10m')).toBeInTheDocument();
    expect(within(list).getByText('1 stop via HYD')).toBeInTheDocument();
    expect(within(list).getByText('+1 day')).toBeInTheDocument();
    expect(within(list).getAllByText('Check-in 15 kg · Cabin 7 kg').length).toBeGreaterThan(0);
    expect(within(list).getByText('Refundable: a 25% fee applies up to departure.')).toBeInTheDocument();
    expect(within(list).getAllByText('Only 4 seats left')).toHaveLength(2);
    expect(within(list).getByText('₹4,800')).toBeInTheDocument();
    expect(flightApi.search).toHaveBeenCalledWith(`origin=DEL&destination=BOM&departureDate=${DEPART}&adults=1`);
  });

  it('asks for the missing part of an incomplete search instead of calling the API', async () => {
    open(`/flights/search?destination=BOM&departureDate=${DEPART}`);

    expect(await screen.findByText('Choose where you fly from')).toBeInTheDocument();
    expect(flightApi.search).not.toHaveBeenCalled();
  });

  it('puts every filter and the sorting into the URL and into the API call', async () => {
    const { user, router } = open();
    await screen.findByRole('list', { name: 'Flights' });

    await user.click(screen.getByRole('radio', { name: /Non-stop only/ }));
    await waitFor(() => expect(currentLocation(router)).toContain('maxStops=0'));
    await user.click(screen.getByRole('radio', { name: /^Refundable/ }));
    await user.click(screen.getByRole('checkbox', { name: /^IndiGo 1 flight/ }));
    await user.click(within(screen.getByRole('group', { name: 'Departure time' })).getByRole('button', { name: 'Morning 06:00–12:00' }));
    await user.selectOptions(screen.getByLabelText('Longest journey'), String(5 * 60));
    await user.type(screen.getByLabelText('Maximum price'), '9000');
    await user.click(screen.getByRole('button', { name: 'Apply price' }));
    await user.click(within(screen.getByRole('group', { name: 'Sort by' })).getByRole('radio', { name: 'Shortest journey' }));

    await waitFor(() => expect(currentLocation(router)).toContain('sort=DURATION_ASC'));
    const location = currentLocation(router);
    for (const part of ['maxStops=0', 'refundable=true', 'airlines=6E', 'departAfter=06%3A00', 'departBefore=12%3A00', 'maxDurationMinutes=300', 'maxPrice=9000']) {
      expect(location).toContain(part);
    }
    expect(vi.mocked(flightApi.search).mock.calls.at(-1)?.[0]).toContain('airlines=6E');
    expect(vi.mocked(flightApi.search).mock.calls.at(-1)?.[0]).toContain('sort=DURATION_ASC');
  });

  it('clears all filters at once', async () => {
    const { user, router } = open(`${URL}&maxStops=0&airlines=AI`);
    await screen.findByRole('list', { name: 'Flights' });
    expect(screen.getByRole('heading', { name: 'Filters 2 active' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    await waitFor(() => expect(currentLocation(router)).not.toContain('maxStops'));
    expect(currentLocation(router)).not.toContain('airlines');
  });

  it('says how many flights match the filters of all', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(searchFixture({ outbound: { ...searchFixture().outbound, options: [optionFixture()] } }));
    open(`${URL}&maxStops=0`);

    expect(await screen.findByText(/1 of 3 flights/)).toBeInTheDocument();
  });

  it('has a friendly empty result', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(searchFixture({ outbound: { ...searchFixture().outbound, options: [], totalOptions: 3 } }));
    open();

    expect(await screen.findByText('No flights match')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers to clear the filters when they leave no flight', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(searchFixture({ outbound: { ...searchFixture().outbound, options: [], totalOptions: 3 } }));
    const { user, router } = open(`${URL}&maxStops=0&sort=DURATION_ASC`);

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(currentLocation(router)).not.toContain('maxStops'));
    expect(currentLocation(router)).toContain('sort=DURATION_ASC');
  });

  it('folds the search form behind "Modify search" and, on small screens, the filters behind a button', async () => {
    const { user } = open();
    await screen.findByRole('list', { name: 'Flights' });

    const modify = screen.getByRole('button', { name: 'Modify search' });
    expect(modify).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(modify.getAttribute('aria-controls') ?? '')).toContainElement(screen.getByRole('search', { name: 'Search flights' }));
    await user.click(modify);
    expect(modify).toHaveAttribute('aria-expanded', 'true');

    const filters = screen.getByRole('button', { name: 'Filters' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(filters.getAttribute('aria-controls') ?? '')).toBe(screen.getByRole('complementary', { name: 'Filters' }));
    await user.click(filters);
    expect(filters).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Show flights' }));
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    expect(filters).toHaveFocus();
  });

  it('keeps the compare tray clear of the bottom-right corner', async () => {
    const { user } = open();
    await screen.findByRole('list', { name: 'Flights' });

    await user.click(screen.getByRole('checkbox', { name: 'Compare Air India AI 504' }));
    await user.click(screen.getByRole('checkbox', { name: 'Compare IndiGo 6E 211' }));

    const tray = screen.getByRole('button', { name: 'Compare flights' }).closest('.fixed');
    expect(tray).toHaveClass('left-4', 'right-20');
    expect(tray).not.toHaveClass('right-0');
  });

  it('re-prices the chosen flight and opens the details', async () => {
    const { user, router } = open();

    await user.click(await screen.findByRole('button', { name: 'Select IndiGo 6E 211' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/flights/trip/trip-1'));
    expect(flightApi.revalidate).toHaveBeenCalledWith(['offer-2']);
  });

  it('asks for the outbound flight first and then the return flight, with the right filters for each', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(roundTrip());
    const { user, router } = open(`${URL}&returnDate=${RETURN}`);

    expect(await screen.findByRole('heading', { name: 'Choose your outbound flight: Delhi to Mumbai' })).toBeInTheDocument();
    expect(screen.getByText('Round trip · Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Air India 2 flights/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select outbound Air India AI 504' }));

    expect(await screen.findByRole('heading', { name: 'Choose your return flight: Mumbai to Delhi' })).toBeInTheDocument();
    expect(screen.getByText('Round trip · Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText(/Outbound:/).parentElement).toHaveTextContent('Air India AI 504');
    expect(screen.getByRole('checkbox', { name: /^Vistara 1 flight/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Air India/ })).not.toBeInTheDocument();
    expect(flightApi.revalidate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Select return Vistara UK 971' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/flights/trip/trip-1'));
    expect(flightApi.revalidate).toHaveBeenCalledWith(['offer-1', 'back-1']);
  });

  it('lets the customer change the outbound flight', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(roundTrip());
    const { user } = open(`${URL}&returnDate=${RETURN}`);
    await user.click(await screen.findByRole('button', { name: 'Select outbound Air India AI 504' }));

    await user.click(await screen.findByRole('button', { name: 'Change outbound' }));

    expect(await screen.findByRole('heading', { name: /Choose your outbound flight/ })).toBeInTheDocument();
  });

  it('compares up to three flights side by side and selects from the comparison', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(searchFixture({
      outbound: { ...searchFixture().outbound, totalOptions: 4, options: [...searchFixture().outbound.options, optionFixture({ offerId: 'offer-4', flightNumber: 'AI 888' })] },
    }));
    const { user } = open();
    await screen.findByRole('list', { name: 'Flights' });

    await user.click(screen.getByRole('checkbox', { name: 'Compare Air India AI 504' }));
    expect(screen.queryByRole('button', { name: 'Compare flights' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Compare IndiGo 6E 211' }));
    await user.click(screen.getByRole('checkbox', { name: 'Compare Air India AI 660' }));
    expect(screen.getByRole('checkbox', { name: 'Compare Air India AI 888' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Compare flights' }));

    const dialog = screen.getByRole('dialog', { name: 'Compare flights' });
    expect(dialog).toHaveAccessibleDescription('3 flights side by side. Select one to continue.');
    expect(within(dialog).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(dialog).getByText('Cheapest').closest('th')).toHaveTextContent('IndiGo 6E 211');
    expect(within(dialog).getByText('Fastest').closest('th')).toHaveTextContent('IndiGo 6E 211');
    expect(within(dialog).getByRole('rowheader', { name: 'Baggage' })).toBeInTheDocument();
    // The best value of a row is marked: the price next to the select buttons, the duration in its row.
    const total = within(dialog).getByRole('rowheader', { name: 'Total price' }).closest('tr') as HTMLElement;
    expect(within(total).getByText('₹9,800')).toBeInTheDocument();
    // (The other prices keep an invisible copy of the mark, so the select buttons stay in line.)
    const lowest = within(total).getAllByText('Lowest').filter((mark) => mark.getAttribute('aria-hidden') !== 'true');
    expect(lowest).toHaveLength(1);
    expect(lowest[0]?.closest('td')).toHaveTextContent('₹4,800');
    expect(within(within(dialog).getByRole('rowheader', { name: 'Duration' }).closest('tr') as HTMLElement).getByText('Shortest').closest('td')).toHaveTextContent('2h 5m');
    await user.click(within(dialog).getByRole('button', { name: 'Remove AI 660 from the comparison' }));
    await user.click(within(dialog).getByRole('button', { name: /Select IndiGo 6E 211 from the comparison/ }));

    await waitFor(() => expect(flightApi.revalidate).toHaveBeenCalledWith(['offer-2']));
  });

  it('shows the best value of each order on the sort tiles and tags the cheapest and the fastest flight', async () => {
    open();
    const list = await screen.findByRole('list', { name: 'Flights' });

    const sorting = screen.getByRole('group', { name: 'Sort by' });
    expect(within(sorting).getByRole('radio', { name: 'Lowest price' })).toBeChecked();
    expect(within(sorting).getByRole('radio', { name: 'Lowest price' })).toHaveAccessibleDescription('₹4,800');
    expect(within(sorting).getByRole('radio', { name: 'Shortest journey' })).toHaveAccessibleDescription('2h 5m');
    expect(within(sorting).getByRole('radio', { name: 'Earliest departure' })).toHaveAccessibleDescription('06:45');
    expect(within(sorting).getByRole('radio', { name: 'Earliest arrival' })).toHaveAccessibleDescription('08:55');
    expect(screen.getByRole('status')).toHaveTextContent('3 flights · cheapest first');

    const card = (name: string) => within(within(list).getByRole('button', { name }).closest('li') as HTMLElement);
    expect(card('Select IndiGo 6E 211').getByText('Cheapest')).toBeInTheDocument();
    expect(card('Select IndiGo 6E 211').getByText('Fastest')).toBeInTheDocument();
    expect(card('Select Air India AI 504').queryByText('Cheapest')).not.toBeInTheDocument();
    expect(card('Select Air India AI 504').queryByText('Fastest')).not.toBeInTheDocument();
  });

  it('picks a part of the day with a tile and goes back to any time when it is pressed again', async () => {
    const { user, router } = open(`${URL}&arriveAfter=06:00&arriveBefore=12:00`);
    await screen.findByRole('list', { name: 'Flights' });
    const arrival = () => within(screen.getByRole('group', { name: 'Arrival time' }));
    expect(arrival().getByRole('button', { name: 'Morning 06:00–12:00' })).toHaveAttribute('aria-pressed', 'true');
    expect(arrival().getByRole('button', { name: 'Evening 18:00–24:00' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(arrival().getByRole('button', { name: 'Evening 18:00–24:00' }));
    await waitFor(() => expect(currentLocation(router)).toContain('arriveAfter=18%3A00'));
    expect(currentLocation(router)).toContain('arriveBefore=23%3A59');
    expect(arrival().getByRole('button', { name: 'Evening 18:00–24:00' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(arrival().getByRole('button', { name: 'Evening 18:00–24:00' }));
    await waitFor(() => expect(currentLocation(router)).not.toContain('arriveAfter'));
  });

  it('shows the search and a searching animation while the flights load', async () => {
    vi.mocked(flightApi.search).mockReturnValue(new Promise(() => {}));
    open();

    expect(await screen.findByRole('heading', { name: 'DEL to BOM', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Searching for flights…');
    expect(screen.queryByRole('list', { name: 'Flights' })).not.toBeInTheDocument();
  });

  it('marks nothing as cheapest or fastest when the compared flights are equal on it', async () => {
    vi.mocked(flightApi.search).mockResolvedValue(searchFixture({
      outbound: { ...searchFixture().outbound, totalOptions: 4, options: [...searchFixture().outbound.options, optionFixture({ offerId: 'offer-4', flightNumber: 'AI 888' })] },
    }));
    const { user } = open();
    await screen.findByRole('list', { name: 'Flights' });

    await user.click(screen.getByRole('checkbox', { name: 'Compare Air India AI 504' }));
    await user.click(screen.getByRole('checkbox', { name: 'Compare Air India AI 888' }));
    await user.click(screen.getByRole('button', { name: 'Compare flights' }));

    const dialog = screen.getByRole('dialog', { name: 'Compare flights' });
    for (const mark of ['Cheapest', 'Fastest', 'Lowest', 'Shortest']) {
      expect(within(dialog).queryByText(mark)).not.toBeInTheDocument();
    }
    expect(within(dialog).getAllByRole('button', { name: /^Select .* from the comparison$/ })).toHaveLength(2);
  });

  it('refreshes the list when the chosen fare has just expired', async () => {
    vi.mocked(flightApi.revalidate).mockRejectedValue(new ApiError(404, 'OFFER_EXPIRED', 'The offer has expired.'));
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Select Air India AI 504' }));

    expect(await screen.findByText('This fare is no longer available')).toBeInTheDocument();
    await waitFor(() => expect(flightApi.search).toHaveBeenCalledTimes(2));
  });

  it('shows the temporary-unavailable message when no provider can answer', async () => {
    vi.mocked(flightApi.search).mockRejectedValue(new ApiError(503, 'FLIGHT_SEARCH_UNAVAILABLE', 'Flight search is temporarily unavailable.'));
    open();

    expect(await screen.findByText('Flight search is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
