/**
 * Every TanStack Query key in one place. Features use these builders, and the realtime invalidation rules use
 * them too, so a server signal always refreshes exactly the right cached data.
 *
 * Keys are hierarchical: invalidating `queryKeys.bookings.all` also refreshes every `bookings.detail(id)`.
 */
export const queryKeys = {
  publicSettings: ['public-settings'],
  /** Public hotel catalogue (search, details, prices, quotes). */
  hotels: {
    all: ['hotels'],
    search: (query) => ['hotels', 'search', query],
    details: (idOrSlug) => ['hotels', 'details', idOrSlug],
    rooms: (hotelId, stay) => ['hotels', 'rooms', hotelId, stay],
    quote: (quoteId) => ['hotels', 'quote', quoteId],
    destinations: (query) => ['hotels', 'destinations', query],
    amenities: ['hotels', 'amenities'],
  },
  /** Public flight catalogue (airports, search results, revalidated trip offers). */
  flights: {
    all: ['flights'],
    airports: (query) => ['flights', 'airports', query],
    airlines: ['flights', 'airlines'],
    popular: ['flights', 'popular-routes'],
    search: (query) => ['flights', 'search', query],
    trip: (tripOfferId) => ['flights', 'trip', tripOfferId],
  },
  /** The logged-in user's own data (/api/customers). Removed from the cache on logout. */
  account: {
    all: ['account'],
    profile: ['account', 'profile'],
    profilePhoto: ['account', 'profile-photo'],
    passengers: ['account', 'passengers'],
    preferences: ['account', 'preferences'],
    loginHistory: (page) => ['account', 'login-history', page],
  },
  bookings: {
    all: ['bookings'],
    list: (filters) => ['bookings', 'list', filters],
    detail: (bookingId) => ['bookings', 'detail', bookingId],
    timeline: (bookingId) => ['bookings', 'timeline', bookingId],
    /** Every cancellation quote of one booking (with and without the fee waived). */
    cancellationQuotes: (bookingId) => ['bookings', 'cancellation-quote', bookingId],
    cancellationQuote: (bookingId, waiveFee) => ['bookings', 'cancellation-quote', bookingId, { waiveFee }],
    /**
     * The customer dashboard's summary (`GET /api/bookings/summary`) for one period. Under `bookings.all`, so every
     * booking, payment and refund event that refreshes My Trips refreshes the dashboard too.
     */
    summary: (params) => ['bookings', 'summary', params],
  },
  payments: {
    all: ['payments'],
    history: (filters) => ['payments', 'history', filters],
    summary: (filters) => ['payments', 'summary', filters],
    detail: (paymentId) => ['payments', 'detail', paymentId],
  },
  /** The bell and the Notification Center. Live updates (`notification.created` / `.read`) refresh all of them. */
  notifications: {
    all: ['notifications'],
    unreadCount: ['notifications', 'unread-count'],
    /** The bell's latest notifications. */
    latest: ['notifications', 'latest'],
    /** Every Notification Center page (any filter). */
    lists: ['notifications', 'list'],
    list: (filters) => ['notifications', 'list', filters],
    /** Category × channel switches and the newsletter. Outside `all`: a new notification does not change them. */
    preferences: ['notification-preferences'],
  },
  /** PDFs of a booking (confirmation, e-ticket, invoice, receipts). */
  documents: {
    all: ['documents'],
    forBooking: (bookingId) => ['documents', 'booking', bookingId],
  },
  support: {
    /** The customer's own tickets: every list page and every conversation. */
    tickets: ['support', 'tickets'],
    ticket: (ticketId) => ['support', 'tickets', ticketId],
    /** Every page of my ticket list (any filter). */
    ticketLists: ['support', 'tickets', 'list'],
    ticketList: (filters) => ['support', 'tickets', 'list', filters],
    /** Support booking lookup: every search and the "Needs attention" queue. */
    bookings: ['support', 'bookings'],
    bookingSearch: (filters) => ['support', 'bookings', filters],
    /** Support agents' ticket queue (every filter and page) and the counts on the support dashboard. */
    queue: ['support', 'queue'],
    queueList: (filters) => ['support', 'queue', filters],
    summary: ['support', 'summary'],
    /** My own ticket counts (the customer's support page). */
    mySummary: ['support', 'tickets', 'my-summary'],
    /** Support metrics (api-analytics §5): every range and interval. */
    metrics: ['support', 'metrics'],
    metricsRange: (params) => ['support', 'metrics', params],
  },
  reviews: {
    all: ['reviews'],
    /** My stays that can be reviewed, and my own reviews (any status). */
    eligible: ['reviews', 'eligible'],
    mine: ['reviews', 'mine'],
    /** Every page of one hotel's public reviews. */
    forHotel: (idOrSlug) => ['reviews', 'hotel', idOrSlug],
    hotelPage: (idOrSlug, filters) => ['reviews', 'hotel', idOrSlug, filters],
    featured: ['reviews', 'featured'],
  },
  /** Public home page and offers data (reporting-service, booking-service, hotel-service). */
  publicContent: {
    all: ['public'],
    popularDestinations: ['public', 'popular-destinations'],
    popularRoutes: ['public', 'popular-routes'],
    recommendedHotels: ['public', 'recommended-hotels'],
    offers: ['public', 'offers'],
  },
  hotelManager: {
    all: ['hotel-manager'],
    hotels: ['hotel-manager', 'hotels'],
    profile: (hotelId) => ['hotel-manager', hotelId, 'profile'],
    roomTypes: (hotelId) => ['hotel-manager', hotelId, 'room-types'],
    reservations: (hotelId) => ['hotel-manager', hotelId, 'reservations'],
    inventory: (hotelId) => ['hotel-manager', hotelId, 'inventory'],
    dashboard: (hotelId) => ['hotel-manager', hotelId, 'dashboard'],
    dashboardRange: (hotelId, range) => ['hotel-manager', hotelId, 'dashboard', range],
    /** Under `reservations(hotelId)`, so a reservation change refreshes the lists and the open reservation. */
    reservationList: (hotelId, filters) => ['hotel-manager', hotelId, 'reservations', 'list', filters],
    reservation: (hotelId, reservationId) => ['hotel-manager', hotelId, 'reservations', 'detail', reservationId],
    /** Occupancy and revenue reports of one hotel (every range). */
    reports: (hotelId) => ['hotel-manager', hotelId, 'reports'],
    report: (hotelId, report, range) => ['hotel-manager', hotelId, 'reports', report, range],
    reviews: (hotelId) => ['hotel-manager', hotelId, 'reviews'],
    reviewList: (hotelId, filters) => ['hotel-manager', hotelId, 'reviews', filters],
    reviewSummary: (hotelId) => ['hotel-manager', hotelId, 'reviews', 'summary'],
    /** Under `reservations(hotelId)`: a reservation change refreshes the counts too. */
    reservationSummary: (hotelId, filters) => ['hotel-manager', hotelId, 'reservations', 'summary', filters],
  },
  admin: {
    dashboard: ['admin', 'dashboard'],
    hotels: (query) => ['admin', 'hotels', query],
    hotelManagers: (hotelId) => ['admin', 'hotel-managers', hotelId],
    settings: ['admin', 'settings'],
    flightProviders: ['admin', 'flight-providers'],
    bookings: ['admin', 'bookings'],
    payments: ['admin', 'payments'],
    refunds: ['admin', 'refunds'],
    reviews: ['admin', 'reviews'],
    /** Admin portal (Phase 9): each list key is the prefix of its filtered pages, so one invalidation refreshes them all. */
    dashboardRange: (range) => ['admin', 'dashboard', range],
    users: ['admin', 'users'],
    userList: (filters) => ['admin', 'users', 'list', filters],
    user: (userId) => ['admin', 'users', 'detail', userId],
    bookingList: (filters) => ['admin', 'bookings', filters],
    paymentList: (filters) => ['admin', 'payments', 'list', filters],
    paymentSummary: (filters) => ['admin', 'payments', 'summary', filters],
    payment: (paymentId) => ['admin', 'payments', 'detail', paymentId],
    refundList: (filters) => ['admin', 'refunds', filters],
    coupons: ['admin', 'coupons'],
    couponList: (filters) => ['admin', 'coupons', filters],
    offers: ['admin', 'offers'],
    offerList: (filters) => ['admin', 'offers', filters],
    reviewList: (filters) => ['admin', 'reviews', filters],
    /** Every report (and the hotel occupancy report): figures change when the reporting facts change. */
    reports: ['admin', 'reports'],
    report: (report, filters) => ['admin', 'reports', report, filters],
    auditLogs: (filters) => ['admin', 'audit-logs', filters],
    /** The signed-in admin's audit log exports prepared on the server (`export.status-changed` refreshes them). */
    auditExports: ['admin', 'audit-exports'],
  },
  /**
   * Global search (search-service). What it finds depends on who asks, so it is user data (removed on logout), and the
   * keys name the viewer (a user id, or "anon"): results cached before signing in are not shown after it.
   */
  search: {
    all: ['search'],
    suggest: (query, viewer = 'anon') => ['search', 'suggest', viewer, query],
    results: (params, viewer = 'anon') => ['search', 'results', viewer, params],
  },
  /** The AI assistant (Phase 11). Needs a login, so it is user data (removed on logout). */
  assistant: {
    all: ['assistant'],
    /** `GET /api/assistant/config`: available, model, voice, limits. One cached query, refetched on focus. */
    config: ['assistant', 'config'],
  },
};

/** Roots of the keys that hold public data. Everything else is user data and is removed from the cache on logout. */
export const PUBLIC_QUERY_ROOTS = [
  queryKeys.publicSettings[0],
  queryKeys.hotels.all[0],
  queryKeys.flights.all[0],
  queryKeys.publicContent.all[0],
];
