import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { HotelReviews } from './HotelReviews';
import { reviewApi } from './reviewApi';
import type { HotelReviewsPage, PublicReview } from './types';

vi.mock('./reviewApi', () => ({
  reviewApi: { eligible: vi.fn(), create: vi.fn(), mine: vi.fn(), report: vi.fn(), forHotel: vi.fn(), featured: vi.fn() },
}));

const item = (overrides: Partial<PublicReview> = {}): PublicReview => ({
  id: 'r1', rating: 5, title: 'Perfect beach break', text: 'Great pool and kind staff.', authorName: 'Asha R.', stayedIn: 'Oct 2026',
  createdAt: '2026-10-20T10:00:00Z', ...overrides,
});
const reviewsPage = (content: PublicReview[], overrides: Partial<HotelReviewsPage> = {}): HotelReviewsPage => ({
  content, page: 0, size: 5, totalElements: content.length, totalPages: 1,
  summary: { average: 4.4, count: 12, distribution: { 5: 8, 4: 2, 3: 1, 1: 1 } },
  ...overrides,
});

const open = (user = customer as typeof customer | null) => renderRoutes(
  [{ path: '/hotels/:slug', element: <HotelReviews hotelIdOrSlug="sea-breeze-resort-goa" /> }],
  { path: '/hotels/sea-breeze-resort-goa?checkIn=2099-03-10', auth: fakeAuth({ user }) },
);

describe('HotelReviews', () => {
  it('shows the summary (average, count, reviews per star) and the newest reviews', async () => {
    vi.mocked(reviewApi.forHotel).mockResolvedValue(reviewsPage([item(), item({ id: 'r2', rating: 3, title: 'Fine', authorName: 'Ravi K.' })]));
    open();

    const summary = await screen.findByRole('group', { name: 'Review summary' });
    expect(within(summary).getByText('4.4')).toBeInTheDocument();
    expect(within(summary).getByRole('img', { name: '4.4 out of 5 stars' })).toBeInTheDocument();
    expect(within(summary).getByText('12 reviews')).toBeInTheDocument();
    const perStar = within(summary).getAllByRole('listitem');
    expect(perStar.map((row) => row.textContent)).toEqual(['5 stars8 reviews', '4 stars2 reviews', '3 stars1 review', '2 stars0 reviews', '1 star1 review']);

    const list = screen.getByRole('list', { name: 'Reviews' });
    expect(within(list).getByRole('article', { name: 'Perfect beach break' })).toHaveTextContent('Asha R. · stayed in Oct 2026');
    expect(within(list).getByRole('img', { name: '3 out of 5 stars' })).toBeInTheDocument();
    expect(reviewApi.forHotel).toHaveBeenCalledWith('sea-breeze-resort-goa', { page: 0, size: 5, sort: 'RECENT' });
  });

  it('sorts and pages through the reviews', async () => {
    // The server answers with the page it was asked for.
    vi.mocked(reviewApi.forHotel).mockImplementation(async (_hotel, query) =>
      reviewsPage([item()], { page: query.page, totalPages: 3, totalElements: 12 }));
    const { user } = open();
    await screen.findByRole('list', { name: 'Reviews' });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(reviewApi.forHotel).toHaveBeenLastCalledWith('sea-breeze-resort-goa', { page: 1, size: 5, sort: 'RECENT' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Sort reviews'), 'Lowest rating');
    await waitFor(() => expect(reviewApi.forHotel).toHaveBeenLastCalledWith('sea-breeze-resort-goa', { page: 0, size: 5, sort: 'LOWEST' }));
  });

  it('says when there are no written reviews yet', async () => {
    vi.mocked(reviewApi.forHotel).mockResolvedValue(reviewsPage([], { summary: { average: null, count: 0, distribution: {} } }));
    open();

    expect(await screen.findByText(/No written reviews yet/)).toBeInTheDocument();
  });

  it('keeps the page working when reviews cannot be loaded, with a retry', async () => {
    vi.mocked(reviewApi.forHotel).mockRejectedValueOnce(new ApiError(503, 'HTTP_503', 'Down', [], 'corr-5'));
    vi.mocked(reviewApi.forHotel).mockResolvedValueOnce(reviewsPage([item()]));
    const { user } = open();

    expect(await screen.findByText('Reviews could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Reviews' })).toBeInTheDocument();
  });

  describe('Report', () => {
    beforeEach(() => {
      vi.mocked(reviewApi.forHotel).mockResolvedValue(reviewsPage([item()]));
    });

    it('asks visitors to log in first, and comes back to the hotel', async () => {
      const { user } = open(null);
      await user.click(await screen.findByRole('button', { name: 'Report review: Perfect beach break' }));

      expect(screen.getByRole('link', { name: 'log in' })).toHaveAttribute('href',
        `/customer/login?redirect=${encodeURIComponent('/hotels/sea-breeze-resort-goa?checkIn=2099-03-10')}`);
    });

    it('needs a reason, sends it and thanks the user', async () => {
      vi.mocked(reviewApi.report).mockResolvedValue(undefined);
      const { user } = open();
      const report = await screen.findByRole('button', { name: 'Report review: Perfect beach break' });
      await user.click(report);
      expect(report).toHaveAttribute('aria-expanded', 'true');

      await user.type(screen.getByLabelText('Why are you reporting this review?'), 'Spam');
      await user.click(screen.getByRole('button', { name: 'Send report' }));
      expect(await screen.findByText('Use at least 5 characters')).toBeInTheDocument();
      expect(reviewApi.report).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText('Why are you reporting this review?'), ' link in the text');
      expect(screen.getByText('21 / 300 characters')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Send report' }));

      await waitFor(() => expect(reviewApi.report).toHaveBeenCalledWith('r1', 'Spam link in the text'));
      expect(await screen.findByText('Thank you. Our team will check this review.')).toBeInTheDocument();
    });

    it('explains a second report (409 ALREADY_REPORTED) and one\'s own review (422 OWN_REVIEW)', async () => {
      vi.mocked(reviewApi.report).mockRejectedValueOnce(new ApiError(422, 'OWN_REVIEW', 'Own review.'));
      vi.mocked(reviewApi.report).mockRejectedValueOnce(new ApiError(409, 'ALREADY_REPORTED', 'Already reported.'));
      const { user } = open();
      await user.click(await screen.findByRole('button', { name: 'Report review: Perfect beach break' }));
      await user.type(screen.getByLabelText('Why are you reporting this review?'), 'Not about the hotel');

      await user.click(screen.getByRole('button', { name: 'Send report' }));
      expect(await screen.findByText('You cannot report your own review.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Send report' }));
      expect(await screen.findByText('You have already reported this review.')).toBeInTheDocument();
    });
  });
});
