import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type { CreateTicketBody, MyTicketSummary, Ticket, TicketFilters, TicketMessage, TicketSummary } from './types';

const ticketPath = (ticketId: string) => `/support/tickets/${encodeURIComponent(ticketId)}`;

/** `/api/support/tickets` (API_DOCUMENTATION.md §10c): the logged-in customer's own tickets. */
export const ticketApi = {
  /** My tickets, latest activity first. */
  async list(filters: TicketFilters, size = 10): Promise<Page<TicketSummary>> {
    const { data } = await apiClient.get<Page<TicketSummary>>('/support/tickets', {
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
  async summary(): Promise<MyTicketSummary> {
    const { data } = await apiClient.get<MyTicketSummary>('/support/tickets/summary');
    return data;
  },

  /** `404 TICKET_NOT_FOUND` for someone else's ticket. */
  async get(ticketId: string): Promise<Ticket> {
    const { data } = await apiClient.get<Ticket>(ticketPath(ticketId));
    return data;
  },

  /** `201`; `bookingId` must be one of the customer's bookings (`422 INVALID_BOOKING`). */
  async create(body: CreateTicketBody): Promise<Ticket> {
    const { data } = await apiClient.post<Ticket>('/support/tickets', body);
    return data;
  },

  /** A reply to a ticket waiting for the customer or resolved reopens it; `409 TICKET_CLOSED` once closed. */
  async reply(ticketId: string, message: string): Promise<TicketMessage> {
    const { data } = await apiClient.post<TicketMessage>(`${ticketPath(ticketId)}/messages`, { message });
    return data;
  },

  /** Final: a closed ticket takes no more replies. */
  async close(ticketId: string): Promise<Ticket> {
    const { data } = await apiClient.post<Ticket>(`${ticketPath(ticketId)}/close`);
    return data;
  },
};
