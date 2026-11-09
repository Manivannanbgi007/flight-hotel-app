import { screen, within } from '@testing-library/react';

import { hotelApi } from '@/features/hotels/hotelApi';
import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { HotelProfilePage } from './HotelProfilePage';
import { managerApi } from './managerApi';
import type { HotelProfile } from './types';

vi.mock('./managerApi', () => ({ managerApi: { profile: vi.fn(), updateProfile: vi.fn() } }));
vi.mock('@/features/hotels/hotelApi', () => ({ hotelApi: { amenities: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', roles: ['HOTEL_MANAGER'] };

const profile = (overrides: Partial<HotelProfile> = {}): HotelProfile => ({
  id: 'h1', name: 'Sea Breeze Resort', slug: 'sea-breeze-resort-goa', description: 'A relaxed beach resort.', propertyType: 'RESORT',
  starRating: 4, addressLine: 'Beach Road', city: 'Goa', state: 'Goa', countryCode: 'IN', postalCode: null, latitude: 15.54,
  longitude: 73.76, timeZone: 'Asia/Kolkata', checkInTime: '14:00:00', checkOutTime: '11:00:00', contactEmail: null,
  contactPhone: null, amenities: ['POOL'], policies: [{ type: 'PETS', description: 'No pets.' }], status: 'ACTIVE',
  dataSource: 'INTERNAL', images: [], version: 3, ...overrides,
});

const open = () => renderRoutes([{ path: '/hotel-manager/hotels/:hotelId/profile', element: <HotelProfilePage /> }],
  { path: '/hotel-manager/hotels/h1/profile', auth: fakeAuth({ user: manager }) });

const save = () => screen.getByRole('button', { name: 'Save profile' });

beforeEach(() => {
  vi.mocked(hotelApi.amenities).mockResolvedValue([
    { code: 'POOL', name: 'Swimming pool', category: 'HOTEL' },
    { code: 'SPA', name: 'Spa', category: 'HOTEL' },
    { code: 'MINIBAR', name: 'Minibar', category: 'ROOM' },
  ]);
});

describe('HotelProfilePage', () => {
  it('shows the stored profile, with hotel amenities only and nothing to save yet', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    open();

    expect(await screen.findByRole('textbox', { name: 'Hotel name' })).toHaveValue('Sea Breeze Resort');
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Property type' })).toHaveValue('RESORT');
    expect(screen.getByLabelText('Check-in from')).toHaveValue('14:00');
    expect(await screen.findByRole('checkbox', { name: 'Swimming pool' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Spa' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Minibar' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Rule' })).toHaveValue('No pets.');
    expect(screen.queryByText(/This is a demo listing/)).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(managerApi.profile).toHaveBeenCalledWith('h1');
  });

  it('warns that a demo listing stays marked as demo', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile({ dataSource: 'DEMO', status: 'DRAFT' }));
    open();

    expect(await screen.findByText(/This is a demo listing/)).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('saves the edited profile with the version it was loaded with', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    vi.mocked(managerApi.updateProfile).mockImplementation(async (_id, body) => profile({ ...body, version: 4,
      contactEmail: body.contactEmail ?? null, contactPhone: body.contactPhone ?? null, description: body.description ?? null,
      state: body.state ?? null, postalCode: body.postalCode ?? null, starRating: body.starRating ?? null,
      latitude: body.latitude ?? null, longitude: body.longitude ?? null }));
    const { user } = open();

    const name = await screen.findByRole('textbox', { name: 'Hotel name' });
    await user.clear(name);
    await user.type(name, '  Sea Breeze Resort & Spa ');
    await user.selectOptions(screen.getByRole('combobox', { name: /Star rating/ }), '5 stars');
    await user.type(screen.getByRole('textbox', { name: /Contact email/ }), 'stay@seabreeze.example');
    await user.type(screen.getByRole('textbox', { name: /Contact phone/ }), '+91 832-200 0000');
    await user.click(await screen.findByRole('checkbox', { name: 'Spa' }));
    await user.click(screen.getByRole('button', { name: /Add rule/ }));
    const rules = screen.getAllByRole('textbox', { name: 'Rule' });
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Type' })[1]!, 'Smoking');
    await user.type(rules[1]!, 'No smoking indoors.');
    await user.click(save());

    expect(await screen.findByText('The hotel profile was saved. Search results update within seconds.')).toBeInTheDocument();
    expect(managerApi.updateProfile).toHaveBeenCalledWith('h1', {
      name: 'Sea Breeze Resort & Spa', description: 'A relaxed beach resort.', propertyType: 'RESORT', starRating: 5,
      addressLine: 'Beach Road', city: 'Goa', state: 'Goa', countryCode: 'IN', postalCode: undefined, latitude: 15.54,
      longitude: 73.76, checkInTime: '14:00', checkOutTime: '11:00', contactEmail: 'stay@seabreeze.example',
      contactPhone: '+918322000000', amenities: ['POOL', 'SPA'],
      policies: [{ type: 'PETS', description: 'No pets.' }, { type: 'SMOKING', description: 'No smoking indoors.' }], version: 3,
    });
    // The form now shows the stored version and is clean again.
    expect(await screen.findByRole('textbox', { name: 'Hotel name' })).toHaveValue('Sea Breeze Resort & Spa');
    expect(save()).toBeDisabled();
  });

  it('says when there are unsaved changes and discards them', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    const { user } = open();

    const name = await screen.findByRole('textbox', { name: 'Hotel name' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();

    await user.type(name, ' & Spa');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(save()).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(name).toHaveValue('Sea Breeze Resort');
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(managerApi.updateProfile).not.toHaveBeenCalled();
  });

  it('counts the chosen amenities', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    const { user } = open();

    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Spa' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('ticks the sections guests have what they need from, in the page guide', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    const { user } = open();

    const guide = await screen.findByRole('navigation', { name: 'On this page' });
    expect(within(guide).getByRole('link', { name: 'Basic information, complete' })).toHaveAttribute('href', '#profile-basics');
    expect(within(guide).getByRole('link', { name: 'Address and location, complete' })).toBeInTheDocument();
    // No contact email or phone yet.
    expect(within(guide).getByRole('link', { name: 'Stay and contact, to do' })).toBeInTheDocument();
    expect(within(guide).getByRole('link', { name: 'Amenities, complete' })).toBeInTheDocument();
    expect(within(guide).getByRole('link', { name: 'House rules, complete' })).toBeInTheDocument();
    expect(within(guide).getByText('4 of 5')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /Contact phone/ }), '+91 832 200 0000');
    expect(within(guide).getByRole('link', { name: 'Stay and contact, complete' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));
    expect(within(guide).getByRole('link', { name: 'House rules, to do' })).toBeInTheDocument();
    expect(within(guide).getByText('4 of 5')).toBeInTheDocument();
  });

  it('checks the fields before saving', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile({ latitude: null, longitude: null }));
    const { user } = open();

    await user.clear(await screen.findByRole('textbox', { name: 'Hotel name' }));
    await user.clear(screen.getByRole('textbox', { name: 'City' }));
    await user.type(screen.getByRole('textbox', { name: 'Latitude' }), '15.49');
    await user.type(screen.getByRole('textbox', { name: /Contact email/ }), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Add rule/ }));
    await user.click(save());

    expect(await screen.findByText('Enter the hotel name')).toBeInTheDocument();
    expect(screen.getByText('Enter the city')).toBeInTheDocument();
    expect(screen.getByText('Give both latitude and longitude, or neither')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Describe the rule')).toBeInTheDocument();
    expect(managerApi.updateProfile).not.toHaveBeenCalled();
  });

  it('removes a house rule', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    vi.mocked(managerApi.updateProfile).mockResolvedValue(profile({ policies: [], version: 4 }));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Remove rule 1' }));
    expect(screen.getByText('No rules yet.')).toBeInTheDocument();
    await user.click(save());

    expect(await screen.findByText(/The hotel profile was saved/)).toBeInTheDocument();
    expect(vi.mocked(managerApi.updateProfile).mock.calls[0]?.[1]).toMatchObject({ policies: [] });
  });

  it('explains that someone else saved meanwhile', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    vi.mocked(managerApi.updateProfile).mockRejectedValue(new ApiError(409, 'CONCURRENT_MODIFICATION', 'Conflict'));
    const { user } = open();

    await user.type(await screen.findByRole('textbox', { name: /Postal code/ }), '403516');
    await user.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else saved this hotel meanwhile. Reload the page to see their changes.');
  });

  it('puts server validation errors on the fields', async () => {
    vi.mocked(managerApi.profile).mockResolvedValue(profile());
    vi.mocked(managerApi.updateProfile).mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [{ field: 'contactEmail', message: 'This domain does not accept mail' }]));
    const { user } = open();

    const email = await screen.findByRole('textbox', { name: /Contact email/ });
    await user.type(email, 'stay@nowhere.example');
    await user.click(save());

    expect(await screen.findByText('This domain does not accept mail')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
  });

  it('offers a retry when the profile cannot be loaded', async () => {
    vi.mocked(managerApi.profile)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hotel service is not reachable.', [], 'corr-9'))
      .mockResolvedValueOnce(profile());
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Hotel service is not reachable.');
    expect(error).toHaveTextContent('Support reference: corr-9');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('textbox', { name: 'Hotel name' })).toHaveValue('Sea Breeze Resort');
  });
});
