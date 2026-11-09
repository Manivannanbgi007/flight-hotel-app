import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import { AppRoot } from '@/app/AppRoot';
import { HomeRedirect } from '@/app/HomeRedirect';
import { RequireAuth, RequireRole } from '@/app/guards';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { FullPageLoader } from '@/components/ui/FullPageLoader';
import { adminRoutes } from '@/features/admin/adminRoutes';
import { LoginRedirect } from '@/features/auth/signin/LoginRedirect';
import { HomePage } from '@/features/home/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';
import { UnderConstructionPage } from '@/pages/UnderConstructionPage';

/**
 * Route map (PROJECT_ARCHITECTURE.md §10, IMPLEMENTATION_PLAN.md §11.2). Sign-in pages, "My account" and the staff
 * portals are lazy-loaded, so the home page stays small. Three layouts: the sign-in pages are full-screen, public and
 * customer pages use PublicLayout, the staff portals the staff shell (inside their layouts). Guards only shape the UI;
 * every API checks the token and roles again.
 */
export const routes: RouteObject[] = [
  {
    element: <AppRoot />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      // ---- Sign-in (one page per portal) and the account flows: full screen, split layout (features/auth/AuthShell) ----
      {
        errorElement: <RouteErrorPage />,
        children: [
          // Older links and e-mails: /login?redirect=...&reason=... → the customer sign-in with the same query.
          { path: 'login', element: <LoginRedirect /> },
          { path: 'customer/login', lazy: async () => ({ Component: (await import('@/features/auth/signin/SignInPages')).CustomerLoginPage }) },
          { path: 'admin/login', lazy: async () => ({ Component: (await import('@/features/auth/signin/SignInPages')).AdminLoginPage }) },
          { path: 'hotel-manager/login', lazy: async () => ({ Component: (await import('@/features/auth/signin/SignInPages')).HotelManagerLoginPage }) },
          { path: 'support/login', lazy: async () => ({ Component: (await import('@/features/auth/signin/SignInPages')).SupportLoginPage }) },
          { path: 'register', lazy: async () => ({ Component: (await import('@/features/auth/RegisterPage')).RegisterPage }) },
          {
            path: 'verify-email',
            lazy: async () => ({ Component: (await import('@/features/auth/VerifyEmailPage')).VerifyEmailPage }),
          },
          {
            path: 'forgot-password',
            lazy: async () => ({ Component: (await import('@/features/auth/ForgotPasswordPage')).ForgotPasswordPage }),
          },
          {
            path: 'reset-password',
            lazy: async () => ({ Component: (await import('@/features/auth/ResetPasswordPage')).ResetPasswordPage }),
          },
        ],
      },
      {
        element: <PublicLayout />,
        errorElement: <RouteErrorPage />,
        children: [
          // The home page lives at /customer/home (lib/paths.ts); `/` sends visitors there, keeping the query.
          { index: true, element: <HomeRedirect /> },
          { path: 'customer/home', element: <HomePage /> },
          // ---- Flights (public) ----
          { path: 'flights', lazy: async () => ({ Component: (await import('@/features/flights/FlightsLandingPage')).FlightsLandingPage }) },
          { path: 'flights/search', lazy: async () => ({ Component: (await import('@/features/flights/FlightSearchPage')).FlightSearchPage }) },
          { path: 'flights/trip/:tripOfferId', lazy: async () => ({ Component: (await import('@/features/flights/FlightDetailsPage')).FlightDetailsPage }) },
          // ---- Hotels (public) ----
          { path: 'hotels', lazy: async () => ({ Component: (await import('@/features/hotels/HotelsLandingPage')).HotelsLandingPage }) },
          { path: 'hotels/search', lazy: async () => ({ Component: (await import('@/features/hotels/HotelSearchPage')).HotelSearchPage }) },
          { path: 'hotels/quote/:quoteId', lazy: async () => ({ Component: (await import('@/features/hotels/HotelQuotePage')).HotelQuotePage }) },
          { path: 'hotels/:slug', lazy: async () => ({ Component: (await import('@/features/hotels/HotelDetailsPage')).HotelDetailsPage }) },
          { path: 'offers', lazy: async () => ({ Component: (await import('@/features/offers/OffersPage')).OffersPage }) },
          { path: 'help', lazy: async () => ({ Component: (await import('@/features/help/HelpPage')).HelpPage }) },
          { path: 'about', lazy: async () => ({ Component: (await import('@/features/about/AboutPage')).AboutPage }) },
          { path: 'contact', lazy: async () => ({ Component: (await import('@/features/help/ContactPage')).ContactPage }) },
          // ---- Global search results (everyone, signed in or not; what is found depends on who asks) ----
          { path: 'search', lazy: async () => ({ Component: (await import('@/features/search/SearchResultsPage')).SearchResultsPage }) },
          // ---- Newsletter links from e-mails (public) ----
          {
            path: 'newsletter/confirm',
            lazy: async () => ({ Component: (await import('@/features/newsletter/NewsletterConfirmPage')).NewsletterConfirmPage }),
          },
          {
            path: 'newsletter/unsubscribe',
            lazy: async () => ({ Component: (await import('@/features/newsletter/NewsletterUnsubscribePage')).NewsletterUnsubscribePage }),
          },

          // The account flows (register, verify e-mail, forgot / reset password) are full screen, with sign-in above.

          // ---- The customer area: dashboard, My Trips and My account beside one sidebar (CustomerAreaLayout) ----
          // Booking and payment steps stay outside it (focused, single-column flows).
          { path: 'customer', element: <Navigate to="/customer/dashboard" replace /> },
          {
            lazy: async () => ({ Component: (await import('@/features/account/CustomerAreaLayout')).CustomerAreaLayout }),
            children: [
              // Customers only; where they land after sign-in.
              {
                path: 'customer/dashboard',
                element: <RequireRole roles={['CUSTOMER']} area="customer" />,
                children: [
                  { index: true, lazy: async () => ({ Component: (await import('@/features/customer/CustomerDashboardPage')).CustomerDashboardPage }) },
                ],
              },
              // Any logged-in user.
              {
                element: <RequireAuth area="customer" />,
                children: [
                  { path: 'my-trips', lazy: async () => ({ Component: (await import('@/features/bookings/MyTripsPage')).MyTripsPage }) },
                  { path: 'my-trips/:bookingId', lazy: async () => ({ Component: (await import('@/features/bookings/BookingDetailsPage')).BookingDetailsPage }) },
                ],
              },
              {
                path: 'account',
                element: <RequireAuth area="customer" />,
                children: [
                  {
                    lazy: async () => ({ Component: (await import('@/features/account/AccountLayout')).AccountLayout }),
                    children: [
                      { index: true, element: <Navigate to="profile" replace /> },
                      { path: 'profile', lazy: async () => ({ Component: (await import('@/features/account/ProfilePage')).ProfilePage }) },
                      {
                        path: 'passengers',
                        lazy: async () => ({ Component: (await import('@/features/account/PassengersPage')).PassengersPage }),
                      },
                      {
                        path: 'payments',
                        lazy: async () => ({ Component: (await import('@/features/payments/PaymentHistoryPage')).PaymentHistoryPage }),
                      },
                      {
                        path: 'notifications',
                        lazy: async () => ({ Component: (await import('@/features/notifications/NotificationCenterPage')).NotificationCenterPage }),
                      },
                      {
                        path: 'notifications/settings',
                        lazy: async () => ({ Component: (await import('@/features/notifications/NotificationSettingsPage')).NotificationSettingsPage }),
                      },
                      { path: 'support', lazy: async () => ({ Component: (await import('@/features/tickets/TicketsPage')).TicketsPage }) },
                      { path: 'support/new', lazy: async () => ({ Component: (await import('@/features/tickets/NewTicketPage')).NewTicketPage }) },
                      { path: 'support/:ticketId', lazy: async () => ({ Component: (await import('@/features/tickets/TicketPage')).TicketPage }) },
                      { path: 'reviews', lazy: async () => ({ Component: (await import('@/features/reviews/MyReviewsPage')).MyReviewsPage }) },
                      { path: 'reviews/write/:bookingId', lazy: async () => ({ Component: (await import('@/features/reviews/WriteReviewPage')).WriteReviewPage }) },
                      {
                        path: 'preferences',
                        lazy: async () => ({ Component: (await import('@/features/account/PreferencesPage')).PreferencesPage }),
                      },
                      { path: 'security', lazy: async () => ({ Component: (await import('@/features/account/SecurityPage')).SecurityPage }) },
                    ],
                  },
                ],
              },
            ],
          },

          // ---- Booking and payment steps, cancelling a trip (logged-in customers) ----
          {
            element: <RequireAuth area="customer" />,
            children: [
              { path: 'book/hotel/:quoteId', lazy: async () => ({ Component: (await import('@/features/bookings/GuestDetailsPage')).GuestDetailsPage }) },
              { path: 'book/hotel/:quoteId/review', lazy: async () => ({ Component: (await import('@/features/bookings/BookingReviewPage')).BookingReviewPage }) },
              { path: 'book/flight/:tripOfferId', lazy: async () => ({ Component: (await import('@/features/flights/PassengerDetailsPage')).PassengerDetailsPage }) },
              { path: 'book/flight/:tripOfferId/review', lazy: async () => ({ Component: (await import('@/features/flights/FlightReviewPage')).FlightReviewPage }) },
              { path: 'my-trips/:bookingId/cancel', lazy: async () => ({ Component: (await import('@/features/bookings/CancelBookingPage')).CancelBookingPage }) },
              { path: 'my-trips/:bookingId/pay', lazy: async () => ({ Component: (await import('@/features/payments/PaymentPage')).PaymentPage }) },
              { path: 'my-trips/:bookingId/result', lazy: async () => ({ Component: (await import('@/features/payments/PaymentResultPage')).PaymentResultPage }) },
            ],
          },

          // ---- Component gallery: development builds only (removed from production bundles) ----
          ...(import.meta.env.DEV
            ? [{ path: 'dev/design-system', lazy: async () => ({ Component: (await import('@/features/dev/DesignSystemPage')).DesignSystemPage }) }]
            : []),

          { path: '*', element: <NotFoundPage /> },
        ],
      },
      // ---- Staff portals in the staff shell (support actions also depend on the user's permissions) ----
      {
        errorElement: <RouteErrorPage />,
        children: [
          {
            path: 'admin',
            element: <RequireRole roles={['ADMIN']} area="admin" />,
            children: [
              {
                lazy: async () => ({ Component: (await import('@/features/admin/AdminLayout')).AdminLayout }),
                // Dashboard, users, bookings, payments, coupons, reviews, support, reports, audit logs, settings, ...
                children: adminRoutes,
              },
            ],
          },
          {
            path: 'hotel-manager',
            element: <RequireRole roles={['HOTEL_MANAGER', 'ADMIN']} area="hotel-manager" />,
            children: [
              {
                lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelManagerLayout')).HotelManagerLayout }),
                children: [
                  { index: true, lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelManagerLayout')).MyHotelsPage }) },
                  { path: 'search', lazy: async () => ({ Component: (await import('@/features/search/SearchResultsPage')).SearchResultsPage }) },
                  { path: 'hotels/:hotelId', element: <Navigate to="dashboard" replace /> },
                  { path: 'hotels/:hotelId/dashboard', lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelDashboardPage')).HotelDashboardPage }) },
                  { path: 'hotels/:hotelId/reservations', lazy: async () => ({ Component: (await import('@/features/hotel-manager/ReservationsPage')).ReservationsPage }) },
                  { path: 'hotels/:hotelId/reservations/:reservationId', lazy: async () => ({ Component: (await import('@/features/hotel-manager/ReservationDetailsPage')).ReservationDetailsPage }) },
                  { path: 'hotels/:hotelId/reviews', lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelReviewsPage')).HotelReviewsPage }) },
                  { path: 'hotels/:hotelId/reports', lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelReportsPage')).HotelReportsPage }) },
                  { path: 'hotels/:hotelId/profile', lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelProfilePage')).HotelProfilePage }) },
                  { path: 'hotels/:hotelId/photos', lazy: async () => ({ Component: (await import('@/features/hotel-manager/HotelPhotosPage')).HotelPhotosPage }) },
                  { path: 'hotels/:hotelId/rooms', lazy: async () => ({ Component: (await import('@/features/hotel-manager/RoomsRatesPage')).RoomsRatesPage }) },
                  { path: 'hotels/:hotelId/inventory', lazy: async () => ({ Component: (await import('@/features/hotel-manager/InventoryCalendarPage')).InventoryCalendarPage }) },
                ],
              },
            ],
          },
          {
            path: 'support',
            element: <RequireRole roles={['SUPPORT_AGENT', 'ADMIN']} area="support" />,
            children: [
              {
                lazy: async () => ({ Component: (await import('@/features/support/SupportLayout')).SupportLayout }),
                children: [
                  { index: true, lazy: async () => ({ Component: (await import('@/features/support/SupportDashboardPage')).SupportDashboardPage }) },
                  { path: 'bookings', lazy: async () => ({ Component: (await import('@/features/support/SupportBookingsPage')).SupportBookingsPage }) },
                  { path: 'attention', lazy: async () => ({ Component: (await import('@/features/support/SupportBookingsPage')).NeedsAttentionPage }) },
                  { path: 'bookings/:bookingId', lazy: async () => ({ Component: (await import('@/features/support/SupportBookingPage')).SupportBookingPage }) },
                  { path: 'tickets', lazy: async () => ({ Component: (await import('@/features/support/TicketQueuePage')).TicketQueuePage }) },
                  { path: 'tickets/:ticketId', lazy: async () => ({ Component: (await import('@/features/support/AgentTicketPage')).AgentTicketPage }) },
                  { path: 'escalations', lazy: async () => ({ Component: (await import('@/features/support/EscalationsPage')).EscalationsPage }) },
                  { path: 'search', lazy: async () => ({ Component: (await import('@/features/search/SearchResultsPage')).SearchResultsPage }) },
                  { path: '*', element: <UnderConstructionPage title="This support section" phase="a later phase" /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
