/** Every category, in the order the filters and the settings show them. */
export const NOTIFICATION_CATEGORIES = ['BOOKING', 'PAYMENT', 'REFUND', 'REMINDER', 'SUPPORT', 'ACCOUNT'];

export const categoryLabels = {
  BOOKING: 'Bookings',
  PAYMENT: 'Payments',
  REFUND: 'Refunds',
  REMINDER: 'Trip reminders',
  SUPPORT: 'Support',
  ACCOUNT: 'Account',
};

/** What each category covers, for the settings page. */
export const categoryDescriptions = {
  BOOKING: 'Booking received, confirmed or cancelled',
  PAYMENT: 'Payments, receipts and invoices',
  REFUND: 'Refunds started, completed or failed',
  REMINDER: 'A reminder the day before your trip',
  SUPPORT: 'Answers to your support tickets',
  ACCOUNT: 'Welcome, password and security messages',
};

export const channelLabels = { EMAIL: 'E-mail', IN_APP: 'In the app' };

export function categoryLabel(category) {
  return categoryLabels[category] ?? category.charAt(0) + category.slice(1).toLowerCase();
}

/** Filters from the URL (`?unread=true&category=BOOKING&page=1`); unknown values fall back to "all". */
export function readNotificationFilters(params) {
  const category = params.get('category');
  return {
    unreadOnly: params.get('unread') === 'true',
    category: NOTIFICATION_CATEGORIES.includes(category) ? category : '',
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}
