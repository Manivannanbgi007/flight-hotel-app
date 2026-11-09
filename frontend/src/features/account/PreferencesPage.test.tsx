import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { accountApi } from './accountApi';
import { PreferencesPage } from './PreferencesPage';
import type { TravelPreferences } from './types';

vi.mock('./accountApi', () => ({ accountApi: { getPreferences: vi.fn(), updatePreferences: vi.fn() } }));

const stored: TravelPreferences = {
  preferredCabin: 'ECONOMY', homeAirport: 'BLR', seatPreference: 'WINDOW', mealPreference: 'VEGETARIAN',
  preferredCurrency: 'INR', newsletterOptIn: true,
};

describe('PreferencesPage', () => {
  it('no longer shows the newsletter box but sends the stored value back unchanged', async () => {
    vi.mocked(accountApi.getPreferences).mockResolvedValue(stored);
    vi.mocked(accountApi.updatePreferences).mockImplementation(async (body) => body);
    const { user } = renderRoutes([{ path: '/account/preferences', element: <PreferencesPage /> }],
      { path: '/account/preferences', auth: fakeAuth({ user: customer }) });

    await user.selectOptions(await screen.findByLabelText(/Seat/), 'AISLE');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'notification settings' })).toHaveAttribute('href', '/account/notifications/settings');

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(accountApi.updatePreferences).toHaveBeenCalledWith({ ...stored, seatPreference: 'AISLE' }));
  });

  const open = () => renderRoutes([{ path: '/account/preferences', element: <PreferencesPage /> }],
    { path: '/account/preferences', auth: fakeAuth({ user: customer }) });
  const empty: TravelPreferences = {
    preferredCabin: null, homeAirport: null, seatPreference: null, mealPreference: null, preferredCurrency: 'INR', newsletterOptIn: false,
  };

  it('starts with nothing chosen, upper-cases the airport code and sends unset fields as null', async () => {
    vi.mocked(accountApi.getPreferences).mockResolvedValue(empty);
    vi.mocked(accountApi.updatePreferences).mockImplementation(async (body) => body);
    const { user } = open();

    expect(await screen.findByRole('combobox', { name: /Preferred cabin/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /Meal/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: /Home airport/ }), 'maa');
    await user.selectOptions(screen.getByRole('combobox', { name: /Preferred cabin/ }), 'Business');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Your preferences were saved.')).toBeInTheDocument();
    expect(accountApi.updatePreferences).toHaveBeenCalledWith({ ...empty, preferredCabin: 'BUSINESS', homeAirport: 'MAA' });
    // What the server stored is shown, and there is nothing left to save.
    expect(screen.getByRole('textbox', { name: /Home airport/ })).toHaveValue('MAA');
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  });

  it('needs a 3-letter airport code, and shows the server checks on the field', async () => {
    vi.mocked(accountApi.getPreferences).mockResolvedValue(empty);
    vi.mocked(accountApi.updatePreferences).mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [{ field: 'homeAirport', message: 'Unknown airport' }]));
    const { user } = open();

    const airport = await screen.findByRole('textbox', { name: /Home airport/ });
    expect(airport).toHaveAccessibleDescription('3-letter airport code');
    await user.type(airport, 'B1');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Use the 3-letter airport code, e.g. BLR')).toBeInTheDocument();
    expect(accountApi.updatePreferences).not.toHaveBeenCalled();

    await user.clear(airport);
    await user.type(airport, 'XYZ');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Unknown airport')).toBeInTheDocument();
    expect(airport).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows other save failures above the form', async () => {
    vi.mocked(accountApi.getPreferences).mockResolvedValue(stored);
    vi.mocked(accountApi.updatePreferences).mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Please try again in a minute.'));
    const { user } = open();

    await user.selectOptions(await screen.findByRole('combobox', { name: /Meal/ }), 'Vegan');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again in a minute.');
  });

  it('offers a retry with the support reference when the preferences cannot be loaded', async () => {
    vi.mocked(accountApi.getPreferences)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.', [], 'corr-77'))
      .mockResolvedValueOnce(stored);
    const { user } = open();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Support reference: corr-77');
    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('combobox', { name: /Seat/ })).toHaveValue('WINDOW');
  });
});
