import { screen, waitFor, within } from '@testing-library/react';
import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { formatDate } from '@/lib/format';
import { stubFileSaving } from '@/test/downloads';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { InventoryCalendarPage } from './InventoryCalendarPage';
import { managerApi } from './managerApi';
import { day } from './opsTestData';
import type { InventoryCalendar, InventoryDay } from './types';

vi.mock('./managerApi', () => ({ managerApi: { inventory: vi.fn(), updateInventory: vi.fn(), myHotels: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', roles: ['HOTEL_MANAGER'] };
const iso = (date: Date) => format(date, 'yyyy-MM-dd');
/** What a date field shows for an ISO date ("Sun, 1 Nov 2026"). */
const shown = (isoDate: string) => format(parseISO(isoDate), 'EEE, d MMM yyyy');
const TODAY = day(0);

const night = (overrides: Partial<InventoryDay> = {}): InventoryDay => ({
  date: TODAY, totalRooms: 10, bookedRooms: 6, heldRooms: 1, freeRooms: 3, stopSell: false, price: 5200, ...overrides,
});

const calendar = (overrides: Partial<InventoryCalendar> = {}): InventoryCalendar => ({
  from: iso(startOfMonth(new Date())),
  to: iso(endOfMonth(new Date())),
  lastSellableNight: day(365),
  roomTypes: [
    { roomTypeId: 'rt1', name: 'Deluxe Sea View', defaultTotalRooms: 10, status: 'ACTIVE', days: [night()] },
    { roomTypeId: 'rt2', name: 'Garden Room', defaultTotalRooms: 5, status: 'INACTIVE',
      days: [night({ totalRooms: 5, bookedRooms: 5, heldRooms: 0, freeRooms: 0, stopSell: true, price: null })] },
  ],
  ...overrides,
});

const open = () => renderRoutes([{ path: '/hotel-manager/hotels/:hotelId/inventory', element: <InventoryCalendarPage /> }],
  { path: '/hotel-manager/hotels/h1/inventory', auth: fakeAuth({ user: manager }) });

/** The "Change availability" card. */
const updateCard = () => screen.getByRole('heading', { name: 'Change availability' }).closest('section') as HTMLElement;

beforeEach(() => {
  vi.mocked(managerApi.inventory).mockResolvedValue(calendar());
  vi.mocked(managerApi.myHotels).mockResolvedValue([{ id: 'h1', name: 'Sea Breeze Resort' }] as Awaited<ReturnType<typeof managerApi.myHotels>>);
});

describe('InventoryCalendarPage: calendar', () => {
  it('shows free / total rooms per night and room type, with stop-sell and sold-out nights', async () => {
    open();

    const table = await screen.findByRole('table', { name: 'Rooms free / rooms for sale per night' });
    expect(screen.getByRole('heading', { name: format(new Date(), 'MMMM yyyy') })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: /Deluxe Sea View/ })).toHaveTextContent('10 rooms');
    expect(within(table).getByRole('rowheader', { name: /Garden Room/ })).toHaveTextContent('5 rooms · not on sale');

    const deluxeNight = within(table).getByRole('button', { name: `${formatDate(TODAY)}: 3 of 10 free, 6 booked, 1 held, from ₹5,200` });
    expect(deluxeNight).toHaveTextContent('3/10');
    expect(deluxeNight).toHaveTextContent('5.2k');
    expect(deluxeNight).toHaveAttribute('aria-pressed', 'false');
    expect(within(table).getByRole('button', { name: `${formatDate(TODAY)}: 0 of 5 free, 5 booked, 0 held, stop-sell` }))
      .toHaveTextContent('0/5');
    // Every other night of the month has no inventory row (past, or not loaded).
    expect(within(table).getAllByRole('button')).toHaveLength(2);
    expect(managerApi.inventory).toHaveBeenCalledWith('h1', iso(startOfMonth(new Date())), iso(endOfMonth(new Date())));
    // Today's column says so for screen readers; the legend names the three kinds of night.
    expect(within(table).getByRole('columnheader', { name: /\(today\)/ })).toHaveTextContent(format(new Date(), 'd'));
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Rooms free', 'Sold out', 'Stop-sell']);
  });

  it('adds up the month: occupancy of the rooms for sale, booked room nights, sold-out and stop-sell nights', async () => {
    vi.mocked(managerApi.inventory).mockResolvedValue(calendar({
      roomTypes: [{ roomTypeId: 'rt1', name: 'Deluxe Sea View', defaultTotalRooms: 10, status: 'ACTIVE', days: [
        night({ date: day(0) }),
        night({ date: day(1), totalRooms: 10, bookedRooms: 10, heldRooms: 0, freeRooms: 0 }),
        night({ date: day(2), totalRooms: 10, bookedRooms: 2, heldRooms: 0, freeRooms: 0, stopSell: true }),
      ] }],
    }));
    open();

    const figures = await screen.findByRole('list', { name: `Availability in ${format(new Date(), 'MMMM yyyy')}` });
    const card = (label: string) => within(figures).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;
    // 16 of the 20 rooms for sale are booked (the stop-sell night is not for sale), 18 room nights are booked in all.
    await waitFor(() => expect(card('Occupancy')).toHaveTextContent('80%'));
    expect(card('Room nights booked')).toHaveTextContent('18');
    expect(card('Room nights booked')).toHaveTextContent('1 more held while guests pay');
    expect(card('Sold-out nights')).toHaveTextContent('1');
    expect(card('Stop-sell nights')).toHaveTextContent('1');
  });

  it('moves between this month and the next eleven months', async () => {
    const { user } = open();
    await screen.findByRole('table');

    const previous = screen.getByRole('button', { name: 'Previous month' });
    expect(previous).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    const next = addMonths(startOfMonth(new Date()), 1);
    expect(screen.getByRole('heading', { name: format(next, 'MMMM yyyy') })).toBeInTheDocument();
    await waitFor(() => expect(managerApi.inventory).toHaveBeenLastCalledWith('h1', iso(next), iso(endOfMonth(next))));
    expect(previous).toBeEnabled();

    for (let i = 0; i < 10; i++) {
      await user.click(screen.getByRole('button', { name: 'Next month' }));
    }
    expect(screen.getByRole('heading', { name: format(addMonths(startOfMonth(new Date()), 11), 'MMMM yyyy') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('jumps back to this month', async () => {
    const { user } = open();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'This month' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'This month' }));

    expect(screen.getByRole('heading', { name: format(new Date(), 'MMMM yyyy') })).toBeInTheDocument();
    await waitFor(() => expect(managerApi.inventory).toHaveBeenLastCalledWith('h1', iso(startOfMonth(new Date())), iso(endOfMonth(new Date()))));
    expect(screen.queryByRole('button', { name: 'This month' })).not.toBeInTheDocument();
  });

  it('asks for a room type first when the hotel has none', async () => {
    vi.mocked(managerApi.inventory).mockResolvedValue(calendar({ roomTypes: [] }));
    open();

    expect(await screen.findByText('Add a room type under "Rooms & rates" first.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Change availability' })).not.toBeInTheDocument();
  });

  it('offers a retry when the calendar cannot be loaded', async () => {
    vi.mocked(managerApi.inventory)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Inventory is not reachable.'))
      .mockResolvedValueOnce(calendar());
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Inventory is not reachable.');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('InventoryCalendarPage: changing availability', () => {
  it('fills the form from the selected night and applies the change', async () => {
    vi.mocked(managerApi.updateInventory).mockResolvedValue(calendar());
    const { user } = open();

    const cell = await screen.findByRole('button', { name: new RegExp(`^${formatDate(TODAY)}: 3 of 10 free`) });
    await user.click(cell);

    expect(screen.getByRole('button', { name: new RegExp(`^${formatDate(TODAY)}: 3 of 10 free`) })).toHaveAttribute('aria-pressed', 'true');
    const card = within(updateCard());
    expect(card.getByRole('combobox', { name: 'Room type' })).toHaveValue('rt1');
    expect(card.getByLabelText('First night')).toHaveValue(shown(TODAY));
    expect(card.getByLabelText('Last night')).toHaveValue(shown(TODAY));
    expect(card.getByRole('textbox', { name: /Rooms for sale/ })).toHaveValue('10');
    const chosen = card.getByRole('group', { name: 'Selected night' });
    expect(chosen).toHaveTextContent(`Deluxe Sea View · ${formatDate(TODAY)}`);
    expect(within(chosen).getByText('6 booked')).toBeInTheDocument();
    expect(within(chosen).getByText('1 held')).toBeInTheDocument();
    expect(within(chosen).getByText('3 free')).toBeInTheDocument();
    expect(within(chosen).queryByText('Stop-sell on')).not.toBeInTheDocument();

    await user.clear(card.getByRole('textbox', { name: /Rooms for sale/ }));
    await user.type(card.getByRole('textbox', { name: /Rooms for sale/ }), '8');
    await user.selectOptions(card.getByRole('combobox', { name: 'Stop-sell' }), 'On (close sales)');
    await user.click(card.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('Inventory updated.')).toBeInTheDocument();
    expect(managerApi.updateInventory).toHaveBeenCalledWith('h1', { roomTypeId: 'rt1', from: TODAY, to: TODAY, totalRooms: 8, stopSell: true });
    await waitFor(() => expect(managerApi.inventory).toHaveBeenCalledTimes(2));
  });

  it('can reopen sales for a range without changing the rooms', async () => {
    vi.mocked(managerApi.updateInventory).mockResolvedValue(calendar());
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: /stop-sell$/ }));
    const card = within(updateCard());
    expect(card.getByRole('combobox', { name: 'Room type' })).toHaveValue('rt2');
    expect(card.getByRole('group', { name: 'Selected night' })).toHaveTextContent('Stop-sell on');
    await user.clear(card.getByRole('textbox', { name: /Rooms for sale/ }));
    await user.clear(card.getByLabelText('Last night'));
    await user.type(card.getByLabelText('Last night'), day(3));
    await user.selectOptions(card.getByRole('combobox', { name: 'Stop-sell' }), 'Off (open sales)');
    await user.click(card.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(managerApi.updateInventory).toHaveBeenCalledWith('h1',
      { roomTypeId: 'rt2', from: TODAY, to: day(3), totalRooms: undefined, stopSell: false }));
  });

  it('needs dates and something to change', async () => {
    const { user } = open();
    await screen.findByRole('table');

    const card = within(updateCard());
    expect(card.getByRole('combobox', { name: 'Room type' })).toHaveValue('rt1');
    expect(card.queryByRole('group', { name: 'Selected night' })).not.toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'Apply' }));

    expect(await card.findByText('Choose the first night')).toBeInTheDocument();
    expect(card.getByText('Choose the last night')).toBeInTheDocument();
    expect(card.getByText('Change the number of rooms and/or stop-sell')).toBeInTheDocument();
    expect(managerApi.updateInventory).not.toHaveBeenCalled();
  });

  it('brings the form into view when a night is chosen', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { user } = open();
      await screen.findByRole('table');
      expect(scrollIntoView).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: new RegExp(`^${formatDate(TODAY)}: 3 of 10 free`) }));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(updateCard());
      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
    } finally {
      // jsdom has no scrollIntoView: leave the prototype as it was.
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('lists the nights that already have more rooms booked or held', async () => {
    vi.mocked(managerApi.updateInventory)
      .mockRejectedValueOnce(new ApiError(409, 'INVENTORY_BELOW_RESERVED', 'Below reserved', [], null, { nights: [day(1), day(2)] }))
      .mockRejectedValueOnce(new ApiError(422, 'OUTSIDE_SALES_WINDOW', 'Nights can be changed up to 365 days ahead.'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: new RegExp(`^${formatDate(TODAY)}: 3 of 10 free`) }));
    const card = within(updateCard());
    await user.clear(card.getByRole('textbox', { name: /Rooms for sale/ }));
    await user.type(card.getByRole('textbox', { name: /Rooms for sale/ }), '2');
    await user.click(card.getByRole('button', { name: 'Apply' }));

    const alert = await card.findByRole('alert');
    expect(alert).toHaveTextContent('Fewer rooms than already booked or held');
    expect(alert).toHaveTextContent(`${formatDate(day(1))}, ${formatDate(day(2))}`);

    await user.click(card.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(card.getByRole('alert')).toHaveTextContent('Nights can be changed up to 365 days ahead.'));
  });
});

describe('InventoryCalendarPage: export', () => {
  it('exports the month shown: one row per night and room type, night by night, in the calendar order', async () => {
    const files = stubFileSaving();
    const base = calendar();
    vi.mocked(managerApi.inventory).mockResolvedValue(calendar({
      roomTypes: [
        { ...base.roomTypes[0]!, days: [night({ date: day(1), bookedRooms: 2, heldRooms: 0, freeRooms: 8, price: 5600 }), night()] },
        base.roomTypes[1]!,
      ],
    }));
    const { user } = open();
    await screen.findByRole('table', { name: 'Rooms free / rooms for sale per night' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export inventory' });
    // One month, loaded whole: nothing to choose about the rows.
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect((await files.blobs[0]!.text()).split('\r\n').filter(Boolean)).toEqual([
      '"Night","Room type","Rooms for sale","Booked","Held","Free","Stop-sell","Price per night (INR)"',
      `${TODAY},"Deluxe Sea View",10,6,1,3,"No",5200.00`,
      `${TODAY},"Garden Room",5,5,0,0,"Yes",`,
      `${day(1)},"Deluxe Sea View",10,2,0,8,"No",5600.00`,
    ]);
    expect(files.saved[0]!.fileName).toMatch(new RegExp(`^inventory-sea-breeze-resort-${format(new Date(), 'yyyy-MM')}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
  });

  it('has nothing to export without room types', async () => {
    vi.mocked(managerApi.inventory).mockResolvedValue(calendar({ roomTypes: [] }));
    open();

    expect(await screen.findByText('Add a room type under "Rooms & rates" first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
});
