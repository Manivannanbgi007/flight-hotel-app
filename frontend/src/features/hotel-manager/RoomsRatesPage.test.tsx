import { screen, waitFor, within } from '@testing-library/react';

import { hotelApi } from '@/features/hotels/hotelApi';
import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { managerApi } from './managerApi';
import { RoomsRatesPage } from './RoomsRatesPage';
import type { RatePlanItem, RoomTypeItem } from './types';

vi.mock('./managerApi', () => ({
  managerApi: {
    roomTypes: vi.fn(), createRoomType: vi.fn(), updateRoomType: vi.fn(), createRatePlan: vi.fn(), updateRatePlan: vi.fn(),
    addSeasonalRate: vi.fn(), deleteSeasonalRate: vi.fn(),
  },
}));
vi.mock('@/features/hotels/hotelApi', () => ({ hotelApi: { amenities: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', roles: ['HOTEL_MANAGER'] };

const plan = (overrides: Partial<RatePlanItem> = {}): RatePlanItem => ({
  id: 'rp1', roomTypeId: 'rt1', name: 'Flexible with breakfast', basePricePerNight: 5200, currency: 'INR', breakfastIncluded: true,
  refundable: true, freeCancellationHours: 48, cancellationFeePercent: 50,
  cancellationSummary: 'Free cancellation until 48 hours before check-in', status: 'ACTIVE',
  seasonalRates: [{ id: 'sr1', label: 'Diwali week', startDate: '2099-10-30', endDate: '2099-11-05', pricePerNight: 7800, priority: 1 }],
  version: 5, ...overrides,
});

const room = (overrides: Partial<RoomTypeItem> = {}): RoomTypeItem => ({
  id: 'rt1', name: 'Deluxe Sea View', description: null, maxAdults: 2, maxChildren: 1, bedConfiguration: '1 King bed', sizeSqm: 32,
  totalRooms: 10, status: 'ACTIVE', sortOrder: 0, amenities: ['MINIBAR'], ratePlans: [plan()], version: 2, ...overrides,
});

const gardenRoom = room({
  id: 'rt2', name: 'Garden Room', bedConfiguration: '2 Queen beds', maxChildren: 0, sizeSqm: null, totalRooms: 5, status: 'INACTIVE',
  sortOrder: 1, amenities: [], ratePlans: [], version: 1,
});

const open = () => renderRoutes([{ path: '/hotel-manager/hotels/:hotelId/rooms', element: <RoomsRatesPage /> }],
  { path: '/hotel-manager/hotels/h1/rooms', auth: fakeAuth({ user: manager }) });

/** The card of a room type: the smallest element around its heading that also holds its rate plans. */
async function cardOf(name: string): Promise<HTMLElement> {
  let element: HTMLElement | null = await screen.findByRole('heading', { level: 2, name });
  while (element && !within(element).queryByRole('heading', { level: 3, name: 'Rate plans' })) {
    element = element.parentElement;
  }
  return element!;
}

/** The form that holds the button. */
const formOf = (button: HTMLElement) => within(button.closest('form') as HTMLElement);

beforeEach(() => {
  vi.mocked(managerApi.roomTypes).mockResolvedValue([room(), gardenRoom]);
  vi.mocked(hotelApi.amenities).mockResolvedValue([
    { code: 'POOL', name: 'Swimming pool', category: 'HOTEL' },
    { code: 'MINIBAR', name: 'Minibar', category: 'ROOM' },
    { code: 'BALCONY', name: 'Balcony', category: 'ROOM' },
  ]);
});

describe('RoomsRatesPage: overview', () => {
  it('sums up the rooms on sale, the rate plans and the lowest price', async () => {
    open();

    const figures = await screen.findByRole('list', { name: 'Room figures' });
    const card = (label: string) => within(figures).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    await waitFor(() => expect(card('Room types on sale')).toHaveTextContent('1'));
    expect(card('Room types on sale')).toHaveTextContent('2 in all');
    expect(card('Rooms on sale')).toHaveTextContent('10');
    expect(card('Active rate plans')).toHaveTextContent('1');
    expect(card('Active rate plans')).toHaveTextContent('1 with breakfast');
    await waitFor(() => expect(card('Lowest price per night')).toHaveTextContent('₹5,200'));
    expect(screen.getByRole('heading', { name: 'Rooms by room type' })).toBeInTheDocument();
  });

  it('shows each room type with its rate plans and seasonal prices', async () => {
    open();

    const deluxe = await cardOf('Deluxe Sea View');
    expect(within(deluxe).getByText('On sale')).toBeInTheDocument();
    expect(within(deluxe).getByText('1 King bed · up to 2 adults + 1 children · 32 m² · 10 rooms per night')).toBeInTheDocument();
    // The room's amenities as chips, and the lowest active price of its plans.
    expect(within(await within(deluxe).findByRole('list', { name: 'Amenities of Deluxe Sea View' })).getByText('Minibar')).toBeInTheDocument();
    expect(within(deluxe).getByText('From').closest('p')).toHaveTextContent('From ₹5,200 per night');
    // Each plan is a card: name, price per night, breakfast and the cancellation terms.
    const plans = within(deluxe).getByRole('list', { name: 'Rate plans of Deluxe Sea View' });
    const flexible = within(plans).getByText('Flexible with breakfast').closest('li') as HTMLElement;
    expect(within(flexible).getByText('₹5,200').parentElement).toHaveTextContent('₹5,200 / night');
    expect(within(flexible).getByText('Breakfast included')).toBeInTheDocument();
    expect(within(flexible).getByText('Free cancellation until 48 hours before check-in')).toBeInTheDocument();
    const season = within(flexible).getByRole('button', { name: 'Delete seasonal price Diwali week' }).closest('li');
    expect(season).toHaveTextContent('Diwali week');
    expect(season).toHaveTextContent('30 Oct 2099 – 5 Nov 2099 · priority 1');
    expect(season).toHaveTextContent('₹7,800 / night');
    expect(within(deluxe).queryByText(/cannot be booked/)).not.toBeInTheDocument();

    const garden = await cardOf('Garden Room');
    expect(within(garden).getByText('Not on sale')).toBeInTheDocument();
    expect(within(garden).getByText('2 Queen beds · up to 2 adults + 0 children · 5 rooms per night')).toBeInTheDocument();
    expect(within(garden).getByRole('alert')).toHaveTextContent('No rate plans: this room type cannot be booked until you add one.');
    expect(managerApi.roomTypes).toHaveBeenCalledWith('h1');
  });

  it('says how base and seasonal prices combine and marks plans that are not on sale', async () => {
    vi.mocked(managerApi.roomTypes).mockResolvedValue([room({
      ratePlans: [plan({ status: 'INACTIVE', breakfastIncluded: false, seasonalRates: [], cancellationSummary: 'Non-refundable' })],
    })]);
    open();

    const deluxe = await cardOf('Deluxe Sea View');
    expect(within(deluxe).getByText('Room only')).toBeInTheDocument();
    expect(within(deluxe).getByText('Non-refundable')).toBeInTheDocument();
    expect(within(deluxe).getAllByText('Not on sale')).toHaveLength(1);
    // A plan that is not on sale gives the room no "from" price.
    expect(within(deluxe).queryByText('From')).not.toBeInTheDocument();
    expect(within(deluxe).getByText('None: the base price applies every night.')).toBeInTheDocument();
  });

  it('has an empty state and an error state with retry', async () => {
    vi.mocked(managerApi.roomTypes)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hotel service is not reachable.'))
      .mockResolvedValueOnce([]);
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Hotel service is not reachable.');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'No room types yet' })).toBeInTheDocument();
  });
});

describe('RoomsRatesPage: room types', () => {
  it('adds a room type after checking the form', async () => {
    vi.mocked(managerApi.roomTypes).mockResolvedValue([]);
    vi.mocked(managerApi.createRoomType).mockResolvedValue(room({ id: 'rt3', name: 'Family Suite' }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: /Add room type/ }));
    expect(screen.getByRole('heading', { name: 'New room type' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No room types yet' })).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Add room type' });
    const form = formOf(submit);

    await user.clear(form.getByRole('textbox', { name: 'Max adults' }));
    await user.type(form.getByRole('textbox', { name: 'Max adults' }), '0');
    await user.type(form.getByRole('textbox', { name: /Size/ }), '45.5');
    await user.click(submit);

    expect(await form.findByText('Enter a name')).toBeInTheDocument();
    expect(form.getByText('Describe the beds, e.g. 1 King bed')).toBeInTheDocument();
    expect(form.getByText('Between 1 and 10')).toBeInTheDocument();
    expect(form.getByText('Whole number')).toBeInTheDocument();
    expect(managerApi.createRoomType).not.toHaveBeenCalled();

    await user.type(form.getByRole('textbox', { name: 'Name' }), ' Family Suite ');
    await user.type(form.getByRole('textbox', { name: 'Beds' }), '2 Queen beds');
    await user.clear(form.getByRole('textbox', { name: /Size/ }));
    await user.type(form.getByRole('textbox', { name: /Size/ }), '45');
    await user.clear(form.getByRole('textbox', { name: 'Max adults' }));
    await user.type(form.getByRole('textbox', { name: 'Max adults' }), '4');
    await user.clear(form.getByRole('textbox', { name: 'Rooms for sale per night' }));
    await user.type(form.getByRole('textbox', { name: 'Rooms for sale per night' }), '6');
    await user.type(form.getByRole('textbox', { name: /Description/ }), 'Two connected rooms.');
    expect(form.queryByRole('checkbox', { name: 'Swimming pool' })).not.toBeInTheDocument();
    await user.click(await form.findByRole('checkbox', { name: 'Balcony' }));
    await user.click(submit);

    expect(await screen.findByText('Room type added. Its rooms are on sale for the next 365 days.')).toBeInTheDocument();
    expect(managerApi.createRoomType).toHaveBeenCalledWith('h1', {
      name: 'Family Suite', description: 'Two connected rooms.', maxAdults: 4, maxChildren: 1, bedConfiguration: '2 Queen beds',
      sizeSqm: 45, totalRooms: 6, status: 'ACTIVE', sortOrder: 0, amenities: ['BALCONY'], version: undefined,
    });
    expect(screen.queryByRole('heading', { name: 'New room type' })).not.toBeInTheDocument();
  });

  it('can cancel adding a room type', async () => {
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: /Add room type/ }));
    await user.click(formOf(screen.getByRole('button', { name: 'Add room type' })).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { name: 'New room type' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add room type/ })).toBeInTheDocument();
  });

  it('edits a room type; fewer rooms than already booked lists the nights', async () => {
    vi.mocked(managerApi.updateRoomType)
      .mockRejectedValueOnce(new ApiError(409, 'INVENTORY_BELOW_RESERVED', 'Below reserved', [], null, { nights: ['2099-03-10', '2099-03-11'] }))
      .mockResolvedValueOnce(room({ totalRooms: 8 }));
    const { user } = open();

    const deluxe = await cardOf('Deluxe Sea View');
    await user.click(within(deluxe).getByRole('button', { name: 'Edit room type' }));
    const submit = within(deluxe).getByRole('button', { name: 'Save room type' });
    const form = formOf(submit);
    expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Deluxe Sea View');
    expect(form.getByText('Applies to all future nights')).toBeInTheDocument();
    expect(await form.findByRole('checkbox', { name: 'Minibar' })).toBeChecked();

    const rooms = form.getByRole('textbox', { name: 'Rooms for sale per night' });
    await user.clear(rooms);
    await user.type(rooms, '4');
    await user.click(submit);

    const alert = await form.findByRole('alert');
    expect(alert).toHaveTextContent('Not enough rooms');
    expect(alert).toHaveTextContent('Some nights already have more rooms booked or held: 10 Mar 2099, 11 Mar 2099.');

    await user.clear(rooms);
    await user.type(rooms, '8');
    await user.click(submit);

    expect(await screen.findByText('Room type saved.')).toBeInTheDocument();
    expect(managerApi.updateRoomType).toHaveBeenLastCalledWith('h1', 'rt1', {
      name: 'Deluxe Sea View', description: undefined, maxAdults: 2, maxChildren: 1, bedConfiguration: '1 King bed', sizeSqm: 32,
      totalRooms: 8, status: 'ACTIVE', sortOrder: 0, amenities: ['MINIBAR'], version: 2,
    });
    expect(within(deluxe).getByRole('button', { name: 'Edit room type' })).toBeInTheDocument();
  });

  it('shows server field errors and other failures on the room form', async () => {
    vi.mocked(managerApi.updateRoomType)
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [{ field: 'name', message: 'A room type with this name exists' }]))
      .mockRejectedValueOnce(new ApiError(409, 'CONCURRENT_MODIFICATION', 'Someone else changed this room type. Reload the page.'));
    const { user } = open();

    const garden = await cardOf('Garden Room');
    await user.click(within(garden).getByRole('button', { name: 'Edit room type' }));
    const submit = within(garden).getByRole('button', { name: 'Save room type' });
    await user.click(submit);

    expect(await formOf(submit).findByText('A room type with this name exists')).toBeInTheDocument();
    expect(formOf(submit).queryByRole('alert')).not.toBeInTheDocument();

    await user.click(submit);
    expect(await formOf(submit).findByRole('alert')).toHaveTextContent('Someone else changed this room type. Reload the page.');
  });
});

describe('RoomsRatesPage: rate plans', () => {
  it('adds a non-refundable plan without cancellation terms', async () => {
    vi.mocked(managerApi.createRatePlan).mockResolvedValue(plan({ id: 'rp2', roomTypeId: 'rt2' }));
    const { user } = open();

    const garden = await cardOf('Garden Room');
    await user.click(within(garden).getByRole('button', { name: /Add rate plan/ }));
    expect(within(garden).queryByText(/cannot be booked/)).not.toBeInTheDocument();
    const submit = within(garden).getByRole('button', { name: 'Add plan' });
    const form = formOf(submit);
    // A new plan is refundable: free until 48 hours before check-in, the full amount after that.
    expect(form.getByRole('textbox', { name: /Free cancellation until/ })).toHaveValue('48');
    expect(form.getByRole('textbox', { name: /Fee after that/ })).toHaveValue('100');

    await user.type(form.getByRole('textbox', { name: 'Plan name' }), 'Room only');
    await user.type(form.getByRole('textbox', { name: 'Base price per night (₹)' }), '3999.555');
    await user.click(form.getByRole('checkbox', { name: 'Refundable' }));
    expect(form.queryByRole('textbox', { name: /Free cancellation until/ })).not.toBeInTheDocument();
    await user.click(submit);

    expect(await form.findByText('Enter a price, e.g. 4500 or 4500.50')).toBeInTheDocument();

    const price = form.getByRole('textbox', { name: 'Base price per night (₹)' });
    await user.clear(price);
    await user.type(price, '3999.50');
    await user.click(submit);

    expect(await screen.findByText('Rate plan added.')).toBeInTheDocument();
    expect(managerApi.createRatePlan).toHaveBeenCalledWith('h1', 'rt2', {
      name: 'Room only', basePricePerNight: 3999.5, breakfastIncluded: false, refundable: false, freeCancellationHours: undefined,
      cancellationFeePercent: undefined, status: 'ACTIVE', version: undefined,
    });
  });

  it('needs a free-cancellation period or a fee for a refundable plan', async () => {
    const { user } = open();

    const garden = await cardOf('Garden Room');
    await user.click(within(garden).getByRole('button', { name: /Add rate plan/ }));
    const submit = within(garden).getByRole('button', { name: 'Add plan' });
    const form = formOf(submit);
    await user.type(form.getByRole('textbox', { name: 'Plan name' }), 'Flexible');
    await user.type(form.getByRole('textbox', { name: 'Base price per night (₹)' }), '4500');
    await user.clear(form.getByRole('textbox', { name: /Free cancellation until/ }));
    await user.clear(form.getByRole('textbox', { name: /Fee after that/ }));
    await user.click(submit);

    expect(await form.findByText('Give a free-cancellation period or a cancellation fee')).toBeInTheDocument();
    expect(managerApi.createRatePlan).not.toHaveBeenCalled();

    await user.click(form.getByRole('button', { name: 'Cancel' }));
    expect(within(garden).getByRole('alert')).toHaveTextContent(/cannot be booked/);
  });

  it('edits a plan with its version and shows a failure', async () => {
    vi.mocked(managerApi.updateRatePlan)
      .mockRejectedValueOnce(new ApiError(409, 'CONCURRENT_MODIFICATION', 'Someone else changed this plan.'))
      .mockResolvedValueOnce(plan({ basePricePerNight: 5600 }));
    const { user } = open();

    const deluxe = await cardOf('Deluxe Sea View');
    await user.click(within(deluxe).getByRole('button', { name: 'Edit' }));
    const submit = within(deluxe).getByRole('button', { name: 'Save plan' });
    const form = formOf(submit);
    expect(form.getByRole('checkbox', { name: 'Breakfast included' })).toBeChecked();
    expect(form.getByRole('textbox', { name: /Fee after that/ })).toHaveValue('50');

    const price = form.getByRole('textbox', { name: 'Base price per night (₹)' });
    await user.clear(price);
    await user.type(price, '5600');
    await user.click(submit);
    expect(await form.findByRole('alert')).toHaveTextContent('Someone else changed this plan.');

    await user.click(submit);
    expect(await screen.findByText('Rate plan saved.')).toBeInTheDocument();
    expect(managerApi.updateRatePlan).toHaveBeenLastCalledWith('h1', 'rt1', 'rp1', {
      name: 'Flexible with breakfast', basePricePerNight: 5600, breakfastIncluded: true, refundable: true, freeCancellationHours: 48,
      cancellationFeePercent: 50, status: 'ACTIVE', version: 5,
    });
  });
});

describe('RoomsRatesPage: seasonal prices', () => {
  it('adds a seasonal price after checking the dates', async () => {
    vi.mocked(managerApi.addSeasonalRate).mockResolvedValue(
      { id: 'sr2', label: 'Christmas', startDate: '2099-12-20', endDate: '2099-12-31', pricePerNight: 9000, priority: 2 });
    const { user } = open();

    const deluxe = await cardOf('Deluxe Sea View');
    await user.click(within(deluxe).getByRole('button', { name: 'Add' }));
    const submit = within(deluxe).getByRole('button', { name: 'Add seasonal price' });
    const form = formOf(submit);
    await user.click(submit);

    expect(await form.findByText('Name the season, e.g. Diwali week')).toBeInTheDocument();
    expect(form.getByText('Choose the first night')).toBeInTheDocument();
    expect(form.getByText('Enter a price')).toBeInTheDocument();

    await user.type(form.getByRole('textbox', { name: 'Season' }), 'Christmas');
    await user.type(form.getByLabelText('First night'), '2099-12-20');
    await user.type(form.getByLabelText('Last night'), '2099-12-10');
    await user.type(form.getByRole('textbox', { name: 'Price per night (₹)' }), '9000');
    const priority = form.getByRole('textbox', { name: 'Priority' });
    await user.clear(priority);
    await user.type(priority, '2');
    await user.click(submit);

    expect(await form.findByText('The last night must be on or after the first')).toBeInTheDocument();
    expect(managerApi.addSeasonalRate).not.toHaveBeenCalled();

    await user.clear(form.getByLabelText('Last night'));
    await user.type(form.getByLabelText('Last night'), '2099-12-31');
    await user.click(submit);

    expect(await screen.findByText('Seasonal price added.')).toBeInTheDocument();
    expect(managerApi.addSeasonalRate).toHaveBeenCalledWith('h1', 'rt1', 'rp1', {
      label: 'Christmas', startDate: '2099-12-20', endDate: '2099-12-31', pricePerNight: 9000, priority: 2,
    });
    expect(within(deluxe).queryByRole('button', { name: 'Add seasonal price' })).not.toBeInTheDocument();
  });

  it('shows a refused seasonal price', async () => {
    vi.mocked(managerApi.addSeasonalRate).mockRejectedValue(
      new ApiError(422, 'SEASON_OUTSIDE_SALES_WINDOW', 'Seasonal prices can be set up to 365 days ahead.'));
    const { user } = open();

    const deluxe = await cardOf('Deluxe Sea View');
    await user.click(within(deluxe).getByRole('button', { name: 'Add' }));
    const submit = within(deluxe).getByRole('button', { name: 'Add seasonal price' });
    const form = formOf(submit);
    await user.type(form.getByRole('textbox', { name: 'Season' }), 'Far future');
    await user.type(form.getByLabelText('First night'), '2199-01-01');
    await user.type(form.getByLabelText('Last night'), '2199-01-02');
    await user.type(form.getByRole('textbox', { name: 'Price per night (₹)' }), '9000');
    await user.click(submit);

    expect(await form.findByRole('alert')).toHaveTextContent('Seasonal prices can be set up to 365 days ahead.');
  });

  it('deletes a seasonal price', async () => {
    vi.mocked(managerApi.deleteSeasonalRate).mockResolvedValue(undefined);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Delete seasonal price Diwali week' }));

    await waitFor(() => expect(managerApi.deleteSeasonalRate).toHaveBeenCalledWith('h1', 'rt1', 'rp1', 'sr1'));
    await waitFor(() => expect(managerApi.roomTypes).toHaveBeenCalledTimes(2));
  });
});
