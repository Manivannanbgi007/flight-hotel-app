import { apiClient } from '@/lib/api/client';

/** `/api/bookings` and `/api/coupons` (API_DOCUMENTATION.md, Bookings). */
export const bookingApi = {
  /**
   * Book the stay of a quote. The answer is `202`: the rooms are held in the background, so the caller shows the
   * booking and follows its status. The same Idempotency-Key returns the same booking (double click, retry).
   */
  async createHotelBooking(body, idempotencyKey) {
    const { data } = await apiClient.post('/bookings/hotel', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  /** Same rules as the hotel booking: `202`, the seats are held in the background, the same key returns the same booking. */
  async createFlightBooking(body, idempotencyKey) {
    const { data } = await apiClient.post('/bookings/flight', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  /** `filters` (search words, trip type) are optional; without them the request is the plain tab list. */
  async list(tab, page, size = 10, filters) {
    const { data } = await apiClient.get('/bookings', {
      params: { tab, page, size, q: filters?.q || undefined, type: filters?.type || undefined },
    });
    return data;
  },

  async details(bookingId) {
    const { data } = await apiClient.get(`/bookings/${encodeURIComponent(bookingId)}`);
    return data;
  },

  async timeline(bookingId) {
    const { data } = await apiClient.get(`/bookings/${encodeURIComponent(bookingId)}/timeline`);
    return data;
  },

  /**
   * What cancelling now costs and returns. `waiveFee` (staff with REFUND_MANAGE) quotes the full refund.
   * `cancellable: false` comes with a `reasonCode` and a `message` in words.
   */
  async cancellationQuote(bookingId, waiveFee = false) {
    const { data } = await apiClient.get(`/bookings/${encodeURIComponent(bookingId)}/cancellation-quote`, {
      params: waiveFee ? { waiveFee: true } : undefined,
    });
    return data;
  },

  /**
   * Asks the hotel or airline to cancel (`202`): the booking moves to CANCELLATION_PENDING and the outcome arrives
   * later. The same key with the same body returns the same cancellation; a new body needs a new key.
   */
  async cancel(bookingId, body, idempotencyKey) {
    const { data } = await apiClient.post(`/bookings/${encodeURIComponent(bookingId)}/cancel`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  /** Preview only: the booking recalculates the real discount from the price the hotel holds. */
  async checkCoupon(body) {
    const { data } = await apiClient.post('/coupons/check', body);
    return data;
  },
};
