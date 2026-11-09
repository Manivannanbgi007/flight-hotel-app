import { apiClient } from '@/lib/api/client';
import type { BookingStatus } from '@/features/bookings/types';

/**
 * `GET /api/bookings/summary` (API_DOCUMENTATION.md, Phase 11 analytics §3): the signed-in customer's own bookings,
 * trips, spending, monthly activity and next trip. Every figure is calculated by the booking service; the UI never
 * invents one.
 */

/** The ranges this page offers (the endpoint accepts more, see §0.2). */
export type SummaryPreset = 'LAST_12_MONTHS' | 'THIS_YEAR' | 'PREVIOUS_YEAR' | 'ALL_TIME' | 'CUSTOM';

export interface SummaryParams {
  range: SummaryPreset;
  /** `YYYY-MM-DD`, both ends inclusive; only with `CUSTOM`. */
  from?: string;
  to?: string;
}

export interface SummaryRange {
  /** The preset asked for (`CUSTOM`, `ALL_TIME`, …). */
  preset: string;
  from: string;
  to: string;
}

export interface MoneySplit {
  paid: number;
  refunded: number;
  net: number;
}

export interface MonthlyActivity {
  /** `YYYY-MM` */
  month: string;
  start: string;
  end: string;
  bookings: number;
  hotelBookings: number;
  flightBookings: number;
  paid: number;
  refunded: number;
  net: number;
}

export interface NextTripHotel {
  hotelName: string;
  city: string | null;
  address: string | null;
  checkIn: string;
  checkOut: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  nights: number | null;
  rooms: number | null;
  guests: number | null;
  roomTypeName: string | null;
  confirmationNumber: string | null;
}

export interface NextTripFlight {
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  cabin: string;
  origin: string;
  destination: string;
  originCity: string | null;
  destinationCity: string | null;
  /** Airport local time, `YYYY-MM-DDTHH:mm`. */
  departureLocal: string;
  arrivalLocal: string | null;
  airlineName: string | null;
  flightNumber: string | null;
  stops: number;
  passengers: number | null;
  pnr: string | null;
  returnDepartureLocal: string | null;
}

export interface NextTrip {
  bookingId: string;
  reference: string;
  type: 'HOTEL' | 'FLIGHT';
  status: BookingStatus;
  title: string | null;
  destination: string | null;
  startDate: string;
  endDate: string | null;
  startsAt: string | null;
  /** India days from today to `startDate`; 0 today or in progress. */
  daysUntil: number;
  inProgress: boolean;
  totalAmount: number;
  currency: string;
  hotel: NextTripHotel | null;
  flight: NextTripFlight | null;
}

export interface CustomerSummary {
  range: SummaryRange;
  /** Bookings created in the range that were paid and confirmed (upcoming + completed + cancelled = total). */
  bookings: { total: number; hotel: number; flight: number; upcoming: number; completed: number; cancelled: number };
  /** All the user's trips as they are now, independent of the range (like the My Trips tabs). */
  trips: { upcoming: number; completed: number; cancelled: number; pending: number };
  /** The money of the bookings created in the range. */
  spending: MoneySplit & { currency: string; refundsInProgress: number; hotel: MoneySplit; flight: MoneySplit };
  monthlyActivity: MonthlyActivity[];
  nextTrip: NextTrip | null;
  generatedAt: string;
}

/** Query parameters as the endpoint wants them (no `from`/`to` for presets). */
export function summaryQuery(params: SummaryParams): Record<string, string> {
  return params.range === 'CUSTOM' && params.from && params.to
    ? { range: 'CUSTOM', from: params.from, to: params.to }
    : { range: params.range };
}

export const summaryApi = {
  async summary(params: SummaryParams): Promise<CustomerSummary> {
    const { data } = await apiClient.get<CustomerSummary>('/bookings/summary', { params: summaryQuery(params) });
    return data;
  },
};
