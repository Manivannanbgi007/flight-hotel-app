import type { Change } from '@/components/analytics/growth';
import { analyticsApiParams, type AnalyticsInterval, type AnalyticsQuery, type AnalyticsRangeEcho } from '@/components/analytics/range';
import { apiClient } from '@/lib/api/client';

/** Money and bookings of one product (or of both, `all`) for the range (api-analytics §2). */
export interface ProductFigures {
  /** Paid bookings created in the range. */
  bookings: number;
  /** Of those, cancelled since. */
  cancelled: number;
  cancellationRate: number;
  gross: number;
  refunds: number;
  net: number;
}

/** One point of `series` (one day, week, month or year; the first and the last are cut to the range). */
export type DashboardPoint = {
  key: string;
  start: string;
  end: string;
  bookings: number;
  hotelBookings: number;
  flightBookings: number;
  cancellations: number;
  gross: number;
  refunds: number;
  net: number;
  hotelGross: number;
  flightGross: number;
  hotelNet: number;
  flightNet: number;
  successfulPayments: number;
  failedPayments: number;
  failedAmount: number;
  newCustomers: number;
};

export type CancellationInitiator = 'CUSTOMER' | 'SUPPORT_AGENT' | 'ADMIN' | 'HOTEL';

/**
 * `GET /api/admin/dashboard` v2 (api-analytics §2, permission REPORT_VIEW). Every figure is for the range and comes
 * from the server; `comparison` is against the same number of days right before it (`previousRange`).
 */
export interface AdminDashboard {
  range: AnalyticsRangeEcho;
  /** `active`: customers with a paid booking created in the range (each once). */
  customers: { total: number; newInRange: number; active: number };
  bookings: { flight: number; hotel: number; upcoming: number; completed: number; cancelled: number; pending: number; failed: number };
  payments: {
    pendingCount: number;
    pendingAmount: number;
    successfulCount: number;
    successfulAmount: number;
    failedCount: number;
    failedAmount: number;
    /** successful / (successful + failed) × 100; 0 without attempts. */
    successRate: number;
  };
  revenue: { gross: number; refunds: number; net: number; currency: string };
  /** `previousBookings`: the city's paid bookings in `previousRange` (the trend); revenue is net of refunds. */
  popularDestinations: { city: string; bookings: number; revenue: number; previousBookings: number }[];
  topHotels: { hotelId: string; hotelName: string; city: string; bookings: number; revenue: number; previousBookings: number }[];
  recentBookings: {
    id: string;
    reference: string;
    type: 'HOTEL' | 'FLIGHT';
    status: string;
    title: string | null;
    totalAmount: number;
    createdAt: string;
    /** Null when the account is not known to reporting yet; the e-mail is the booking's contact. */
    customerName: string | null;
    customerEmail: string | null;
    destination: string | null;
  }[];
  recentActivity: { occurredAt: string; action: string; entityType: string; entityId: string; service: string; actorRole: string | null }[];
  generatedAt: string;
  interval: AnalyticsInterval;
  previousRange: AnalyticsRangeEcho;
  products: { hotel: ProductFigures; flight: ProductFigures; all: ProductFigures };
  cancellations: {
    count: number;
    hotel: number;
    flight: number;
    byInitiator: Record<CancellationInitiator, number>;
    cancellationFees: number;
    refundAmount: number;
    rate: number;
    hotelRate: number;
    flightRate: number;
  };
  comparison: {
    bookings: Change;
    hotelBookings: Change;
    flightBookings: Change;
    grossRevenue: Change;
    refunds: Change;
    netRevenue: Change;
    /** Net. */
    hotelRevenue: Change;
    /** Net. */
    flightRevenue: Change;
    successfulPayments: Change;
    failedPayments: Change;
    cancellations: Change;
    /** In percentage points. */
    cancellationRate: Change;
    newCustomers: Change;
  };
  series: DashboardPoint[];
  /** The activity feed (Phase 12): customers, bookings, cancellations, payments, refunds and tickets, newest first. */
  timeline: TimelineEvent[];
}

export type TimelineOutcome = 'SUCCESS' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'INFO';

export interface TimelineEvent {
  at: string;
  /** CUSTOMER_REGISTERED, BOOKING_CREATED, BOOKING_CANCELLED, PAYMENT_SUCCEEDED, PAYMENT_FAILED, SUPPORT_TICKET, BOOKING_REFUND_*. */
  type: string;
  outcome: TimelineOutcome;
  title: string;
  detail: string | null;
  amount: number | null;
  entityType: string;
  entityId: string;
}

export const dashboardApi = {
  /** `?range=&from=&to=&interval=`: without an interval the server chooses one (echoed as `interval`). */
  async get(query: AnalyticsQuery): Promise<AdminDashboard> {
    const { data } = await apiClient.get<AdminDashboard>('/admin/dashboard', { params: analyticsApiParams(query) });
    return data;
  },
};
