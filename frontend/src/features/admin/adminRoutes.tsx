import type { RouteObject } from 'react-router';

import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * The admin portal's pages below `/admin` (inside RequireRole ADMIN and AdminLayout, see app/router.tsx). Every page is
 * lazy-loaded; pages also check the permission they need and hide actions the user may not take.
 */
export const adminRoutes: RouteObject[] = [
  { index: true, lazy: async () => ({ Component: (await import('./dashboard/AdminDashboardPage')).AdminDashboardPage }) },
  { path: 'reports', lazy: async () => ({ Component: (await import('./reports/AdminReportsPage')).AdminReportsPage }) },
  { path: 'reports/:report', lazy: async () => ({ Component: (await import('./reports/AdminReportPage')).AdminReportPage }) },
  { path: 'users', lazy: async () => ({ Component: (await import('./users/AdminUsersPage')).AdminUsersPage }) },
  { path: 'users/:userId', lazy: async () => ({ Component: (await import('./users/AdminUserPage')).AdminUserPage }) },
  { path: 'bookings', lazy: async () => ({ Component: (await import('./bookings/AdminBookingsPage')).AdminBookingsPage }) },
  { path: 'bookings/:bookingId', lazy: async () => ({ Component: (await import('./bookings/AdminBookingPage')).AdminBookingPage }) },
  { path: 'payments', lazy: async () => ({ Component: (await import('./payments/AdminPaymentsPage')).AdminPaymentsPage }) },
  { path: 'payments/:paymentId', lazy: async () => ({ Component: (await import('./payments/AdminPaymentPage')).AdminPaymentPage }) },
  { path: 'refunds', lazy: async () => ({ Component: (await import('./payments/AdminRefundsPage')).AdminRefundsPage }) },
  { path: 'coupons', lazy: async () => ({ Component: (await import('./coupons/AdminCouponsPage')).AdminCouponsPage }) },
  { path: 'offers', lazy: async () => ({ Component: (await import('./coupons/AdminOffersPage')).AdminOffersPage }) },
  { path: 'reviews', lazy: async () => ({ Component: (await import('./reviews/AdminReviewsPage')).AdminReviewsPage }) },
  { path: 'support', lazy: async () => ({ Component: (await import('./support/AdminSupportPage')).AdminSupportPage }) },
  { path: 'audit-logs', lazy: async () => ({ Component: (await import('./audit/AdminAuditLogsPage')).AdminAuditLogsPage }) },
  { path: 'settings', lazy: async () => ({ Component: (await import('./settings/AdminSettingsPage')).AdminSettingsPage }) },
  { path: 'hotels', lazy: async () => ({ Component: (await import('./AdminHotelsPage')).AdminHotelsPage }) },
  { path: 'flight-providers', lazy: async () => ({ Component: (await import('./AdminFlightProvidersPage')).AdminFlightProvidersPage }) },
  { path: 'search', lazy: async () => ({ Component: (await import('@/features/search/SearchResultsPage')).SearchResultsPage }) },
  { path: '*', element: <NotFoundPage /> },
];
