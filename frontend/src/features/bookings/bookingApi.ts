import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type {
  BookingDetails,
  CancelBookingBody,
  Cancellation,
  CancellationQuote,
  BookingSummary,
  BookingTab,
  CouponCheckBody,
  CouponCheckResult,
  CreateFlightBookingBody,
  CreateHotelBookingBody,
  TimelineEntry,
  TripFilters,
} from './types';

/** `/api/bookings` and `/api/coupons` (API_DOCUMENTATION.md, Bookings). */
export const bookingApi = {
  /**
   * Book the stay of a quote. The answer is `202`: the rooms are held in the background, so the caller shows the
   * booking and follows its status. The same Idempotency-Key returns the same booking (double click, retry).
   */
  async createHotelBooking(body: CreateHotelBookingBody, idempotencyKey: string): Promise<BookingDetails> {
    const { data } = await apiClient.post<BookingDetails>('/bookings/hotel', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  /** Same rules as the hotel booking: `202`, the seats are held in the background, the same key returns the same booking. */
  async createFlightBooking(body: CreateFlightBookingBody, idempotencyKey: string): Promise<BookingDetails> {
    const { data } = await apiClient.post<BookingDetails>('/bookings/flight', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  /** `filters` (search words, trip type) are optional; without them the request is the plain tab list. */
  async list(tab: BookingTab, page: number, size = 10, filters?: TripFilters): Promise<Page<BookingSummary>> {
    const { data } = await apiClient.get<Page<BookingSummary>>('/bookings', {
      params: { tab, page, size, q: filters?.q || undefined, type: filters?.type || undefined },
    });
    return data;
  },

  async details(bookingId: string): Promise<BookingDetails> {
    const { data } = await apiClient.get<BookingDetails>(`/bookings/${encodeURIComponent(bookingId)}`);
    return data;
  },

  async timeline(bookingId: string): Promise<TimelineEntry[]> {
    const { data } = await apiClient.get<TimelineEntry[]>(`/bookings/${encodeURIComponent(bookingId)}/timeline`);
    return data;
  },

  /**
   * What cancelling now costs and returns. `waiveFee` (staff with REFUND_MANAGE) quotes the full refund.
   * `cancellable: false` comes with a `reasonCode` and a `message` in words.
   */
  async cancellationQuote(bookingId: string, waiveFee = false): Promise<CancellationQuote> {
    const { data } = await apiClient.get<CancellationQuote>(`/bookings/${encodeURIComponent(bookingId)}/cancellation-quote`, {
      params: waiveFee ? { waiveFee: true } : undefined,
    });
    return data;
  },

  /**
   * Asks the hotel or airline to cancel (`202`): the booking moves to CANCELLATION_PENDING and the outcome arrives
   * later. The same key with the same body returns the same cancellation; a new body needs a new key.
   */
  async cancel(bookingId: string, body: CancelBookingBody, idempotencyKey: string): Promise<Cancellation> {
    const { data } = await apiClient.post<Cancellation>(`/bookings/${encodeURIComponent(bookingId)}/cancel`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  /** Preview only: the booking recalculates the real discount from the price the hotel holds. */
  async checkCoupon(body: CouponCheckBody): Promise<CouponCheckResult> {
    const { data } = await apiClient.post<CouponCheckResult>('/coupons/check', body);
    return data;
  },
};
