import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { NotificationCenterPage } from './NotificationCenterPage';
import { notificationApi, type AppNotification, type NotificationFilters } from './notificationApi';

vi.mock('./notificationApi', () => ({
  notificationApi: { search: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markUnread: vi.fn(), markAllRead: vi.fn() },
}));

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', category: 'BOOKING', title: 'Booking confirmed', message: 'Your booking HT-7K3M9Q2X is confirmed.',
  link: '/my-trips/b1', read: false, createdAt: '2099-03-01T10:00:00Z', ...overrides,
});
const page = (content: AppNotification[], totalPages = 1, pageNo = 0) => ({ content, page: pageNo, size: 20, totalElements: content.length, totalPages });

const open = (path = '/account/notifications') => renderRoutes([
  { path: '/account/notifications', element: <NotificationCenterPage /> },
  { path: '/account/notifications/settings', element: <p>settings page</p> },
  { path: '/my-trips/:id', element: <p>trip page</p> },
], { path, auth: fakeAuth({ user: customer }) });

const lastFilters = (): NotificationFilters | undefined => vi.mocked(notificationApi.search).mock.lastCall?.[0];

beforeEach(() => {
  vi.mocked(notificationApi.search).mockResolvedValue(page([
    notification(),
    notification({ id: 'n2', category: 'PAYMENT', title: 'Payment received', message: '₹2,625.00 received.', read: true, link: null }),
  ]));
  vi.mocked(notificationApi.unreadCount).mockResolvedValue(1);
  vi.mocked(notificationApi.markRead).mockResolvedValue();
  vi.mocked(notificationApi.markUnread).mockResolvedValue();
  vi.mocked(notificationApi.markAllRead).mockResolvedValue(1);
});

describe('NotificationCenterPage', () => {
  it('lists notifications with their read/unread status, category and date', async () => {
    open();

    const list = await screen.findByRole('list', { name: 'Notifications' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Unread')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'Booking confirmed' })).toHaveAttribute('href', '/my-trips/b1');
    expect(within(items[0]!).getByText(/Bookings ·/)).toBeInTheDocument();
    expect(within(items[1]!).queryByText('Unread')).not.toBeInTheDocument();
    // No link: plain title.
    expect(within(items[1]!).queryByRole('link')).not.toBeInTheDocument();
    expect(within(items[1]!).getByText(/Payments ·/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unread (1)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(lastFilters()).toEqual({ unreadOnly: false, category: '', page: 0 });
    expect(vi.mocked(notificationApi.search).mock.lastCall?.[1]).toBe(25); // page size
    expect(screen.getByRole('link', { name: 'Notification settings' })).toHaveAttribute('href', '/account/notifications/settings');
  });

  it('filters by Unread and by category, keeping the filters in the URL', async () => {
    const { user, router } = open();
    await screen.findByRole('list', { name: 'Notifications' });

    await user.click(screen.getByRole('button', { name: 'Unread (1)' }));
    await waitFor(() => expect(lastFilters()).toEqual({ unreadOnly: true, category: '', page: 0 }));
    expect(currentLocation(router)).toBe('/account/notifications?unread=true');

    await user.selectOptions(screen.getByLabelText('Category'), 'REFUND');
    await waitFor(() => expect(lastFilters()).toEqual({ unreadOnly: true, category: 'REFUND', page: 0 }));
    expect(currentLocation(router)).toBe('/account/notifications?unread=true&category=REFUND');
    expect(screen.getByRole('button', { name: 'Unread (1)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads the filters from the URL and says when nothing is unread', async () => {
    vi.mocked(notificationApi.search).mockResolvedValue(page([]));
    vi.mocked(notificationApi.unreadCount).mockResolvedValue(0);
    open('/account/notifications?unread=true&category=SUPPORT');

    expect(await screen.findByText('You are all caught up')).toBeInTheDocument();
    expect(lastFilters()).toEqual({ unreadOnly: true, category: 'SUPPORT', page: 0 });
    expect(screen.getByLabelText('Category')).toHaveValue('SUPPORT');
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('has a friendly empty state', async () => {
    vi.mocked(notificationApi.search).mockResolvedValue(page([]));
    open();

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('marks one notification read and another unread, at once on screen', async () => {
    vi.mocked(notificationApi.markRead).mockReturnValue(new Promise(() => {}));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Mark as read: Booking confirmed' }));
    expect(notificationApi.markRead).toHaveBeenCalledWith('n1');
    // Optimistic: the row already reads as read while the server answers.
    expect(await screen.findByRole('button', { name: 'Mark as unread: Booking confirmed' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mark as unread: Payment received' }));
    expect(notificationApi.markUnread).toHaveBeenCalledWith('n2');
  });

  it('refreshes from the server after a change, and shows an error if it did not work', async () => {
    vi.mocked(notificationApi.markRead).mockRejectedValue(new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found', [], 'corr-1'));
    const { user } = open();
    await screen.findByRole('list', { name: 'Notifications' });
    const calls = vi.mocked(notificationApi.search).mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Mark as read: Booking confirmed' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Notification not found');
    expect(alert).toHaveTextContent('Support reference: corr-1');
    await waitFor(() => expect(vi.mocked(notificationApi.search).mock.calls.length).toBeGreaterThan(calls));
    // Back to the server's state.
    expect(await screen.findByRole('button', { name: 'Mark as read: Booking confirmed' })).toBeInTheDocument();
  });

  it('marks everything read', async () => {
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(notificationApi.markAllRead).toHaveBeenCalled());
    expect(await screen.findByText('1 notification marked as read.')).toBeInTheDocument();
  });

  it('opens the related page and marks the notification read', async () => {
    const { user, router } = open();

    await user.click(await screen.findByRole('link', { name: 'Booking confirmed' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/my-trips/b1'));
    expect(notificationApi.markRead).toHaveBeenCalledWith('n1');
  });

  it('never links outside the app', async () => {
    vi.mocked(notificationApi.search).mockResolvedValue(page([notification({ link: '//evil.example.com/x' })]));
    open();

    const list = await screen.findByRole('list', { name: 'Notifications' });
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
    expect(within(list).getByText('Booking confirmed')).toBeInTheDocument();
  });

  it('pages through older notifications', async () => {
    vi.mocked(notificationApi.search).mockImplementation(async (filters) =>
      page([notification({ id: `n-${filters.page}`, title: `Notification on page ${filters.page + 1}` })], 2, filters.page));
    const { user, router } = open();
    await screen.findByText('Page 1 of 2');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Notification on page 2')).toBeInTheDocument();
    expect(currentLocation(router)).toBe('/account/notifications?page=1');
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  it('offers a retry with the support reference when loading fails', async () => {
    vi.mocked(notificationApi.search).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.', [], 'corr-2'));
    open();

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
