import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { hotelApi } from './hotelApi';
import { HotelSearchForm } from './HotelSearchForm';
import type { Stay } from './types';

vi.mock('./hotelApi', () => ({ hotelApi: { destinations: vi.fn() } }));

/** "Today" is Friday 6 November 2026 (only Date is faked; timers stay real for user-event). */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 6, 10, 0) });
});
afterEach(() => {
  vi.useRealTimers();
});

const STAY: Stay = { checkIn: '2026-12-12', checkOut: '2026-12-14', rooms: 1, adults: 2, children: 0, childAges: [] };

function renderForm(onSearch = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HotelSearchForm destination="Goa" stay={STAY} onSearch={onSearch} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onSearch };
}

const checkIn = () => screen.getByRole('combobox', { name: 'Check-in' });
const checkOut = () => screen.getByRole('combobox', { name: 'Check-out' });

describe('HotelSearchForm', () => {
  it('shows the stay in two-month calendars and keeps check-out after check-in', async () => {
    vi.mocked(hotelApi.destinations).mockResolvedValue([]);
    const { user, onSearch } = renderForm();

    expect(checkIn()).toHaveValue('Sat, 12 Dec 2026');
    expect(checkOut()).toHaveValue('Mon, 14 Dec 2026');

    // Check-out's calendar shades the stay and does not offer the check-in day or earlier.
    await user.click(checkOut());
    const calendar = screen.getByRole('dialog', { name: 'Choose date' });
    expect(calendar.querySelector('[data-day="2026-12-13"]')).toHaveClass('cal-range-middle');
    expect(within(calendar).getByRole('button', { name: /^12 December 2026,/ })).toBeDisabled();
    await user.keyboard('{Escape}');

    // A check-in after the check-out moves the check-out to the next day.
    await user.clear(checkIn());
    await user.type(checkIn(), '20/12/2026');
    await user.tab();
    expect(checkOut()).toHaveValue('Mon, 21 Dec 2026');

    await user.click(screen.getByRole('button', { name: 'Search hotels' }));
    expect(onSearch).toHaveBeenCalledWith('Goa', expect.objectContaining({ checkIn: '2026-12-20', checkOut: '2026-12-21' }));
  });

  it('suggests destinations as a list the visitor can pick from', async () => {
    vi.mocked(hotelApi.destinations).mockResolvedValue([
      { city: 'Udaipur', countryCode: 'IN', hotels: 3 },
      { city: 'Ujjain', countryCode: 'IN', hotels: 1 },
    ]);
    const { user, onSearch } = renderForm();
    const destination = screen.getByRole('combobox', { name: 'Destination' });

    await user.clear(destination);
    await user.type(destination, 'U');
    const list = await screen.findByRole('listbox', { name: 'Suggestions' });
    expect(within(list).getByRole('option', { name: /Udaipur\s*3 hotels/ })).toBeInTheDocument();
    await user.click(within(list).getByRole('option', { name: /Ujjain\s*1 hotel$/ }));
    expect(destination).toHaveValue('Ujjain');

    await user.click(screen.getByRole('button', { name: 'Search hotels' }));
    expect(onSearch).toHaveBeenCalledWith('Ujjain', expect.objectContaining({ checkIn: '2026-12-12' }));
  });
});
