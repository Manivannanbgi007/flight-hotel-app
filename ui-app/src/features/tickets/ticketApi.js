import { apiClient } from '@/lib/api/client';

const ticketPath = (ticketId) => `/support/tickets/${encodeURIComponent(ticketId)}`;

/** `/api/support/tickets` (API_DOCUMENTATION.md §10c): the logged-in customer's own tickets. */
export const ticketApi = {
  /** My tickets, latest activity first. */
  async list(filters, size = 10) {
    const { data } = await apiClient.get('/support/tickets', {
      params: {
        status: filters.status || undefined,
        q: filters.q || undefined,
        category: filters.category || undefined,
        page: filters.page,
        size,
      },
    });
    return data;
  },

  /** The counts above the list. */
  async summary() {
    const { data } = await apiClient.get('/support/tickets/summary');
    return data;
  },

  /** `404 TICKET_NOT_FOUND` for someone else's ticket. */
  async get(ticketId) {
    const { data } = await apiClient.get(ticketPath(ticketId));
    return data;
  },

  /** `201`; `bookingId` must be one of the customer's bookings (`422 INVALID_BOOKING`). */
  async create(body) {
    const { data } = await apiClient.post('/support/tickets', body);
    return data;
  },

  /** A reply to a ticket waiting for the customer or resolved reopens it; `409 TICKET_CLOSED` once closed. */
  async reply(ticketId, message) {
    const { data } = await apiClient.post(`${ticketPath(ticketId)}/messages`, { message });
    return data;
  },

  /** Final: a closed ticket takes no more replies. */
  async close(ticketId) {
    const { data } = await apiClient.post(`${ticketPath(ticketId)}/close`);
    return data;
  },
};
