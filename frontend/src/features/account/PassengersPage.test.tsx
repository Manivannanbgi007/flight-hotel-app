import { screen, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { accountApi } from './accountApi';
import { PassengersPage } from './PassengersPage';
import type { Passenger } from './types';

vi.mock('./accountApi', () => ({
  accountApi: {
    listPassengers: vi.fn(),
    createPassenger: vi.fn(),
    updatePassenger: vi.fn(),
    deletePassenger: vi.fn(),
  },
}));

const stored: Passenger = {
  id: 'p1',
  passengerType: 'ADULT',
  firstName: 'Asha',
  lastName: 'Rao',
  dateOfBirth: '1994-05-17',
  gender: 'FEMALE',
  nationality: 'IN',
  hasPassport: true,
  passportNumberMasked: '••••4567',
  passportExpiry: '2031-01-31',
  passportCountry: 'IN',
};

function renderPage() {
  return renderRoutes([{ path: '/account/passengers', element: <PassengersPage /> }], {
    path: '/account/passengers',
    auth: fakeAuth({ user: customer }),
  });
}

describe('PassengersPage', () => {
  it('lists passengers with the passport masked', async () => {
    vi.mocked(accountApi.listPassengers).mockResolvedValue([stored]);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('Born 17 May 1994 · India')).toBeInTheDocument();
    expect(screen.getByText('Passport ••••4567, India, valid until 31 Jan 2031')).toBeInTheDocument();
  });

  it('adds a passenger; passport fields must be complete', async () => {
    vi.mocked(accountApi.listPassengers).mockResolvedValue([]);
    vi.mocked(accountApi.createPassenger).mockResolvedValue({ ...stored, id: 'p2', firstName: 'Ravi' });
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add passenger' }));
    const form = screen.getByRole('form', { name: 'New passenger' });
    await user.type(within(form).getByLabelText('First name'), 'Ravi');
    await user.type(within(form).getByLabelText('Last name'), 'Rao');
    await user.type(within(form).getByLabelText(/Passport number/), 'z1234567');
    await user.click(within(form).getByRole('button', { name: 'Add passenger' }));

    expect(await within(form).findByText('Enter the expiry date')).toBeInTheDocument();
    expect(within(form).getByText('Choose the issuing country')).toBeInTheDocument();
    expect(accountApi.createPassenger).not.toHaveBeenCalled();

    await user.type(within(form).getByLabelText('Expiry date'), '2099-01-31');
    await user.selectOptions(within(form).getByLabelText('Issuing country'), 'IN');
    await user.click(within(form).getByRole('button', { name: 'Add passenger' }));

    expect(await screen.findByText('Ravi was added.')).toBeInTheDocument();
    expect(vi.mocked(accountApi.createPassenger).mock.calls[0]?.[0]).toEqual({
      passengerType: 'ADULT',
      firstName: 'Ravi',
      lastName: 'Rao',
      dateOfBirth: undefined,
      gender: undefined,
      nationality: undefined,
      passportNumber: 'Z1234567',
      passportExpiry: '2099-01-31',
      passportCountry: 'IN',
      removePassport: false,
    });
  });

  it('editing keeps the stored passport number unless a new one is typed', async () => {
    vi.mocked(accountApi.listPassengers).mockResolvedValue([stored]);
    vi.mocked(accountApi.updatePassenger).mockResolvedValue(stored);
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit Asha Rao' }));
    const form = screen.getByRole('form', { name: 'Edit Asha Rao' });
    expect(within(form).getByLabelText(/Passport number/)).toHaveValue('');
    expect(within(form).getByText('Leave empty to keep the stored number.')).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save passenger' }));

    expect(await screen.findByText('Asha was updated.')).toBeInTheDocument();
    expect(accountApi.updatePassenger).toHaveBeenCalledWith('p1', expect.objectContaining({
      passportNumber: undefined,
      passportExpiry: '2031-01-31',
      passportCountry: 'IN',
      removePassport: false,
    }));
  });

  it('removes a passenger after confirmation', async () => {
    vi.mocked(accountApi.listPassengers).mockResolvedValue([stored]);
    vi.mocked(accountApi.deletePassenger).mockResolvedValue(undefined);
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove Asha Rao' }));
    expect(accountApi.deletePassenger).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Asha was removed.')).toBeInTheDocument();
    expect(accountApi.deletePassenger).toHaveBeenCalledTimes(1);
  });

  it('shows the server message when the limit is reached', async () => {
    vi.mocked(accountApi.listPassengers).mockResolvedValue([]);
    vi.mocked(accountApi.createPassenger).mockRejectedValue(
      new ApiError(422, 'PASSENGER_LIMIT_REACHED', 'You can save up to 20 passengers. Remove one to add another.'),
    );
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add passenger' }));
    const form = screen.getByRole('form', { name: 'New passenger' });
    await user.type(within(form).getByLabelText('First name'), 'Kid');
    await user.type(within(form).getByLabelText('Last name'), 'Rao');
    await user.click(within(form).getByRole('button', { name: 'Add passenger' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('You can save up to 20 passengers');
  });
});
