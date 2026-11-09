import type { NotificationCategory, NotificationChannel, NotificationFilters } from './notificationApi';

/** Every category, in the order the filters and the settings show them. */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['BOOKING', 'PAYMENT', 'REFUND', 'REMINDER', 'SUPPORT', 'ACCOUNT'];

export const categoryLabels: Record<NotificationCategory, string> = {
  BOOKING: 'Bookings',
  PAYMENT: 'Payments',
  REFUND: 'Refunds',
  REMINDER: 'Trip reminders',
  SUPPORT: 'Support',
  ACCOUNT: 'Account',
};

/** What each category covers, for the settings page. */
export const categoryDescriptions: Record<NotificationCategory, string> = {
  BOOKING: 'Booking received, confirmed or cancelled',
  PAYMENT: 'Payments, receipts and invoices',
  REFUND: 'Refunds started, completed or failed',
  REMINDER: 'A reminder the day before your trip',
  SUPPORT: 'Answers to your support tickets',
  ACCOUNT: 'Welcome, password and security messages',
};

export const channelLabels: Record<NotificationChannel, string> = { EMAIL: 'E-mail', IN_APP: 'In the app' };

export function categoryLabel(category: string): string {
  return categoryLabels[category as NotificationCategory] ?? category.charAt(0) + category.slice(1).toLowerCase();
}

/** Filters from the URL (`?unread=true&category=BOOKING&page=1`); unknown values fall back to "all". */
export function readNotificationFilters(params: URLSearchParams): NotificationFilters {
  const category = params.get('category');
  return {
    unreadOnly: params.get('unread') === 'true',
    category: NOTIFICATION_CATEGORIES.includes(category as NotificationCategory) ? (category as NotificationCategory) : '',
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}
