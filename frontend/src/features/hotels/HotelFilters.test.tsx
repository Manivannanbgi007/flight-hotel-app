import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HotelFilters } from './HotelFilters';
import { EMPTY_FILTERS, type HotelFilters as Filters } from './searchParams';
import type { Amenity, SearchResponse } from './types';

const amenities: Amenity[] = [
  { code: 'FREE_WIFI', name: 'Free Wi-Fi', category: 'HOTEL' },
  { code: 'POOL', name: 'Swimming pool', category: 'HOTEL' },
  { code: 'LAUNDRY', name: 'Laundry', category: 'HOTEL' },
  { code: 'KIDS_CLUB', name: 'Kids club', category: 'HOTEL' },
  { code: 'MINIBAR', name: 'Minibar', category: 'ROOM' },
];

const facets: SearchResponse['facets'] = { minPrice: 2816, maxPrice: 16280, stars: { 5: 1, 4: 3 }, propertyTypes: { RESORT: 2 } };

function renderFilters(filters: Partial<Filters> = {}, { destinationCity = 'Goa' as string | null, withFacets = true } = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <HotelFilters filters={{ ...EMPTY_FILTERS, ...filters }} facets={withFacets ? facets : undefined} amenities={amenities}
      destinationCity={destinationCity} onChange={onChange} />,
  );
  return { ...view, onChange, user };
}

const group = (legend: string) => screen.getByRole('group', { name: legend });

describe('HotelFilters', () => {
  it('offers "Clear all" only when a filter is set, and keeps the sort order', async () => {
    const { rerender, onChange, user } = renderFilters({ sort: 'PRICE_ASC' });
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();

    rerender(<HotelFilters filters={{ ...EMPTY_FILTERS, sort: 'PRICE_ASC', stars: [4], freeCancellation: true }} facets={facets}
      amenities={amenities} destinationCity="Goa" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, sort: 'PRICE_ASC' });
  });

  it('applies the price range with its button, ignoring what is not a number', async () => {
    const { onChange, user } = renderFilters({ minPrice: 3000 });
    const price = within(group('Price per night'));
    expect(price.getByText('From ₹2,816 to ₹16,280 for these results')).toBeInTheDocument();
    expect(price.getByRole('textbox', { name: 'Min (₹)' })).toHaveValue('3000');

    await user.clear(price.getByRole('textbox', { name: 'Min (₹)' }));
    await user.type(price.getByRole('textbox', { name: 'Min (₹)' }), '-50');
    await user.type(price.getByRole('textbox', { name: 'Max (₹)' }), 'lots');
    expect(onChange).not.toHaveBeenCalled();
    await user.click(price.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith({ minPrice: 0, maxPrice: undefined });
  });

  it('hides the price hint without facets', () => {
    renderFilters({}, { withFacets: false });

    expect(within(group('Price per night')).queryByText(/for these results/)).not.toBeInTheDocument();
    expect(within(group('Star rating')).getByRole('checkbox', { name: '5 stars' })).toBeInTheDocument();
  });

  it('toggles stars and property types, with result counts', async () => {
    const { onChange, user } = renderFilters({ stars: [4] });
    const stars = within(group('Star rating'));
    const starNames = ['5 stars (1)', '4 stars (3)', '3 stars', '2 stars', '1 star'];
    stars.getAllByRole('checkbox').forEach((box, i) => expect(box).toHaveAccessibleName(starNames[i]));
    expect(stars.getByRole('checkbox', { name: '4 stars (3)' })).toBeChecked();

    await user.click(stars.getByRole('checkbox', { name: '5 stars (1)' }));
    expect(onChange).toHaveBeenLastCalledWith({ stars: [4, 5] });
    await user.click(stars.getByRole('checkbox', { name: '4 stars (3)' }));
    expect(onChange).toHaveBeenLastCalledWith({ stars: [] });

    await user.click(within(group('Property type')).getByRole('checkbox', { name: 'Villa' }));
    expect(onChange).toHaveBeenLastCalledWith({ propertyTypes: ['VILLA'] });
  });

  it('sets the popular filters, guest rating and availability', async () => {
    const { onChange, user } = renderFilters({ minGuestRating: 4 });

    await user.click(screen.getByRole('checkbox', { name: 'Free cancellation' }));
    expect(onChange).toHaveBeenLastCalledWith({ freeCancellation: true });
    await user.click(screen.getByRole('checkbox', { name: 'Breakfast included' }));
    expect(onChange).toHaveBeenLastCalledWith({ breakfastIncluded: true });

    const rating = within(group('Guest rating'));
    expect(rating.getByRole('radio', { name: '4+' })).toBeChecked();
    await user.click(rating.getByRole('radio', { name: '4.5+' }));
    expect(onChange).toHaveBeenLastCalledWith({ minGuestRating: 4.5 });
    await user.click(rating.getByRole('radio', { name: 'Any' }));
    expect(onChange).toHaveBeenLastCalledWith({ minGuestRating: undefined });

    await user.click(screen.getByRole('checkbox', { name: 'Also show hotels that are full for my dates' }));
    expect(onChange).toHaveBeenLastCalledWith({ showUnavailable: true });
  });

  it('shows popular and chosen hotel amenities first, the rest on request', async () => {
    const { onChange, user } = renderFilters({ amenities: ['KIDS_CLUB'] });
    const box = within(group('Amenities'));
    const shown = ['Free Wi-Fi', 'Swimming pool', 'Kids club'];
    expect(box.getAllByRole('checkbox')).toHaveLength(shown.length);
    box.getAllByRole('checkbox').forEach((checkbox, i) => expect(checkbox).toHaveAccessibleName(shown[i]));
    expect(box.queryByRole('checkbox', { name: 'Minibar' })).not.toBeInTheDocument();

    await user.click(box.getByRole('button', { name: 'Show all amenities' }));
    expect(box.getByRole('checkbox', { name: 'Laundry' })).toBeInTheDocument();
    expect(box.queryByRole('button', { name: 'Show all amenities' })).not.toBeInTheDocument();

    await user.click(box.getByRole('checkbox', { name: 'Kids club' }));
    expect(onChange).toHaveBeenLastCalledWith({ amenities: [] });
    await user.click(box.getByRole('checkbox', { name: 'Swimming pool' }));
    expect(onChange).toHaveBeenLastCalledWith({ amenities: ['KIDS_CLUB', 'POOL'] });
  });

  it('filters by distance from the searched city only', async () => {
    const { onChange, user, unmount } = renderFilters({ maxDistanceKm: 5 });
    const distance = within(group('Distance from Goa centre'));
    expect(distance.getByRole('radio', { name: 'Within 5 km' })).toBeChecked();

    await user.click(distance.getByRole('radio', { name: 'Within 2 km' }));
    expect(onChange).toHaveBeenLastCalledWith({ maxDistanceKm: 2 });
    await user.click(distance.getByRole('radio', { name: 'Any distance' }));
    expect(onChange).toHaveBeenLastCalledWith({ maxDistanceKm: undefined });
    unmount();

    renderFilters({}, { destinationCity: null });
    expect(within(group('Distance')).getByText('Search for a city to filter by distance.')).toBeInTheDocument();
    expect(within(group('Distance')).queryByRole('radio')).not.toBeInTheDocument();
  });
});
