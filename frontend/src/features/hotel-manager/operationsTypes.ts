import type { Change } from '@/components/analytics/growth';
import type { AnalyticsInterval, AnalyticsPreset } from '@/components/analytics/range';

/**
 * Hotel manager operations (API_DOCUMENTATION.md §14.0, §14.4, §14.5): dashboard, reservations and guests,
 * check-in/out, reports and the hotel's reviews. Money is INR.
 */

/**
 * Report date range presets (§14.0; api-analytics §6 added the longer ones, each at most 366 days). Days are India days;
 * CUSTOM needs `from` and `to` (both inclusive). The dashboard uses the analytics ranges (components/analytics).
 */
export type RangePreset =
  | 'TODAY' | 'LAST_7_DAYS' | 'LAST_14_DAYS' | 'LAST_30_DAYS' | 'LAST_90_DAYS' | 'THIS_MONTH' | 'PREVIOUS_MONTH'
  | 'LAST_12_MONTHS' | 'THIS_YEAR' | 'PREVIOUS_YEAR' | 'CUSTOM';

/** What the page asks for (kept in the URL). */
export interface DateRangeQuery {
  range: RangePreset;
  /** Only for CUSTOM. */
  from?: string;
  to?: string;
}

/** The range every answer echoes back, with the real dates (the dashboard also echoes the longer analytics presets). */
export interface RangeEcho {
  preset: RangePreset | AnalyticsPreset | 'PREVIOUS_PERIOD';
  from: string;
  to: string;
}

export type ReservationStatus = 'HELD' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW' | 'CANCELLED' | 'EXPIRED' | 'RELEASED';

export interface ReservationRow {
  reservationId: string;
  bookingId: string | null;
  bookingReference: string | null;
  status: ReservationStatus;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  adults: number;
  children: number;
  roomTypeName: string | null;
  ratePlanName: string | null;
  leadGuest: string | null;
  totalAmount: number | null;
  /** INR; sent by the API as built (rows and details). */
  currency?: string;
  confirmationNumber: string | null;
  createdAt: string;
}

export interface ReservationGuest {
  roomNo: number;
  firstName: string;
  lastName: string;
}

export interface ReservationDetails extends ReservationRow {
  guests: ReservationGuest[];
  contactEmail: string | null;
  contactPhone: string | null;
  specialRequests: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  cancelledAt: string | null;
  cancellationReference: string | null;
  cancelledBy: 'CUSTOMER' | 'HOTEL' | null;
  /** As built (hotel-service): room charges without GST, GST, and more timestamps. */
  subtotal?: number | null;
  taxes?: number | null;
  confirmedAt?: string | null;
  noShowAt?: string | null;
  cancellationReason?: string | null;
}

/** One point of the dashboard's `trend` (api-analytics §4): nights of the point, bookings and reviews of its days. */
export type HotelTrendPoint = {
  key: string;
  start: string;
  end: string;
  availableRoomNights: number;
  bookedRoomNights: number;
  occupancyPercent: number;
  soldRoomNights: number;
  revenue: number;
  averageDailyRate: number;
  revPar: number;
  reservations: number;
  cancellations: number;
  newReviews: number;
  /** Average of the reviews approved in the point; null without any. */
  averageRating: number | null;
  /** The hotel's rating at the end of the point. */
  guestRating: number | null;
  reviewCount: number;
};

/**
 * `GET /api/hotel-manager/hotels/{hotelId}/dashboard` v2 (api-analytics §4). The range accepts every analytics preset
 * (up to five years) and an `interval`; `comparison` is against the same number of days right before the range.
 */
export interface HotelDashboard {
  range: RangeEcho;
  hotelId?: string;
  hotelName?: string;
  today: {
    date?: string;
    arrivals: number;
    departures: number;
    /** Reservations checked in now. */
    inHouse: number;
    occupancyPercent: number;
    arrivingGuests: number;
    departingGuests: number;
    inHouseGuests: number;
    inHouseRooms: number;
    /** Rooms the hotel can sell, rooms for sale tonight and rooms booked tonight (the rooms behind the occupancy). */
    totalRooms?: number;
    roomsForSale?: number;
    roomsBooked?: number;
  };
  /** Reservations arriving in the next 7 days. */
  upcomingArrivals: ReservationRow[];
  /** For the range. */
  stats: {
    reservations: number;
    /** Rooms sold on the nights of the range (revenue report). */
    roomNights: number;
    revenue: number;
    cancellations: number;
    occupancyPercent: number;
    averageDailyRate: number;
    availableRoomNights: number;
    bookedRoomNights: number;
    revPar: number;
  };
  interval: AnalyticsInterval;
  previousRange: RangeEcho;
  cancellations: { count: number; byCustomer: number; byHotel: number; ofBooked: number; rate: number };
  ratings: {
    guestRating: number | null;
    reviewCount: number;
    newReviews: number;
    averageNewRating: number | null;
    pendingReviews: number;
  };
  comparison: {
    revenue: Change;
    /** In percentage points. */
    occupancyPercent: Change;
    averageDailyRate: Change;
    revPar: Change;
    soldRoomNights: Change;
    reservations: Change;
    cancellations: Change;
    newReviews: Change;
  };
  trend: HotelTrendPoint[];
}

export type ReservationSort = 'createdAt,desc' | 'checkIn,asc' | 'checkIn,desc';
export type ReservationDateField = 'CHECK_IN' | 'CREATED';

/** The reservation list's filters, as kept in the URL. Empty strings mean "any". */
/** `GET …/reservations/summary`: reservations per status for the list's own filters (not the status). */
export interface ReservationSummary {
  /** Every paid reservation: confirmed, checked in, checked out, no-show and cancelled. */
  total: number;
  confirmed: number;
  /** Held, waiting for the guest's payment. */
  pending: number;
  checkedIn: number;
  checkedOut: number;
  cancelled: number;
  noShow: number;
}

/** `GET …/reviews/summary`: approved reviews only, except `pending`. */
export interface ReviewSummary {
  average: number | null;
  total: number;
  fiveStar: number;
  positive: number;
  negative: number;
  pending: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  /** The last 12 months, oldest first. */
  months: { month: string; reviews: number; average: number | null; positive: number; negative: number }[];
}

export type ReviewSortKey = 'newest' | 'oldest' | 'highest' | 'lowest';

/** `GET …/reports/room-types`: one row per room type. */
export interface RoomTypeReport {
  range: RangeEcho | null;
  currency: string;
  rows: { roomTypeId: string; name: string; stays: number; roomNights: number; revenue: number; averageDailyRate: number; revenueShare: number }[];
  roomNights: number;
  revenue: number;
}

export interface ReservationFilters {
  /** Only this room type (an id of the hotel's own room types); '' or missing = all. */
  roomTypeId?: string;
  /** '' = every reservation except held, expired and released ones (the API only lists those on request). */
  status: ReservationStatus | '';
  dateField: ReservationDateField;
  from: string;
  to: string;
  /** Booking reference, confirmation number or guest name. */
  q: string;
  sort: ReservationSort;
  page: number;
}

export type ReportKind = 'occupancy' | 'revenue';

export interface OccupancyNight {
  date: string;
  /** Rooms for sale that night. */
  roomNights: number;
  bookedRoomNights: number;
  occupancyPercent: number;
}

export interface RevenueNight {
  date: string;
  /** Room nights sold that night. */
  roomNights: number;
  /** Room charges without GST, spread over the nights of each stay. */
  revenue: number;
  averageDailyRate: number;
}

export interface OccupancyReport {
  range: RangeEcho | null;
  rows: OccupancyNight[];
  totals: { roomNights: number; bookedRoomNights: number; occupancyPercent: number };
}

export interface RevenueReport {
  range: RangeEcho | null;
  rows: RevenueNight[];
  totals: { roomNights: number; revenue: number; averageDailyRate: number };
}

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** One review of the hotel as its manager sees it (read only; moderation is the admin's job). */
export interface ManagerReview {
  id: string;
  rating: number;
  title: string;
  text: string;
  authorName: string | null;
  status: ReviewStatus;
  createdAt: string;
  stayedIn?: string | null;
  bookingReference?: string | null;
  rejectionReason?: string | null;
  moderatedAt?: string | null;
}

