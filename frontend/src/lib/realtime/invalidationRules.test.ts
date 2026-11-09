import { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/queryKeys';
import { applyInvalidation } from './invalidationRules';
import type { RealtimeMessage } from './types';

const message = (type: string, resourceId: string | null = null, data: Record<string, unknown> = {}): RealtimeMessage => ({
  id: '1',
  type,
  resourceType: 'X',
  resourceId,
  data,
  occurredAt: new Date().toISOString(),
});

describe('applyInvalidation', () => {
  it('refreshes the booking lists, the booking itself and its timeline on a status change', () => {
    const queryClient = new QueryClient();
    for (const key of [queryKeys.bookings.all, queryKeys.bookings.detail('b1'), queryKeys.bookings.timeline('b1'), ['unrelated']]) {
      queryClient.setQueryData(key, { cached: true });
    }
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const keys = applyInvalidation(queryClient, message('booking.status-changed', 'b1'));

    expect(keys).toContainEqual(queryKeys.bookings.all);
    expect(keys).toContainEqual(queryKeys.bookings.detail('b1'));
    expect(keys).toContainEqual(queryKeys.bookings.timeline('b1'));
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(stale(queryKeys.bookings.all)).toBe(true);
    expect(stale(queryKeys.bookings.detail('b1'))).toBe(true);
    expect(stale(queryKeys.bookings.timeline('b1'))).toBe(true);
    expect(stale(['unrelated'])).toBe(false);
    // One invalidation for all keys, so a query matched by several keys is refetched once, not cancelled and restarted.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['booking.status-changed', 'payment.status-changed', 'refund.status-changed'])(
    'refreshes the customer dashboard summary (every period) on %s',
    (type) => {
      const queryClient = new QueryClient();
      const summaryKey = queryKeys.bookings.summary({ range: 'THIS_YEAR' });
      const previousKey = queryKeys.bookings.summary({ range: 'CUSTOM', from: '2025-01-01', to: '2025-12-31' });
      queryClient.setQueryData(summaryKey, { cached: true });
      queryClient.setQueryData(previousKey, { cached: true });

      applyInvalidation(queryClient, message(type, 'b1'));

      expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(previousKey)?.isInvalidated).toBe(true);
    },
  );

  it('also refreshes the cancellation quotes and the support lookup on a booking status change', () => {
    const keys = applyInvalidation(new QueryClient(), message('booking.status-changed', 'b1'));

    expect(keys).toContainEqual(queryKeys.bookings.cancellationQuotes('b1'));
    expect(keys).toContainEqual(queryKeys.support.bookings);
  });

  it('refreshes the booking (resourceId = booking id), its timeline, quotes, payments and the support lookup on a refund change', () => {
    const keys = applyInvalidation(new QueryClient(), message('refund.status-changed', 'b1'));

    expect(keys).toContainEqual(queryKeys.bookings.detail('b1'));
    expect(keys).toContainEqual(queryKeys.bookings.timeline('b1'));
    expect(keys).toContainEqual(queryKeys.bookings.cancellationQuotes('b1'));
    expect(keys).toContainEqual(queryKeys.payments.all);
    expect(keys).toContainEqual(queryKeys.support.bookings);
    expect(keys).toContainEqual(queryKeys.admin.refunds);
  });

  it('still refreshes the lists when a refund message has no booking id', () => {
    const keys = applyInvalidation(new QueryClient(), message('refund.status-changed'));

    expect(keys).toContainEqual(queryKeys.bookings.all);
    expect(keys).toContainEqual(queryKeys.support.bookings);
    expect(keys).not.toContainEqual(queryKeys.bookings.detail('b1'));
  });

  it('marks the support assist page, its quote and every lookup page stale on a refund change', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.bookings.detail('b1'), { status: 'REFUND_PENDING' });
    queryClient.setQueryData(queryKeys.bookings.cancellationQuote('b1', true), { refundAmount: 2625 });
    queryClient.setQueryData(queryKeys.support.bookingSearch({ q: '', attention: true, page: 0 }), { content: [] });
    queryClient.setQueryData(queryKeys.support.ticket('t1'), { id: 't1' });

    applyInvalidation(queryClient, message('refund.status-changed', 'b1'));

    expect(queryClient.getQueryState(queryKeys.bookings.detail('b1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.bookings.cancellationQuote('b1', true))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.support.bookingSearch({ q: '', attention: true, page: 0 }))?.isInvalidated).toBe(true);
    // Support tickets are not bookings.
    expect(queryClient.getQueryState(queryKeys.support.ticket('t1'))?.isInvalidated).toBe(false);
  });

  it('scopes hotel-manager refreshes to the hotel in the message', () => {
    const queryClient = new QueryClient();

    const keys = applyInvalidation(queryClient, message('hotel.inventory-changed', null, { hotelId: 'h9' }));

    expect(keys).toEqual([queryKeys.hotelManager.inventory('h9')]);
  });

  it('marks cached data stale so visible queries re-fetch', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.bookings.detail('b1'), { status: 'PENDING_PAYMENT' });

    applyInvalidation(queryClient, message('booking.status-changed', 'b1'));

    expect(queryClient.getQueryState(queryKeys.bookings.detail('b1'))?.isInvalidated).toBe(true);
  });

  it('refreshes the documents of the booking in a document.created message (resourceId = booking id)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.documents.forBooking('b1'), []);
    queryClient.setQueryData(queryKeys.documents.forBooking('b2'), []);

    const keys = applyInvalidation(queryClient, message('document.created', 'b1', { type: 'BOOKING_CONFIRMATION' }));

    expect(keys).toEqual([queryKeys.documents.forBooking('b1')]);
    expect(queryClient.getQueryState(queryKeys.documents.forBooking('b1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.documents.forBooking('b2'))?.isInvalidated).toBe(false);
  });

  it('refreshes every booking\'s documents when a document.created message has no booking id', () => {
    expect(applyInvalidation(new QueryClient(), message('document.created'))).toEqual([queryKeys.documents.all]);
  });

  it('refreshes my ticket list pages and that conversation on support.ticket-changed', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.support.ticketList({ status: '', page: 1 }), { content: [] });
    queryClient.setQueryData(queryKeys.support.ticket('t1'), { id: 't1' });
    queryClient.setQueryData(queryKeys.support.bookingSearch({ q: '' }), { content: [] });

    const keys = applyInvalidation(queryClient, message('support.ticket-changed', 't1'));

    expect(keys).toContainEqual(queryKeys.support.tickets);
    expect(keys).toContainEqual(queryKeys.support.ticket('t1'));
    expect(queryClient.getQueryState(queryKeys.support.ticketList({ status: '', page: 1 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.support.ticket('t1'))?.isInvalidated).toBe(true);
    // The staff booking lookup is not a ticket screen.
    expect(queryClient.getQueryState(queryKeys.support.bookingSearch({ q: '' }))?.isInvalidated).toBe(false);
  });

  it.each(['notification.created', 'notification.read'])('%s refreshes the bell and every Notification Center page, not the settings', (type) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.notifications.unreadCount, 3);
    queryClient.setQueryData(queryKeys.notifications.latest, { content: [] });
    queryClient.setQueryData(queryKeys.notifications.list({ unreadOnly: true, category: 'BOOKING', page: 2 }), { content: [] });
    queryClient.setQueryData(queryKeys.notifications.preferences, { items: [] });

    applyInvalidation(queryClient, message(type, 'n1', { category: 'BOOKING' }));

    expect(queryClient.getQueryState(queryKeys.notifications.unreadCount)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.notifications.latest)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.notifications.list({ unreadOnly: true, category: 'BOOKING', page: 2 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.notifications.preferences)?.isInvalidated).toBe(false);
  });

  it('ignores unknown message types', () => {
    expect(applyInvalidation(new QueryClient(), message('something.new'))).toEqual([]);
  });

  it('refreshes a hotel\'s reservation lists, the open reservation, dashboard and reports on hotel.reservation-changed', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.hotelManager.reservationList('h1', { status: 'CONFIRMED', page: 1 }), { content: [] });
    queryClient.setQueryData(queryKeys.hotelManager.reservation('h1', 'res1'), { status: 'CONFIRMED' });
    queryClient.setQueryData(queryKeys.hotelManager.dashboardRange('h1', { preset: 'LAST_7_DAYS' }), {});
    queryClient.setQueryData(queryKeys.hotelManager.report('h1', 'occupancy', { preset: 'THIS_MONTH' }), {});
    queryClient.setQueryData(queryKeys.hotelManager.reservation('h2', 'res2'), { status: 'CONFIRMED' });

    applyInvalidation(queryClient, message('hotel.reservation-changed', 'res1', { hotelId: 'h1' }));

    expect(queryClient.getQueryState(queryKeys.hotelManager.reservationList('h1', { status: 'CONFIRMED', page: 1 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.hotelManager.reservation('h1', 'res1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.hotelManager.dashboardRange('h1', { preset: 'LAST_7_DAYS' }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.hotelManager.report('h1', 'occupancy', { preset: 'THIS_MONTH' }))?.isInvalidated).toBe(true);
    // Another hotel's screens stay as they are.
    expect(queryClient.getQueryState(queryKeys.hotelManager.reservation('h2', 'res2'))?.isInvalidated).toBe(false);
  });

  it('refreshes my reviews, public hotel reviews, moderation and that hotel\'s manager list on review.changed', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.reviews.mine, []);
    queryClient.setQueryData(queryKeys.reviews.eligible, []);
    queryClient.setQueryData(queryKeys.reviews.hotelPage('sea-breeze', { sort: 'RECENT', page: 0 }), { content: [] });
    queryClient.setQueryData(queryKeys.hotelManager.reviewList('h1', { status: '', page: 0 }), { content: [] });
    queryClient.setQueryData(queryKeys.hotelManager.reviewList('h2', { status: '', page: 0 }), { content: [] });

    const keys = applyInvalidation(queryClient, message('review.changed', 'r1', { hotelId: 'h1' }));

    expect(keys).toContainEqual(queryKeys.admin.reviews);
    expect(queryClient.getQueryState(queryKeys.reviews.mine)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.reviews.eligible)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.reviews.hotelPage('sea-breeze', { sort: 'RECENT', page: 0 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.hotelManager.reviewList('h1', { status: '', page: 0 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.hotelManager.reviewList('h2', { status: '', page: 0 }))?.isInvalidated).toBe(false);
    // Without a hotel id every hotel manager screen on display refreshes.
    expect(applyInvalidation(new QueryClient(), message('review.changed', 'r1'))).toContainEqual(queryKeys.hotelManager.all);
  });

  it('refreshes the agents\' ticket queue (every filter) and the support dashboard counts on support.ticket-changed', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.support.queueList({ status: 'ESCALATED', page: 0 }), { content: [] });
    queryClient.setQueryData(queryKeys.support.summary, { open: 1 });

    applyInvalidation(queryClient, message('support.ticket-changed', 't1'));

    expect(queryClient.getQueryState(queryKeys.support.queueList({ status: 'ESCALATED', page: 0 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.support.summary)?.isInvalidated).toBe(true);
  });

  it('refreshes the admin dashboard (any range) and every admin report on dashboard.updated, not the admin lists', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.admin.dashboardRange({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-31' }), {});
    queryClient.setQueryData(queryKeys.admin.report('bookings', { range: 'LAST_7_DAYS', page: 2 }), { content: [] });
    queryClient.setQueryData(queryKeys.admin.report('occupancy', { range: 'THIS_MONTH' }), { hotels: [] });
    queryClient.setQueryData(queryKeys.admin.userList({ search: '', page: 0 }), { content: [] });

    applyInvalidation(queryClient, message('dashboard.updated'));

    expect(queryClient.getQueryState(queryKeys.admin.dashboardRange({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-31' }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.report('bookings', { range: 'LAST_7_DAYS', page: 2 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.report('occupancy', { range: 'THIS_MONTH' }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.userList({ search: '', page: 0 }))?.isInvalidated).toBe(false);
  });

  it('refreshes the admin booking, payment and refund lists on a refund change (refunded amounts move)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.admin.bookingList({ q: '', page: 0 }), { content: [] });
    queryClient.setQueryData(queryKeys.admin.paymentList({ q: '', page: 0 }), { content: [] });
    queryClient.setQueryData(queryKeys.admin.payment('p1'), { id: 'p1' });
    queryClient.setQueryData(queryKeys.admin.refundList({ status: 'FAILED', page: 0 }), { content: [] });

    applyInvalidation(queryClient, message('refund.status-changed', 'b1'));

    expect(queryClient.getQueryState(queryKeys.admin.bookingList({ q: '', page: 0 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.paymentList({ q: '', page: 0 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.payment('p1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.refundList({ status: 'FAILED', page: 0 }))?.isInvalidated).toBe(true);
  });

  it('refreshes the admin settings page and the public settings on settings.changed', () => {
    expect(applyInvalidation(new QueryClient(), message('settings.changed', 'site.name', { version: 3 })))
      .toEqual([queryKeys.admin.settings, queryKeys.publicSettings]);
  });

  it('refreshes "Your exports" (and not the audit log pages) on export.status-changed', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.admin.auditExports, []);
    queryClient.setQueryData(queryKeys.admin.auditLogs({ action: '', page: 0 }), { content: [] });

    const keys = applyInvalidation(queryClient, message('export.status-changed', 'job-1', { status: 'RUNNING', rowsWritten: 5000, totalRows: 9000 }));

    expect(keys).toEqual([queryKeys.admin.auditExports]);
    expect(queryClient.getQueryState(queryKeys.admin.auditExports)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.admin.auditLogs({ action: '', page: 0 }))?.isInvalidated).toBe(false);
  });
});
