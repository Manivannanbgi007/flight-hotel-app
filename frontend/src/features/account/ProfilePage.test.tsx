import { screen, waitFor, within } from '@testing-library/react';

import { authApi } from '@/features/auth/authApi';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { AccountLayout } from './AccountLayout';
import { CustomerAreaLayout } from './CustomerAreaLayout';
import { accountApi } from './accountApi';
import { ProfilePage } from './ProfilePage';
import type { Profile } from './types';

vi.mock('./accountApi', () => ({
  accountApi: { getProfile: vi.fn(), updateProfile: vi.fn(), uploadPhoto: vi.fn(), deletePhoto: vi.fn(), getPhoto: vi.fn() },
}));

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: customer.id, email: 'asha@example.com', firstName: 'Asha', lastName: 'Rao', phone: null, dateOfBirth: null,
  nationality: null, roles: ['CUSTOMER'], emailVerified: true, hasPhoto: false, memberSince: '2024-03-15T10:00:00Z',
  ...overrides,
});

/** The profile page inside the "My account" layout, as in app/router.tsx. */
function openProfile(auth = fakeAuth({ user: customer })) {
  return renderRoutes([{
    element: <CustomerAreaLayout />,
    children: [{
      path: '/account',
      element: <AccountLayout />,
      children: [
        { path: 'profile', element: <ProfilePage /> },
        { path: '*', element: <p>other account page</p> },
      ],
    }],
  }], { path: '/account/profile', auth });
}

const png = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

/** One tile of the account facts (a `dt` with its `dd`s). */
const fact = (term: string) => screen.getByText(term, { selector: 'dt' }).closest('dl > div') as HTMLElement;

describe('My account layout (in the customer area)', () => {
  it('lists the customer pages in groups, marks the open one and shows who is signed in', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    openProfile();

    const nav = screen.getAllByRole('navigation', { name: 'My account' })[0]!;
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Dashboard', 'My trips', 'Payment history', 'My reviews', 'Profile', 'Saved passengers', 'Travel preferences', 'Security',
    ]);
    // Notifications and support tickets are submenus (closed on another page).
    expect(within(nav).getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).getByRole('button', { name: 'Support tickets' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Security' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('complementary', { name: 'My account pages' })).toHaveTextContent('Asha RaoCustomer');
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
  });

  it('opens a submenu, and opens the pages in a drawer on phones and tablets', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    const { user } = openProfile();

    const nav = screen.getAllByRole('navigation', { name: 'My account' })[0]!;
    await user.click(within(nav).getByRole('button', { name: 'Support tickets' }));
    expect(within(nav).getByRole('link', { name: 'My tickets' })).toHaveAttribute('href', '/account/support');
    expect(within(nav).getByRole('link', { name: 'New ticket' })).toHaveAttribute('href', '/account/support/new');

    await user.click(screen.getByRole('button', { name: 'My account menu' }));
    const drawer = screen.getByRole('dialog', { name: 'My account navigation' });
    expect(within(drawer).getByRole('navigation', { name: 'My account' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ProfilePage: personal details', () => {
  it('shows the account e-mail, its verification and the membership date', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile({ emailVerified: false }));
    openProfile();

    expect(await screen.findByText('asha@example.com')).toBeInTheDocument();
    expect(fact('Sign-in e-mail')).toHaveTextContent(/asha@example\.com\s*Not verified/);
    expect(fact('Member since')).toHaveTextContent('March 2024');
    expect(screen.getByLabelText('First name')).toHaveValue('Asha');
    // The fields come in named groups.
    expect(screen.getByRole('group', { name: 'Name on your ID' })).toContainElement(screen.getByLabelText('Last name'));
    expect(screen.getByRole('group', { name: 'Contact' })).toContainElement(screen.getByLabelText(/Mobile number/));
    expect(screen.getByRole('group', { name: 'About you' })).toContainElement(screen.getByLabelText(/Nationality/));
    // Nothing changed yet: nothing to save or discard.
    expect(screen.getByText('Everything is saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it('sends a new verification link when the e-mail is not verified', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile({ emailVerified: false }));
    const resend = vi.spyOn(authApi, 'resendVerification').mockResolvedValue({ message: 'We sent you a new link.' });
    const { user } = openProfile();

    await user.click(await screen.findByRole('button', { name: 'Send the verification link again' }));

    // Announced in the status region that was there from the start; the button is gone.
    expect(await within(fact('Sign-in e-mail')).findByRole('status')).toHaveTextContent('We sent you a new link.');
    expect(resend).toHaveBeenCalledWith('asha@example.com');
    expect(screen.queryByRole('button', { name: 'Send the verification link again' })).not.toBeInTheDocument();
  });

  it('offers no new verification link for a verified e-mail', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    openProfile();

    expect(await screen.findByLabelText('First name')).toHaveValue('Asha');
    expect(fact('Sign-in e-mail')).toHaveTextContent(/asha@example\.com\s*Verified/);
    expect(screen.queryByRole('button', { name: 'Send the verification link again' })).not.toBeInTheDocument();
  });

  it('saves the changes with a normalized phone, leaves empty fields out and updates the header name', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    vi.mocked(accountApi.updateProfile).mockResolvedValue(profile({ firstName: 'Ashwini', phone: '+919876543210' }));
    const auth = fakeAuth({ user: customer });
    const { user } = openProfile(auth);

    const firstName = await screen.findByLabelText('First name');
    await user.clear(firstName);
    await user.type(firstName, 'Ashwini');
    await user.type(screen.getByLabelText(/Mobile number/), '+91 98765-43210');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Your profile was saved.')).toBeInTheDocument();
    expect(vi.mocked(accountApi.updateProfile).mock.calls[0]?.[0]).toEqual({
      firstName: 'Ashwini', lastName: 'Rao', phone: '+919876543210', dateOfBirth: undefined, nationality: undefined,
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ firstName: 'Ashwini', lastName: 'Rao' });
    // The form shows what the server stored and is clean again.
    expect(screen.getByLabelText(/Mobile number/)).toHaveValue('+919876543210');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('checks the fields before sending', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    const { user } = openProfile();

    await user.clear(await screen.findByLabelText('Last name'));
    await user.type(screen.getByLabelText(/Mobile number/), '12ab');
    await user.type(screen.getByLabelText(/Date of birth/), '2999-01-01');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Enter your last name')).toBeInTheDocument();
    expect(screen.getByText('Enter 7–15 digits, optionally starting with +')).toBeInTheDocument();
    expect(screen.getByText('The date of birth must be in the past')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toHaveAttribute('aria-invalid', 'true');
    expect(accountApi.updateProfile).not.toHaveBeenCalled();
  });

  it('puts server validation errors on the fields and shows other errors above the form', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    vi.mocked(accountApi.updateProfile)
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [{ field: 'phone', message: 'This number is not valid in India' }]))
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Our profile service is busy. Try again in a minute.'));
    const { user } = openProfile();

    await user.type(await screen.findByLabelText(/Mobile number/), '0000000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('This number is not valid in India')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Our profile service is busy. Try again in a minute.');
  });

  it('discards unsaved changes', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile({ phone: '+919876543210' }));
    const { user } = openProfile();

    const phone = await screen.findByLabelText(/Mobile number/);
    await user.clear(phone);
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(phone).toHaveValue('+919876543210');
    expect(screen.getByText('Everything is saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it('offers a retry with the support reference when the profile cannot be loaded', async () => {
    vi.mocked(accountApi.getProfile)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Try again later.', [], 'corr-123'))
      .mockResolvedValueOnce(profile());
    const { user } = openProfile();

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Try again later.');
    expect(error).toHaveTextContent('Support reference: corr-123');

    await user.click(within(error).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
  });
});

describe('ProfilePage: checklist', () => {
  it('counts the saved details and takes the customer to a missing field', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile({ phone: '+919876543210' }));
    const { user } = openProfile();

    const checklist = await screen.findByRole('region', { name: 'Profile checklist' });
    expect(checklist).toHaveTextContent('3 of 6 done');
    expect(within(checklist).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Done: Your name',
      'Done: Verified e-mail',
      'To do: Profile photoAdd',
      'Done: Mobile number',
      'To do: Date of birthAdd',
      'To do: NationalityAdd',
    ]);

    await user.click(within(checklist).getByRole('button', { name: 'Add nationality' }));
    expect(screen.getByLabelText(/Nationality/)).toHaveFocus();
    await user.click(within(checklist).getByRole('button', { name: 'Add date of birth' }));
    expect(screen.getByLabelText(/Date of birth/)).toHaveFocus();
  });

  it('opens the photo picker for a missing photo', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    const { user } = openProfile();

    const checklist = await screen.findByRole('region', { name: 'Profile checklist' });
    const pick = vi.spyOn(screen.getByLabelText('Choose a profile photo'), 'click');
    await user.click(within(checklist).getByRole('button', { name: 'Add profile photo' }));

    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('says so when everything is there, with nothing left to add', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(
      profile({ phone: '+919876543210', dateOfBirth: '1990-05-01', nationality: 'IN', hasPhoto: true }),
    );
    vi.mocked(accountApi.getPhoto).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    openProfile();

    const checklist = await screen.findByRole('region', { name: 'Profile checklist' });
    expect(checklist).toHaveTextContent('6 of 6 done');
    expect(checklist).toHaveTextContent('Your profile is complete.');
    expect(within(checklist).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ProfilePage: photo', () => {
  it('shows the initials when there is no photo, and uploads a new one', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    vi.mocked(accountApi.uploadPhoto).mockResolvedValue(profile({ hasPhoto: true }));
    const auth = fakeAuth({ user: customer });
    const { user } = openProfile(auth);

    // The layout's header shows the same initials: look inside the photo card.
    const photoCard = await screen.findByRole('region', { name: 'Profile photo' });
    expect(within(photoCard).getByText('AR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    const photo = png('me.png', 1024);
    await user.upload(screen.getByLabelText('Choose a profile photo'), photo);

    expect(await screen.findByText('Your photo was updated.')).toBeInTheDocument();
    expect(vi.mocked(accountApi.uploadPhoto).mock.calls[0]?.[0]).toBe(photo);
    expect(auth.updateUser).toHaveBeenCalledWith({ hasPhoto: true });
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
  });

  it('refuses a photo over 2 MB without uploading it', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    const { user } = openProfile();

    await user.upload(await screen.findByLabelText('Choose a profile photo'), png('huge.png', 2 * 1024 * 1024 + 1));

    expect(await screen.findByText('The photo is too large. The maximum size is 2 MB.')).toBeInTheDocument();
    expect(accountApi.uploadPhoto).not.toHaveBeenCalled();
  });

  it('explains a failed upload', async () => {
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile());
    vi.mocked(accountApi.uploadPhoto).mockRejectedValue(new ApiError(415, 'UNSUPPORTED_IMAGE', 'Only JPEG and PNG images are accepted.'));
    const { user } = openProfile();

    await user.upload(await screen.findByLabelText('Choose a profile photo'), png('me.png', 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only JPEG and PNG images are accepted.');
  });

  it('shows the stored photo and removes it', async () => {
    stubFileSaving();
    const withPhoto = { ...customer, hasPhoto: true };
    vi.mocked(accountApi.getProfile).mockResolvedValue(profile({ hasPhoto: true }));
    vi.mocked(accountApi.getPhoto).mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
    vi.mocked(accountApi.deletePhoto).mockResolvedValue(undefined);
    const auth = fakeAuth({ user: withPhoto });
    const { user, container } = openProfile(auth);

    await waitFor(() => expect(container.querySelector('img[src^="blob:"]')).not.toBeNull());
    expect(screen.queryByText('AR')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Your photo was removed.')).toBeInTheDocument();
    expect(accountApi.deletePhoto).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledWith({ hasPhoto: false });
  });
});
