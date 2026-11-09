import { screen, waitFor, within } from '@testing-library/react';

import { bookingApi } from '@/features/bookings/bookingApi';
import { BookingDetailsPage } from '@/features/bookings/BookingDetailsPage';
import { MyTripsPage } from '@/features/bookings/MyTripsPage';
import { bookingFixture, summaryFixture } from '@/features/bookings/testData';
import { paymentApi } from '@/features/payments/paymentApi';
import { ApiError } from '@/lib/api/apiError';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { MyReviewsPage } from './MyReviewsPage';
import { reviewApi } from './reviewApi';
import type { EligibleStay, MyReview } from './types';
import { WriteReviewPage } from './WriteReviewPage';

vi.mock('./reviewApi', () => ({
  reviewApi: { eligible: vi.fn(), create: vi.fn(), mine: vi.fn(), report: vi.fn(), forHotel: vi.fn(), featured: vi.fn() },
}));
vi.mock('@/features/bookings/bookingApi', () => ({ bookingApi: { list: vi.fn(), details: vi.fn(), timeline: vi.fn() } }));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { forBooking: vi.fn(), invoiceForBooking: vi.fn() } }));
vi.mock('@/features/documents/documentApi', () => ({ documentApi: { list: vi.fn().mockResolvedValue([]), download: vi.fn() } }));

const stay = (overrides: Partial<EligibleStay> = {}): EligibleStay => ({
  bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', hotelId: 'h1', hotelName: 'Sea Breeze Resort', hotelSlug: 'sea-breeze-resort-goa',
  checkIn: '2026-10-10', checkOut: '2026-10-12', ...overrides,
});
const review = (overrides: Partial<MyReview> = {}): MyReview => ({
  id: 'r1', bookingId: 'b9', bookingReference: 'HT-AAAA1111', hotelId: 'h2', hotelName: 'Palm Grove', hotelSlug: 'palm-grove-kochi',
  rating: 4, title: 'Lovely garden', text: 'Quiet rooms and a friendly team at the front desk.', status: 'APPROVED',
  rejectionReason: null, createdAt: '2026-10-20T10:00:00Z', ...overrides,
});
const page = <T,>(content: T[]) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1 });
const auth = () => fakeAuth({ user: customer });

beforeEach(() => {
  vi.mocked(reviewApi.eligible).mockResolvedValue([stay()]);
  vi.mocked(reviewApi.mine).mockResolvedValue([]);
});

describe('MyReviewsPage', () => {
  const open = () => renderRoutes([
    { path: '/account/reviews', element: <MyReviewsPage /> },
    { path: '/account/reviews/write/:bookingId', element: <p>review form</p> },
  ], { path: '/account/reviews', auth: auth() });

  it('lists the stays to review and my reviews with their status', async () => {
    vi.mocked(reviewApi.mine).mockResolvedValue([
      review(),
      review({ id: 'r2', title: 'Too noisy', status: 'PENDING' }),
      review({ id: 'r3', title: 'Bad words', status: 'REJECTED', rejectionReason: 'Please keep it about the stay.' }),
    ]);
    const { user, router } = open();

    const stays = await screen.findByRole('list', { name: 'Stays to review' });
    expect(within(stays).getByText('Sea Breeze Resort')).toBeInTheDocument();
    expect(within(stays).getByText(/booking HT-7K3M9Q2X/)).toBeInTheDocument();

    const mine = await screen.findByRole('list', { name: 'Your reviews' });
    const [approved, pending, rejected] = within(mine).getAllByRole('listitem');
    expect(within(approved!).getByText('Published')).toBeInTheDocument();
    expect(within(approved!).getByRole('link', { name: 'Palm Grove' })).toHaveAttribute('href', '/hotels/palm-grove-kochi');
    expect(within(approved!).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(within(pending!).getByText('Waiting for approval')).toBeInTheDocument();
    expect(within(rejected!).getByText('Not published')).toBeInTheDocument();
    expect(within(rejected!).getByText('Please keep it about the stay.')).toBeInTheDocument();

    await user.click(within(stays).getByRole('link', { name: 'Write a review of Sea Breeze Resort' }));
    expect(currentLocation(router)).toBe('/account/reviews/write/b1');
  });

  it('shows my review figures, and searches and filters my reviews', async () => {
    vi.mocked(reviewApi.mine).mockResolvedValue([
      review({ rating: 4 }),
      review({ id: 'r2', title: 'Too noisy', hotelName: 'Harbour View', rating: 2, status: 'PENDING' }),
      review({ id: 'r3', title: 'Bad words', status: 'REJECTED', rating: 3, rejectionReason: 'Please keep it about the stay.' }),
    ]);
    const { user } = open();

    const figures = await screen.findByLabelText('Review figures');
    expect(within(figures).getByText('Reviews written').closest('li')).toHaveTextContent('3');
    expect(within(figures).getByText('Published').closest('li')).toHaveTextContent('1');
    expect(within(figures).getByText('Your average rating').closest('li')).toHaveTextContent('3.0 / 5');
    expect(within(figures).getByText('1 waiting for approval')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search my reviews' }), 'harbour');
    const mine = await screen.findByRole('list', { name: 'Your reviews' });
    expect(within(mine).getAllByRole('listitem')).toHaveLength(1);
    expect(within(mine).getByText('Too noisy')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search my reviews' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Not published');
    expect(within(await screen.findByRole('list', { name: 'Your reviews' })).getAllByRole('listitem')).toHaveLength(1);

    await user.type(screen.getByRole('searchbox', { name: 'Search my reviews' }), 'zzzz');
    expect(await screen.findByText('No reviews match')).toBeInTheDocument();
  });

  it('has friendly empty states', async () => {
    vi.mocked(reviewApi.eligible).mockResolvedValue([]);
    open();

    expect(await screen.findByText(/No stays to review right now/)).toBeInTheDocument();
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
  });

  it('shows the support reference when my reviews cannot be loaded', async () => {
    vi.mocked(reviewApi.mine).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.', [], 'corr-9'));
    open();

    expect(await screen.findByText('Support reference: corr-9')).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Stays to review' })).toBeInTheDocument();
  });
});

describe('WriteReviewPage', () => {
  const open = (bookingId = 'b1') => renderRoutes([
    { path: '/account/reviews/write/:bookingId', element: <WriteReviewPage /> },
    { path: '/account/reviews', element: <p>my reviews</p> },
  ], { path: `/account/reviews/write/${bookingId}`, auth: auth() });

  it('checks the rating, title and text before sending', async () => {
    const { user } = open();
    expect(await screen.findByRole('heading', { name: 'Review Sea Breeze Resort' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Title'), 'Ok');
    await user.type(screen.getByLabelText('Your review'), 'Too short');
    await user.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(await screen.findByText('Choose a rating from 1 to 5 stars')).toBeInTheDocument();
    expect(screen.getByText('Use at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Write at least 20 characters')).toBeInTheDocument();
    expect(reviewApi.create).not.toHaveBeenCalled();
  });

  it('sends the review, counts characters and goes back to My reviews', async () => {
    vi.mocked(reviewApi.create).mockResolvedValue(review({ id: 'new', status: 'PENDING' }));
    const { user, router } = open();
    await screen.findByRole('heading', { name: 'Review Sea Breeze Resort' });

    await user.click(screen.getByRole('radio', { name: '5 stars' }));
    await user.type(screen.getByLabelText('Title'), 'Perfect beach break');
    expect(screen.getByText('19 / 100 characters')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your review'), 'Great pool, kind staff and a quiet room.');
    await user.click(screen.getByRole('button', { name: 'Submit review' }));

    await waitFor(() => expect(reviewApi.create).toHaveBeenCalledWith({
      bookingId: 'b1', rating: 5, title: 'Perfect beach break', text: 'Great pool, kind staff and a quiet room.',
    }));
    expect(await screen.findByText('my reviews')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/account/reviews');
    expect(await screen.findByText('Thank you! Your review is waiting for approval.')).toBeInTheDocument();
  });

  it('explains when the stay was already reviewed (409 ALREADY_REVIEWED)', async () => {
    vi.mocked(reviewApi.create).mockRejectedValue(new ApiError(409, 'ALREADY_REVIEWED', 'Already reviewed.', [], 'corr-1'));
    const { user } = open();
    await screen.findByRole('heading', { name: 'Review Sea Breeze Resort' });

    await user.click(screen.getByRole('radio', { name: '3 stars' }));
    await user.type(screen.getByLabelText('Title'), 'Fine');
    await user.type(screen.getByLabelText('Your review'), 'A good stay overall, nothing special.');
    await user.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(await screen.findByText('You have already reviewed this stay.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-1')).toBeInTheDocument();
  });

  it('shows the server\'s message when the stay is not eligible (422 NOT_ELIGIBLE)', async () => {
    vi.mocked(reviewApi.create).mockRejectedValue(new ApiError(422, 'NOT_ELIGIBLE', 'You can review a stay after check-out.'));
    const { user } = open();
    await screen.findByRole('heading', { name: 'Review Sea Breeze Resort' });

    await user.click(screen.getByRole('radio', { name: '2 stars' }));
    await user.type(screen.getByLabelText('Title'), 'Meh');
    await user.type(screen.getByLabelText('Your review'), 'The room was not ready on time.');
    await user.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(await screen.findByText('You can review a stay after check-out.')).toBeInTheDocument();
  });

  it('says so when the stay cannot be reviewed', async () => {
    open('b-unknown');

    expect(await screen.findByText('This stay cannot be reviewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See my reviews' })).toHaveAttribute('href', '/account/reviews');
  });
});

describe('"Write a review" entry points', () => {
  it('My Trips offers it for stays the server lists as reviewable', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([
      summaryFixture({ id: 'b1', status: 'COMPLETED', title: 'Sea Breeze Resort', startDate: '2026-10-10', endDate: '2026-10-12' }),
      summaryFixture({ id: 'b2', reference: 'HT-REVIEWED', status: 'COMPLETED', title: 'Palm Grove', startDate: '2026-09-01', endDate: '2026-09-03' }),
      summaryFixture({ id: 'b3', reference: 'HT-UPCOMING', status: 'CONFIRMED', title: 'Hill View' }),
    ]));
    renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path: '/my-trips', auth: auth() });

    expect(await screen.findByRole('link', { name: 'Write a review of Sea Breeze Resort' })).toHaveAttribute('href', '/account/reviews/write/b1');
    expect(screen.queryByRole('link', { name: 'Write a review of Palm Grove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Write a review of Hill View' })).not.toBeInTheDocument();
  });

  it('My Trips does not ask the server when no trip could be reviewed yet', async () => {
    vi.mocked(bookingApi.list).mockResolvedValue(page([summaryFixture({ status: 'CONFIRMED' })]));
    renderRoutes([{ path: '/my-trips', element: <MyTripsPage /> }], { path: '/my-trips', auth: auth() });

    expect(await screen.findByRole('list', { name: 'Bookings' })).toBeInTheDocument();
    expect(reviewApi.eligible).not.toHaveBeenCalled();
  });

  it('the booking page of a completed, reviewable stay asks "How was your stay?"', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({
      status: 'COMPLETED', paymentStatus: 'PAID', canPay: false, startDate: '2026-10-10', endDate: '2026-10-12',
    }));
    vi.mocked(bookingApi.timeline).mockResolvedValue([]);
    vi.mocked(paymentApi.forBooking).mockResolvedValue([]);
    vi.mocked(paymentApi.invoiceForBooking).mockRejectedValue(new ApiError(404, 'INVOICE_NOT_FOUND', 'Not found'));
    renderRoutes([{ path: '/my-trips/:bookingId', element: <BookingDetailsPage /> }], { path: '/my-trips/b1', auth: auth() });

    expect(await screen.findByRole('heading', { name: 'How was your stay?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write a review' })).toHaveAttribute('href', '/account/reviews/write/b1');
  });
});
