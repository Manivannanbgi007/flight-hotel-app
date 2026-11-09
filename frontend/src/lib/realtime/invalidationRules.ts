import { partialMatchKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/queryKeys';
import type { RealtimeMessage } from './types';

type Rule = (message: RealtimeMessage) => QueryKey[];

const hotelId = (message: RealtimeMessage): string | undefined =>
  typeof message.data.hotelId === 'string' ? message.data.hotelId : undefined;

/** One booking's screens: details, timeline and cancellation quotes (`resourceId` = booking id for both booking and refund messages). */
const bookingScreens = (bookingId: string | null): QueryKey[] =>
  bookingId
    ? [queryKeys.bookings.detail(bookingId), queryKeys.bookings.timeline(bookingId), queryKeys.bookings.cancellationQuotes(bookingId)]
    : [];

/**
 * THE place that decides which cached data a server signal refreshes (REALTIME_UPDATES.md §6).
 * Adding a new live screen = add its query key here.
 */
export const invalidationRules: Record<string, Rule> = {
  // `bookings.all` also covers the customer dashboard (`bookings.summary(...)`, every period), as do the payment and
  // refund rules below.
  'booking.status-changed': (m) => [
    queryKeys.bookings.all,
    queryKeys.payments.all,
    queryKeys.admin.bookings,
    queryKeys.admin.dashboard,
    queryKeys.support.bookings,
    ...bookingScreens(m.resourceId),
  ],
  'payment.status-changed': () => [queryKeys.payments.all, queryKeys.bookings.all, queryKeys.admin.payments],
  'refund.status-changed': (m) => [
    queryKeys.payments.all,
    queryKeys.bookings.all,
    queryKeys.admin.refunds,
    queryKeys.admin.payments,
    queryKeys.admin.bookings,
    queryKeys.support.bookings,
    ...bookingScreens(m.resourceId),
  ],
  // The bell (count + latest) and every Notification Center page; the preferences are not under `all`.
  'notification.created': () => [queryKeys.notifications.all],
  'notification.read': () => [queryKeys.notifications.all],
  // A new PDF of a booking (`resourceId` = booking id).
  'document.created': (m) => [m.resourceId ? queryKeys.documents.forBooking(m.resourceId) : queryKeys.documents.all],
  // Reservation lists and the open reservation (both under `reservations`), the dashboard, rooms and the reports.
  'hotel.reservation-changed': (m) => {
    const id = hotelId(m);
    return id
      ? [
          queryKeys.hotelManager.reservations(id),
          queryKeys.hotelManager.dashboard(id),
          queryKeys.hotelManager.inventory(id),
          queryKeys.hotelManager.reports(id),
        ]
      : [queryKeys.hotelManager.all];
  },
  'hotel.inventory-changed': (m) => {
    const id = hotelId(m);
    return id ? [queryKeys.hotelManager.inventory(id)] : [queryKeys.hotelManager.all];
  },
  // My reviews and stays to review, public hotel reviews, moderation, and the hotel manager's review list.
  'review.changed': (m) => {
    const id = hotelId(m);
    return [queryKeys.reviews.all, queryKeys.admin.reviews, id ? queryKeys.hotelManager.reviews(id) : queryKeys.hotelManager.all];
  },
  // My tickets (every list page) and that conversation (`resourceId` = ticket id); for agents the queue and its counts.
  'support.ticket-changed': (m) => [
    queryKeys.support.tickets,
    ...(m.resourceId ? [queryKeys.support.ticket(m.resourceId)] : []),
    queryKeys.support.queue,
    queryKeys.support.summary,
    queryKeys.support.metrics,
  ],
  // The reporting facts changed: the admin dashboard (every range) and every admin report page.
  'dashboard.updated': () => [queryKeys.admin.dashboard, queryKeys.admin.reports, queryKeys.hotelManager.all],
  'flight.provider-health-changed': () => [queryKeys.admin.flightProviders],
  'settings.changed': () => [queryKeys.admin.settings, queryKeys.publicSettings],
  // The admin's own audit log exports prepared on the server: progress, ready, failed.
  'export.status-changed': () => [queryKeys.admin.auditExports],
};

/** Marks the affected queries stale; TanStack Query re-fetches the ones currently on screen. */
export function applyInvalidation(queryClient: QueryClient, message: RealtimeMessage): QueryKey[] {
  const keys = invalidationRules[message.type]?.(message) ?? [];
  if (keys.length > 0) {
    // One call for all keys: a query matched by several keys (e.g. ['bookings'] and the booking's own key) is
    // refetched once, not started, cancelled and started again.
    void queryClient.invalidateQueries({ predicate: (query) => keys.some((key) => partialMatchKey(query.queryKey, key)) });
  }
  return keys;
}
