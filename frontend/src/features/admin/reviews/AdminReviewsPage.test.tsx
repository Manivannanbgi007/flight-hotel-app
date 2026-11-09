import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, pageOf, renderAdmin } from '../testUtils';
import { AdminReviewsPage } from './AdminReviewsPage';
import { reviewModerationApi, type ModerationReview } from './reviewModerationApi';

vi.mock('./reviewModerationApi', () => ({ reviewModerationApi: { list: vi.fn(), approve: vi.fn(), reject: vi.fn() } }));

const review = (overrides: Partial<ModerationReview> = {}): ModerationReview => ({
  id: 'r1', hotelId: 'h1', hotelName: 'Sea Breeze Resort', bookingReference: 'HT-7K3M9Q2X', authorName: 'Asha R.', rating: 4,
  title: 'Lovely stay', text: 'Great view of the sea and friendly staff.', status: 'PENDING', stayedIn: 'Oct 2026', reportCount: 0, reports: [],
  createdAt: '2026-11-04T10:00:00Z', moderatedAt: null, rejectionReason: null, ...overrides,
});

const routes = [{ path: '/admin/reviews', element: <AdminReviewsPage /> }];
const lastFilters = () => vi.mocked(reviewModerationApi.list).mock.lastCall?.[0];

describe('AdminReviewsPage', () => {
  it('opens on the pending queue and approves a review', async () => {
    vi.mocked(reviewModerationApi.list).mockResolvedValue(pageOf([review()]));
    vi.mocked(reviewModerationApi.approve).mockResolvedValue(review({ status: 'APPROVED' }));
    const { user } = renderAdmin(routes, '/admin/reviews');

    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true');
    const card = await screen.findByRole('article', { name: 'Review by Asha R.: Lovely stay' });
    expect(within(card).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Asha R. · Sea Breeze Resort · stayed Oct 2026 · HT-7K3M9Q2X');
    expect(lastFilters()).toEqual({ queue: 'PENDING', q: '', page: 0 });

    await user.click(within(card).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(reviewModerationApi.approve).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('Review approved.')).toBeInTheDocument();
  });

  it('switches between the queues (the URL keeps the tab) and shows the reports', async () => {
    vi.mocked(reviewModerationApi.list).mockResolvedValue(pageOf([]));
    const { user, router } = renderAdmin(routes, '/admin/reviews');
    await screen.findByText('No reviews wait for a decision.');
    vi.mocked(reviewModerationApi.list).mockResolvedValue(pageOf([review({
      status: 'APPROVED', reportCount: 2, reports: [{ reason: 'Contains a phone number', createdAt: '2026-11-05T09:00:00Z' },
        { reason: 'Rude words', createdAt: '2026-11-05T09:10:00Z' }],
    })]));

    await user.click(screen.getByRole('tab', { name: 'Reported' }));

    await waitFor(() => expect(lastFilters()).toEqual({ queue: 'REPORTED', q: '', page: 0 }));
    expect(currentLocation(router)).toBe('/admin/reviews?tab=REPORTED');
    const reports = await screen.findByRole('region', { name: 'Reports' });
    expect(reports).toHaveTextContent('“Contains a phone number”');
    expect(reports).toHaveTextContent('“Rude words”');
    expect(screen.getByText('2 reports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep and clear reports' })).toBeInTheDocument();

    // Arrow keys move between the tabs.
    screen.getByRole('tab', { name: 'Reported' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Approved' })).toHaveFocus();
    await waitFor(() => expect(lastFilters()).toMatchObject({ queue: 'APPROVED' }));
  });

  it('rejects a review only with a reason', async () => {
    vi.mocked(reviewModerationApi.list).mockResolvedValue(pageOf([review()]));
    vi.mocked(reviewModerationApi.reject).mockResolvedValue(review({ status: 'REJECTED', rejectionReason: 'bad language in the text' }));
    const { user } = renderAdmin(routes, '/admin/reviews');

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject this review?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'bad');
    await user.click(within(dialog).getByRole('button', { name: 'Reject review' }));
    expect(within(dialog).getByText('Write the reason (at least 5 characters)')).toBeInTheDocument();
    expect(reviewModerationApi.reject).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Reason'), ' language in the text');
    await user.click(within(dialog).getByRole('button', { name: 'Reject review' }));

    await waitFor(() => expect(reviewModerationApi.reject).toHaveBeenCalledWith('r1', 'bad language in the text'));
    expect(await screen.findByText('Review rejected.')).toBeInTheDocument();
  });

  it('shows why an approval failed', async () => {
    vi.mocked(reviewModerationApi.list).mockResolvedValue(pageOf([review()]));
    vi.mocked(reviewModerationApi.approve).mockRejectedValue(new ApiError(409, 'REVIEW_ALREADY_MODERATED', 'Another admin already decided.', [], 'corr-11'));
    const { user } = renderAdmin(routes, '/admin/reviews');

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Another admin already decided.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-11')).toBeInTheDocument();
  });

  it('is closed without REVIEW_MODERATE', () => {
    renderAdmin(routes, '/admin/reviews', adminWithout('REVIEW_MODERATE'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(reviewModerationApi.list).not.toHaveBeenCalled();
  });
});

describe('AdminReviewsPage: export', () => {
  it('exports the reviews of the queue: text, reports and rejection reason, with a reminder about personal data', async () => {
    const files = stubFileSaving();
    vi.mocked(reviewModerationApi.list).mockResolvedValue(pageOf([review({
      status: 'APPROVED', text: 'Great view.\nFriendly staff.', reportCount: 2,
      reports: [{ reason: 'Fake', createdAt: '2026-11-05T10:00:00Z' }, { reason: 'Rude', createdAt: '2026-11-05T11:00:00Z' }],
    })]));
    const { user } = renderAdmin(routes, '/admin/reviews?tab=REPORTED&q=sea');
    await screen.findByRole('article', { name: 'Review by Asha R.: Lovely stay' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export reviews' });
    expect(within(panel).getByText(/The file holds personal data/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^reviews-reported-\d{4}-\d{2}-\d{2}\.csv$/);
    const [header, row, end] = (await files.blobs[0]!.text()).split('\r\n');
    expect(header).toBe('"Hotel","Author","Rating","Title","Review","Status","Reports","Report reasons","Rejection reason","Stayed",'
      + '"Booking reference","Written"');
    expect(row).toMatch(/^"Sea Breeze Resort","Asha R\.",4,"Lovely stay","Great view\.\nFriendly staff\.","Approved",2,"Fake \| Rude",,"Oct 2026","HT-7K3M9Q2X",2026-11-0[45] \d{2}:\d{2}$/);
    expect(end).toBe('');
  });

  it('exports every review of the queue through the same list, page by page', async () => {
    const files = stubFileSaving();
    const all = [review(), review({ id: 'r2', title: 'Second' }), review({ id: 'r3', title: 'Third' })];
    vi.mocked(reviewModerationApi.list).mockImplementation(async (filters) => pageOf(all.slice(filters.page * 2, filters.page * 2 + 2),
      { page: filters.page, size: 2, totalElements: 3, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/reviews?q=sea');
    await screen.findByRole('article', { name: 'Review by Asha R.: Lovely stay' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(reviewModerationApi.list).toHaveBeenCalledWith({ queue: 'PENDING', q: 'sea', page: 1 }, 100);
    expect((await files.blobs[0]!.text()).split('\r\n').filter(Boolean)).toHaveLength(4);
  });
});
