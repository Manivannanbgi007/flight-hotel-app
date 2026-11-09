/**
 * Every TanStack Query key in one place. Features use these builders, and the realtime invalidation rules use
 * them too, so a server signal always refreshes exactly the right cached data.
 *
 * Keys are hierarchical: invalidating `queryKeys.bookings.all` also refreshes every `bookings.detail(id)`.
 */
export const queryKeys = {
  publicSettings: ['public-settings'] as const,
  /** Public hotel catalogue (search, details, prices, quotes). */
  hotels: {
    all: ['hotels'] as const,
    search: (query: string) => ['hotels', 'search', query] as const,
    details: (idOrSlug: string) => ['hotels', 'details', idOrSlug] as const,
    rooms: (hotelId: string, stay: string) => ['hotels', 'rooms', hotelId, stay] as const,
    quote: (quoteId: string) => ['hotels', 'quote', quoteId] as const,
    destinations: (query: string) => ['hotels', 'destinations', query] as const,
    amenities: ['hotels', 'amenities'] as const,
  },
  /** Public flight catalogue (airports, search results, revalidated trip offers). */
  flights: {
    all: ['flights'] as const,
    airports: (query: string) => ['flights', 'airports', query] as const,
    airlines: ['flights', 'airlines'] as const,
    popular: ['flights', 'popular-routes'] as const,
    search: (query: string) => ['flights', 'search', query] as const,
    trip: (tripOfferId: string) => ['flights', 'trip', tripOfferId] as const,
  },
  /** The logged-in user's own data (/api/customers). Removed from the cache on logout. */
  account: {
    all: ['account'] as const,
    profile: ['account', 'profile'] as const,
    profilePhoto: ['account', 'profile-photo'] as const,
    passengers: ['account', 'passengers'] as const,
    preferences: ['account', 'preferences'] as const,
    loginHistory: (page: number) => ['account', 'login-history', page] as const,
  },
  bookings: {
    all: ['bookings'] as const,
    list: (filters: Record<string, unknown>) => ['bookings', 'list', filters] as const,
    detail: (bookingId: string) => ['bookings', 'detail', bookingId] as const,
    timeline: (bookingId: string) => ['bookings', 'timeline', bookingId] as const,
    /** Every cancellation quote of one booking (with and without the fee waived). */
    cancellationQuotes: (bookingId: string) => ['bookings', 'cancellation-quote', bookingId] as const,
    cancellationQuote: (bookingId: string, waiveFee: boolean) => ['bookings', 'cancellation-quote', bookingId, { waiveFee }] as const,
    /**
     * The customer dashboard's summary (`GET /api/bookings/summary`) for one period. Under `bookings.all`, so every
     * booking, payment and refund event that refreshes My Trips refreshes the dashboard too.
     */
    summary: (params: Record<string, unknown>) => ['bookings', 'summary', params] as const,
  },
  payments: {
    all: ['payments'] as const,
    history: (filters: Record<string, unknown>) => ['payments', 'history', filters] as const,
    summary: (filters: Record<string, unknown>) => ['payments', 'summary', filters] as const,
    detail: (paymentId: string) => ['payments', 'detail', paymentId] as const,
  },
  /** The bell and the Notification Center. Live updates (`notification.created` / `.read`) refresh all of them. */
  notifications: {
    all: ['notifications'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    /** The bell's latest notifications. */
    latest: ['notifications', 'latest'] as const,
    /** Every Notification Center page (any filter). */
    lists: ['notifications', 'list'] as const,
    list: (filters: Record<string, unknown>) => ['notifications', 'list', filters] as const,
    /** Category × channel switches and the newsletter. Outside `all`: a new notification does not change them. */
    preferences: ['notification-preferences'] as const,
  },
  /** PDFs of a booking (confirmation, e-ticket, invoice, receipts). */
  documents: {
    all: ['documents'] as const,
    forBooking: (bookingId: string) => ['documents', 'booking', bookingId] as const,
  },
  support: {
    /** The customer's own tickets: every list page and every conversation. */
    tickets: ['support', 'tickets'] as const,
    ticket: (ticketId: string) => ['support', 'tickets', ticketId] as const,
    /** Every page of my ticket list (any filter). */
    ticketLists: ['support', 'tickets', 'list'] as const,
    ticketList: (filters: Record<string, unknown>) => ['support', 'tickets', 'list', filters] as const,
    /** Support booking lookup: every search and the "Needs attention" queue. */
    bookings: ['support', 'bookings'] as const,
    bookingSearch: (filters: Record<string, unknown>) => ['support', 'bookings', filters] as const,
    /** Support agents' ticket queue (every filter and page) and the counts on the support dashboard. */
    queue: ['support', 'queue'] as const,
    queueList: (filters: Record<string, unknown>) => ['support', 'queue', filters] as const,
    summary: ['support', 'summary'] as const,
    /** My own ticket counts (the customer's support page). */
    mySummary: ['support', 'tickets', 'my-summary'] as const,
    /** Support metrics (api-analytics §5): every range and interval. */
    metrics: ['support', 'metrics'] as const,
    metricsRange: (params: Record<string, unknown>) => ['support', 'metrics', params] as const,
  },
  reviews: {
    all: ['reviews'] as const,
    /** My stays that can be reviewed, and my own reviews (any status). */
    eligible: ['reviews', 'eligible'] as const,
    mine: ['reviews', 'mine'] as const,
    /** Every page of one hotel's public reviews. */
    forHotel: (idOrSlug: string) => ['reviews', 'hotel', idOrSlug] as const,
    hotelPage: (idOrSlug: string, filters: Record<string, unknown>) => ['reviews', 'hotel', idOrSlug, filters] as const,
    featured: ['reviews', 'featured'] as const,
  },
  /** Public home page and offers data (reporting-service, booking-service, hotel-service). */
  publicContent: {
    all: ['public'] as const,
    popularDestinations: ['public', 'popular-destinations'] as const,
    popularRoutes: ['public', 'popular-routes'] as const,
    recommendedHotels: ['public', 'recommended-hotels'] as const,
    offers: ['public', 'offers'] as const,
  },
  hotelManager: {
    all: ['hotel-manager'] as const,
    hotels: ['hotel-manager', 'hotels'] as const,
    profile: (hotelId: string) => ['hotel-manager', hotelId, 'profile'] as const,
    roomTypes: (hotelId: string) => ['hotel-manager', hotelId, 'room-types'] as const,
    reservations: (hotelId: string) => ['hotel-manager', hotelId, 'reservations'] as const,
    inventory: (hotelId: string) => ['hotel-manager', hotelId, 'inventory'] as const,
    dashboard: (hotelId: string) => ['hotel-manager', hotelId, 'dashboard'] as const,
    dashboardRange: (hotelId: string, range: Record<string, unknown>) => ['hotel-manager', hotelId, 'dashboard', range] as const,
    /** Under `reservations(hotelId)`, so a reservation change refreshes the lists and the open reservation. */
    reservationList: (hotelId: string, filters: Record<string, unknown>) => ['hotel-manager', hotelId, 'reservations', 'list', filters] as const,
    reservation: (hotelId: string, reservationId: string) => ['hotel-manager', hotelId, 'reservations', 'detail', reservationId] as const,
    /** Occupancy and revenue reports of one hotel (every range). */
    reports: (hotelId: string) => ['hotel-manager', hotelId, 'reports'] as const,
    report: (hotelId: string, report: string, range: Record<string, unknown>) => ['hotel-manager', hotelId, 'reports', report, range] as const,
    reviews: (hotelId: string) => ['hotel-manager', hotelId, 'reviews'] as const,
    reviewList: (hotelId: string, filters: Record<string, unknown>) => ['hotel-manager', hotelId, 'reviews', filters] as const,
    reviewSummary: (hotelId: string) => ['hotel-manager', hotelId, 'reviews', 'summary'] as const,
    /** Under `reservations(hotelId)`: a reservation change refreshes the counts too. */
    reservationSummary: (hotelId: string, filters: Record<string, unknown>) => ['hotel-manager', hotelId, 'reservations', 'summary', filters] as const,
  },
  admin: {
    dashboard: ['admin', 'dashboard'] as const,
    hotels: (query: string) => ['admin', 'hotels', query] as const,
    hotelManagers: (hotelId: string) => ['admin', 'hotel-managers', hotelId] as const,
    settings: ['admin', 'settings'] as const,
    flightProviders: ['admin', 'flight-providers'] as const,
    bookings: ['admin', 'bookings'] as const,
    payments: ['admin', 'payments'] as const,
    refunds: ['admin', 'refunds'] as const,
    reviews: ['admin', 'reviews'] as const,
    /** Admin portal (Phase 9): each list key is the prefix of its filtered pages, so one invalidation refreshes them all. */
    dashboardRange: (range: Record<string, unknown>) => ['admin', 'dashboard', range] as const,
    users: ['admin', 'users'] as const,
    userList: (filters: Record<string, unknown>) => ['admin', 'users', 'list', filters] as const,
    user: (userId: string) => ['admin', 'users', 'detail', userId] as const,
    bookingList: (filters: Record<string, unknown>) => ['admin', 'bookings', filters] as const,
    paymentList: (filters: Record<string, unknown>) => ['admin', 'payments', 'list', filters] as const,
    paymentSummary: (filters: Record<string, unknown>) => ['admin', 'payments', 'summary', filters] as const,
    payment: (paymentId: string) => ['admin', 'payments', 'detail', paymentId] as const,
    refundList: (filters: Record<string, unknown>) => ['admin', 'refunds', filters] as const,
    coupons: ['admin', 'coupons'] as const,
    couponList: (filters: Record<string, unknown>) => ['admin', 'coupons', filters] as const,
    offers: ['admin', 'offers'] as const,
    offerList: (filters: Record<string, unknown>) => ['admin', 'offers', filters] as const,
    reviewList: (filters: Record<string, unknown>) => ['admin', 'reviews', filters] as const,
    /** Every report (and the hotel occupancy report): figures change when the reporting facts change. */
    reports: ['admin', 'reports'] as const,
    report: (report: string, filters: Record<string, unknown>) => ['admin', 'reports', report, filters] as const,
    auditLogs: (filters: Record<string, unknown>) => ['admin', 'audit-logs', filters] as const,
    /** The signed-in admin's audit log exports prepared on the server (`export.status-changed` refreshes them). */
    auditExports: ['admin', 'audit-exports'] as const,
  },
  /**
   * Global search (search-service). What it finds depends on who asks, so it is user data (removed on logout), and the
   * keys name the viewer (a user id, or "anon"): results cached before signing in are not shown after it.
   */
  search: {
    all: ['search'] as const,
    suggest: (query: string, viewer = 'anon') => ['search', 'suggest', viewer, query] as const,
    results: (params: Record<string, unknown>, viewer = 'anon') => ['search', 'results', viewer, params] as const,
  },
  /** The AI assistant (Phase 11). Needs a login, so it is user data (removed on logout). */
  assistant: {
    all: ['assistant'] as const,
    /** `GET /api/assistant/config`: available, model, voice, limits. One cached query, refetched on focus. */
    config: ['assistant', 'config'] as const,
  },
} as const;

/** Roots of the keys that hold public data. Everything else is user data and is removed from the cache on logout. */
export const PUBLIC_QUERY_ROOTS: readonly string[] = [
  queryKeys.publicSettings[0],
  queryKeys.hotels.all[0],
  queryKeys.flights.all[0],
  queryKeys.publicContent.all[0],
];
