import { screen, waitFor, within } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';

import { adminHotelApi } from '@/features/hotel-manager/managerApi';
import type { HotelSummary, ManagerItem } from '@/features/hotel-manager/types';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { AdminHotelsPage } from './AdminHotelsPage';
import { pageOf, renderAdmin } from './testUtils';

vi.mock('@/features/hotel-manager/managerApi', () => ({
  adminHotelApi: {
    list: vi.fn(), create: vi.fn(), changeStatus: vi.fn(), managers: vi.fn(), assignManager: vi.fn(), unassignManager: vi.fn(),
  },
}));

const hotel = (overrides: Partial<HotelSummary> = {}): HotelSummary => ({
  id: 'h1', name: 'Sea Breeze Resort', slug: 'sea-breeze-resort-goa', city: 'Goa', countryCode: 'IN', status: 'ACTIVE',
  dataSource: 'INTERNAL', starRating: 4, imageUrl: null, roomTypes: 1, managers: 2, updatedAt: '2026-11-01T10:00:00Z',
  ...overrides,
});

const manager = (overrides: Partial<ManagerItem> = {}): ManagerItem => ({
  userId: 'u1', email: 'hari@example.com', firstName: 'Hari', lastName: 'Menon', assignedAt: '2026-10-01T10:00:00Z', ...overrides,
});

const open = () => renderAdmin([{ path: '/admin/hotels', element: <AdminHotelsPage /> }], '/admin/hotels');

/** The list item of a hotel, found by its name. */
const rowOf = async (name: string) => (await screen.findByRole('heading', { name })).closest('li') as HTMLElement;

beforeEach(() => {
  vi.mocked(adminHotelApi.list).mockResolvedValue(pageOf([
    hotel(),
    hotel({ id: 'h2', name: 'Hill View Inn', city: 'Shimla', status: 'DRAFT', dataSource: 'DEMO', roomTypes: 3, managers: 1 }),
  ]));
});

describe('AdminHotelsPage: list', () => {
  it('shows each hotel with its status, counts and actions', async () => {
    open();

    const seaBreeze = await rowOf('Sea Breeze Resort');
    expect(within(seaBreeze).getByText('Published')).toBeInTheDocument();
    expect(within(seaBreeze).getByText('Goa · 1 room type · 2 managers · updated 1 Nov 2026')).toBeInTheDocument();
    expect(within(seaBreeze).getByRole('link', { name: 'Edit content' })).toHaveAttribute('href', '/hotel-manager/hotels/h1/profile');
    expect(within(seaBreeze).getByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    expect(within(seaBreeze).queryByText('Demo listing')).not.toBeInTheDocument();

    const hillView = await rowOf('Hill View Inn');
    expect(within(hillView).getByText('Draft')).toBeInTheDocument();
    expect(within(hillView).getByText('Demo listing')).toBeInTheDocument();
    expect(within(hillView).getByText(/3 room types · 1 manager ·/)).toBeInTheDocument();
    expect(within(hillView).getByRole('button', { name: 'Publish' })).toBeInTheDocument();

    expect(adminHotelApi.list).toHaveBeenCalledWith({ search: '', status: undefined, page: 0 }, 25);
  });

  it('searches and filters by status, starting again on the first page', async () => {
    vi.mocked(adminHotelApi.list).mockImplementation(async (query) => pageOf([hotel()], { page: query.page, totalPages: 3 }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(adminHotelApi.list).toHaveBeenLastCalledWith({ search: '', status: undefined, page: 1 }, 25));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Goa');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Unpublished');

    await waitFor(() => expect(adminHotelApi.list).toHaveBeenLastCalledWith({ search: 'Goa', status: 'INACTIVE', page: 0 }, 25));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('changes the number of hotels per page, starting again on the first page', async () => {
    vi.mocked(adminHotelApi.list).mockImplementation(async (query, size = 20) =>
      pageOf([hotel()], { page: query.page, size, totalElements: 120, totalPages: Math.ceil(120 / size) }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 5')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Per page' }), '50');

    await waitFor(() => expect(adminHotelApi.list).toHaveBeenLastCalledWith({ search: '', status: undefined, page: 0 }, 50));
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('has an empty state', async () => {
    vi.mocked(adminHotelApi.list).mockResolvedValue(pageOf([]));
    open();

    expect(await screen.findByRole('heading', { name: 'No hotels found' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    vi.mocked(adminHotelApi.list)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hotel service is not reachable.'))
      .mockResolvedValueOnce(pageOf([hotel()]));
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Hotel service is not reachable.');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Sea Breeze Resort' })).toBeInTheDocument();
  });
});

describe('AdminHotelsPage: publishing', () => {
  it('publishes a draft and unpublishes a live hotel', async () => {
    vi.mocked(adminHotelApi.changeStatus).mockImplementation(async (id, status) =>
      hotel({ id, status, name: id === 'h1' ? 'Sea Breeze Resort' : 'Hill View Inn' }));
    const { user } = open();

    await user.click(within(await rowOf('Hill View Inn')).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Hill View Inn is published.')).toBeInTheDocument();
    expect(adminHotelApi.changeStatus).toHaveBeenCalledWith('h2', 'ACTIVE');

    await user.click(within(await rowOf('Sea Breeze Resort')).getByRole('button', { name: 'Unpublish' }));
    expect(await screen.findByText('Sea Breeze Resort is no longer visible to customers.')).toBeInTheDocument();
    expect(adminHotelApi.changeStatus).toHaveBeenCalledWith('h1', 'INACTIVE');
  });

  it('lists what is missing when a hotel is not ready to publish', async () => {
    vi.mocked(adminHotelApi.changeStatus).mockRejectedValue(
      new ApiError(422, 'HOTEL_NOT_READY', 'Not ready', [], null, { missing: ['a cover photo', 'a room type with a rate plan'] }));
    const { user } = open();

    const row = await rowOf('Hill View Inn');
    await user.click(within(row).getByRole('button', { name: 'Publish' }));

    const alert = await within(row).findByRole('alert');
    expect(alert).toHaveTextContent('Not ready to publish');
    expect(alert).toHaveTextContent('Still missing: a cover photo, a room type with a rate plan.');
  });

  it('shows other publishing errors as they are', async () => {
    vi.mocked(adminHotelApi.changeStatus).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this.'));
    const { user } = open();

    const row = await rowOf('Hill View Inn');
    await user.click(within(row).getByRole('button', { name: 'Publish' }));

    expect(await within(row).findByRole('alert')).toHaveTextContent('You are not allowed to do this.');
  });
});

describe('AdminHotelsPage: managers', () => {
  it('lists, assigns and removes the hotel managers', async () => {
    vi.mocked(adminHotelApi.managers).mockResolvedValue([manager()]);
    vi.mocked(adminHotelApi.assignManager).mockResolvedValue([manager(), manager({ userId: 'u2', email: 'neha@example.com', firstName: 'Neha', lastName: 'Shah' })]);
    vi.mocked(adminHotelApi.unassignManager).mockResolvedValue([manager({ userId: 'u2', email: 'neha@example.com', firstName: 'Neha', lastName: 'Shah' })]);
    const { user } = open();

    const row = await rowOf('Sea Breeze Resort');
    const toggle = within(row).getByRole('button', { name: 'Managers' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    expect(await within(row).findByText('hari@example.com')).toBeInTheDocument();
    expect(adminHotelApi.managers).toHaveBeenCalledWith('h1');

    const email = within(row).getByRole('textbox', { name: /Assign by email/ });
    await user.type(email, ' neha@example.com ');
    await user.click(within(row).getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Manager assigned.')).toBeInTheDocument();
    expect(adminHotelApi.assignManager).toHaveBeenCalledWith('h1', 'neha@example.com');
    expect(email).toHaveValue('');
    expect(within(row).getByText('neha@example.com')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Remove hari@example.com' }));

    await waitFor(() => expect(within(row).queryByText('hari@example.com')).not.toBeInTheDocument());
    expect(adminHotelApi.unassignManager).toHaveBeenCalledWith('h1', 'u1');
  });

  it('says when nobody manages the hotel, ignores an empty e-mail and explains a failed assignment', async () => {
    vi.mocked(adminHotelApi.managers).mockResolvedValue([]);
    vi.mocked(adminHotelApi.assignManager).mockRejectedValue(
      new ApiError(422, 'NOT_A_HOTEL_MANAGER', 'This account does not have the Hotel manager role.'));
    const { user } = open();

    const row = await rowOf('Sea Breeze Resort');
    await user.click(within(row).getByRole('button', { name: 'Managers' }));
    expect(await within(row).findByText('Nobody manages this hotel yet.')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Assign' }));
    expect(adminHotelApi.assignManager).not.toHaveBeenCalled();

    await user.type(within(row).getByRole('textbox', { name: /Assign by email/ }), 'asha@example.com');
    await user.click(within(row).getByRole('button', { name: 'Assign' }));

    expect(await within(row).findByRole('alert')).toHaveTextContent('This account does not have the Hotel manager role.');
  });
});

describe('AdminHotelsPage: new hotel', () => {
  it('checks the required fields and creates a draft', async () => {
    vi.mocked(adminHotelApi.create).mockResolvedValue(hotel({ id: 'h3', name: 'Lighthouse Inn', status: 'DRAFT' }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'New hotel' }));
    expect(screen.queryByRole('button', { name: 'New hotel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('Enter the hotel name')).toBeInTheDocument();
    expect(screen.getByText('Enter the street address')).toBeInTheDocument();
    expect(screen.getByText('Enter the city')).toBeInTheDocument();
    expect(adminHotelApi.create).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Lighthouse Inn');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Property type' }), 'Resort');
    await user.selectOptions(screen.getByRole('combobox', { name: /Stars/ }), '4');
    await user.type(screen.getByRole('textbox', { name: 'Street address' }), '1 Harbour Road');
    await user.type(screen.getByRole('textbox', { name: 'City' }), 'Kochi');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('Lighthouse Inn was created as a draft. Add rooms, photos and a description, then publish it.'))
      .toBeInTheDocument();
    expect(vi.mocked(adminHotelApi.create).mock.calls[0]?.[0]).toEqual({
      name: 'Lighthouse Inn', propertyType: 'RESORT', addressLine: '1 Harbour Road', city: 'Kochi', countryCode: 'IN', starRating: 4,
    });
    expect(screen.queryByRole('button', { name: 'Create draft' })).not.toBeInTheDocument();
  });

  it('sends no star rating when not rated, shows server errors and can be cancelled', async () => {
    vi.mocked(adminHotelApi.create)
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [{ field: 'city', message: 'Unknown city' }]))
      .mockRejectedValueOnce(new ApiError(409, 'HOTEL_EXISTS', 'A hotel with this name already exists in this city.'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'New hotel' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Lighthouse Inn');
    await user.type(screen.getByRole('textbox', { name: 'Street address' }), '1 Harbour Road');
    await user.type(screen.getByRole('textbox', { name: 'City' }), 'Atlantis');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByText('Unknown city')).toBeInTheDocument();
    expect(vi.mocked(adminHotelApi.create).mock.calls[0]?.[0]).toMatchObject({ starRating: undefined, propertyType: 'HOTEL' });

    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText('A hotel with this name already exists in this city.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Create draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New hotel' })).toBeInTheDocument();
  });
});

describe('AdminHotelsPage: export', () => {
  it('exports the hotels on the page as CSV, one fact per column', async () => {
    const files = stubFileSaving();
    const { user } = open();
    await rowOf('Sea Breeze Resort');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Export hotels' })).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^hotels-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await files.blobs[0]!.text()).split('\r\n')).toEqual([
      '"Hotel","City","Status","Demo listing","Room types","Managers","Updated"',
      '"Sea Breeze Resort","Goa","Published","No",1,2,2026-11-01',
      '"Hill View Inn","Shimla","Draft","Yes",3,1,2026-11-01',
      '',
    ]);
  });

  it('exports every matching hotel through the same list, with the search and status the screen uses', async () => {
    const files = stubFileSaving();
    const all = [hotel(), hotel({ id: 'h2', name: 'Goa Palms' }), hotel({ id: 'h3', name: 'Goa Sands' })];
    // A server that answers 2 hotels per page, whatever the size asked.
    vi.mocked(adminHotelApi.list).mockImplementation(async (query) => pageOf(all.slice(query.page * 2, query.page * 2 + 2),
      { page: query.page, size: 2, totalElements: 3, totalPages: 2 }));
    const { user } = open();
    await rowOf('Sea Breeze Resort');
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'goa');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Published');
    await waitFor(() => expect(adminHotelApi.list).toHaveBeenLastCalledWith({ search: 'goa', status: 'ACTIVE', page: 0 }, 25));

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export hotels' });
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^Excel/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(adminHotelApi.list).toHaveBeenCalledWith({ search: 'goa', status: 'ACTIVE', page: 0 }, 100);
    expect(adminHotelApi.list).toHaveBeenCalledWith({ search: 'goa', status: 'ACTIVE', page: 1 }, 100);
    const workbook = unzipSync(new Uint8Array(await files.blobs[0]!.arrayBuffer()));
    const sheet = strFromU8(workbook['xl/worksheets/sheet1.xml']!);
    for (const name of ['Sea Breeze Resort', 'Goa Palms', 'Goa Sands']) expect(sheet).toContain(name);
    const about = strFromU8(workbook['xl/worksheets/sheet2.xml']!);
    for (const text of ['Hotels', 'Admin portal', 'Search', 'goa', 'Status', 'Published', 'All 3 rows matching the filters']) {
      expect(about).toContain(text);
    }
  });
});
