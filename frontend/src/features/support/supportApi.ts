import type { Attention, RefundItem } from '@/features/bookings/types';
import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type { SupportBookingFilters, SupportBookingRow } from './types';

const bookingPath = (bookingId: string) => `/support/bookings/${encodeURIComponent(bookingId)}`;

/**
 * `/api/support/bookings` (API_DOCUMENTATION.md §8.5). Reading needs BOOKING_READ_ANY; escalate and resolve need
 * BOOKING_MANAGE_ANY, retry-refund REFUND_MANAGE. The booking itself, its timeline, quote and cancel use bookingApi.
 */
export const supportApi = {
  async searchBookings(filters: SupportBookingFilters, size = 20): Promise<Page<SupportBookingRow>> {
    const { data } = await apiClient.get<Page<SupportBookingRow>>('/support/bookings', {
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
  async escalate(bookingId: string, note: string): Promise<Attention> {
    const { data } = await apiClient.post<Attention>(`${bookingPath(bookingId)}/escalate`, { note });
    return data;
  },

  /** Clears the flag (`409 NOTHING_TO_RESOLVE` when there is none). The note is optional. */
  async resolve(bookingId: string, note?: string): Promise<void> {
    await apiClient.post(`${bookingPath(bookingId)}/resolve`, note ? { note } : {});
  },

  /** The latest refund request failed: asks for the same amount again (`409 NO_FAILED_REFUND` otherwise). */
  async retryRefund(bookingId: string): Promise<RefundItem> {
    const { data } = await apiClient.post<RefundItem>(`${bookingPath(bookingId)}/retry-refund`);
    return data;
  },
};
