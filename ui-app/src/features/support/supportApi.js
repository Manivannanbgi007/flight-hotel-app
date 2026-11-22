import { apiClient } from '@/lib/api/client';

const bookingPath = (bookingId) => `/support/bookings/${encodeURIComponent(bookingId)}`;

/**
 * `/api/support/bookings` (API_DOCUMENTATION.md §8.5). Reading needs BOOKING_READ_ANY; escalate and resolve need
 * BOOKING_MANAGE_ANY, retry-refund REFUND_MANAGE. The booking itself, its timeline, quote and cancel use bookingApi.
 */
export const supportApi = {
  async searchBookings(filters, size = 20) {
    const { data } = await apiClient.get('/support/bookings', {
      params: {
        q: filters.q || undefined,
        status: filters.status || undefined,
        type: filters.type || undefined,
        attention: filters.attention || undefined,
        page: filters.page,
        size,
      },
    });
    return data;
  },

  /** Puts the booking in the "Needs attention" queue. The note (required) is internal: it goes to `supportNotes` only. */
  async escalate(bookingId, note) {
    const { data } = await apiClient.post(`${bookingPath(bookingId)}/escalate`, { note });
    return data;
  },

  /** Clears the flag (`409 NOTHING_TO_RESOLVE` when there is none). The note is optional. */
  async resolve(bookingId, note) {
    await apiClient.post(`${bookingPath(bookingId)}/resolve`, note ? { note } : {});
  },

  /** The latest refund request failed: asks for the same amount again (`409 NO_FAILED_REFUND` otherwise). */
  async retryRefund(bookingId) {
    const { data } = await apiClient.post(`${bookingPath(bookingId)}/retry-refund`);
    return data;
  },
};
