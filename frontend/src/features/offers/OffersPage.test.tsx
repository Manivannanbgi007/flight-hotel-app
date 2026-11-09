import { screen, within } from '@testing-library/react';

import { AboutPage } from '@/features/about/AboutPage';
import { ApiError } from '@/lib/api/apiError';
import { renderRoutes } from '@/test/renderRoutes';
import { offerApi, type Offer } from './offerApi';
import { OffersPage } from './OffersPage';

vi.mock('./offerApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./offerApi')>()),
  offerApi: { list: vi.fn() },
}));
vi.mock('@/features/settings/usePublicSettings', () => ({
  usePublicSettings: () => ({ settings: { siteName: 'FlightHotel' }, isLoading: false }),
}));

const offer = (overrides: Partial<Offer> = {}): Offer => ({
  id: 'o1', title: 'Welcome offer', description: '10% off your first booking.', couponCode: 'WELCOME10',
  discountLabel: '10% off, up to ₹1,500', minBookingAmount: 0, appliesTo: 'ALL', destinationCity: null,
  validTo: '2099-12-31T10:00:00Z', seasonal: false, theme: 'OCEAN', demo: true, ...overrides,
});

const open = () => renderRoutes([{ path: '/offers', element: <OffersPage /> }], { path: '/offers' });

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(writeText) } });
  return () => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Reflect.deleteProperty(navigator, 'clipboard');
  };
}

describe('OffersPage', () => {
  it('shows each offer with its code, conditions, validity and where to use it', async () => {
    vi.mocked(offerApi.list).mockResolvedValue([
      offer(),
      offer({ id: 'o2', title: 'Goa monsoon', couponCode: 'GOA15', discountLabel: '15% off', appliesTo: 'HOTEL', destinationCity: 'Goa',
        seasonal: true, theme: 'SUNSET', minBookingAmount: 5000, demo: false }),
      offer({ id: 'o3', title: 'Fly for less', couponCode: 'FLY500', discountLabel: '₹500 off', appliesTo: 'FLIGHT', theme: 'CITY', demo: false }),
    ]);
    open();

    const list = await screen.findByRole('list', { name: 'Offers' });
    const [welcome, goa, fly] = within(list).getAllByRole('listitem').filter((item) => item.parentElement === list);

    expect(within(welcome!).getByRole('heading', { level: 2, name: 'Welcome offer' })).toBeInTheDocument();
    expect(within(welcome!).getByText('10% off, up to ₹1,500')).toBeInTheDocument();
    expect(within(welcome!).getByText('WELCOME10')).toBeInTheDocument();
    expect(within(welcome!).getByText('Demo offer')).toBeInTheDocument();
    expect(within(welcome!).getByText('Hotels and flights')).toBeInTheDocument();
    expect(within(welcome!).getByText('Valid until 31 Dec 2099')).toBeInTheDocument();
    expect(within(welcome!).getByRole('link', { name: 'Find a hotel' })).toHaveAttribute('href', '/hotels');
    expect(within(welcome!).getByRole('link', { name: 'Find a flight' })).toHaveAttribute('href', '/flights');

    expect(within(goa!).getByText('Seasonal')).toBeInTheDocument();
    expect(within(goa!).getByText('Hotels only')).toBeInTheDocument();
    expect(within(goa!).getByText('Stays in Goa')).toBeInTheDocument();
    expect(within(goa!).getByText('Bookings of ₹5,000 or more')).toBeInTheDocument();
    expect(within(goa!).getByRole('link', { name: 'Find hotels in Goa' })).toHaveAttribute('href',
      expect.stringMatching(/^\/hotels\/search\?destination=Goa&checkIn=/));
    expect(within(goa!).queryByRole('link', { name: 'Find a flight' })).not.toBeInTheDocument();

    expect(within(fly!).getByRole('link', { name: 'Find a flight' })).toHaveAttribute('href', '/flights');
    expect(within(fly!).queryByRole('link', { name: /hotel/i })).not.toBeInTheDocument();
  });

  it('copies a coupon code', async () => {
    vi.mocked(offerApi.list).mockResolvedValue([offer()]);
    // After open(): user-event installs its own clipboard when it is set up.
    const { user } = open();
    const restore = stubClipboard(async () => {});
    try {
      await user.click(await screen.findByRole('button', { name: 'Copy code WELCOME10' }));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('WELCOME10');
      expect(await screen.findByText('Code WELCOME10 copied.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy code WELCOME10' })).toHaveTextContent('Copied');
    } finally {
      restore();
    }
  });

  it('shows the code to type when the browser does not allow copying', async () => {
    vi.mocked(offerApi.list).mockResolvedValue([offer()]);
    const { user } = open();
    const restore = stubClipboard(async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    });
    try {
      await user.click(await screen.findByRole('button', { name: 'Copy code WELCOME10' }));

      expect(await screen.findByText('Could not copy. The code is WELCOME10.')).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('says when there are no offers', async () => {
    vi.mocked(offerApi.list).mockResolvedValue([]);
    open();

    expect(await screen.findByText('No offers right now')).toBeInTheDocument();
  });

  it('shows the support reference when offers cannot be loaded', async () => {
    vi.mocked(offerApi.list).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.', [], 'corr-3'));
    open();

    expect(await screen.findByText('Support reference: corr-3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('AboutPage', () => {
  it('describes the service and links to help and contact', () => {
    renderRoutes([{ path: '/about', element: <AboutPage /> }], { path: '/about' });

    expect(screen.getByRole('heading', { level: 1, name: 'About us' })).toBeInTheDocument();
    expect(screen.getByText(/FlightHotel helps you book flights and hotels/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Help & Support' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: 'contact us' })).toHaveAttribute('href', '/contact');
  });
});
