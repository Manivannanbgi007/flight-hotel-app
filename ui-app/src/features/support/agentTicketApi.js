import { ticketApi } from '@/features/tickets/ticketApi';

import { apiClient } from '@/lib/api/client';

const adminTicketPath = (ticketId) => `/admin/support/tickets/${encodeURIComponent(ticketId)}`;

/**
 * Support agents' side of the tickets (API_DOCUMENTATION.md §14.6, permission SUPPORT_TICKET_MANAGE): the queue, its
 * counts, assignment and status. Reading a conversation and replying use the same endpoints as the customer (§10c).
 */
export const agentTicketApi = {
  async queue(filters, size = 20) {
    const { data } = await apiClient.get('/admin/support/tickets', {
      params: {
        q: filters.q || undefined,
        status: filters.status || undefined,
        category: filters.category || undefined,
        priority: filters.priority || undefined,
        assigned: filters.assigned,
        agent: filters.agent || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        sort: filters.sort,
        page: filters.page,
        size,
      },
    });
    return data;
  },

  async summary() {
    const { data } = await apiClient.get('/admin/support/summary');
    return data;
  },

  /** No `agentId` = assign to me. */
  async assign(ticketId, agentId) {
    const { data } = await apiClient.post(`${adminTicketPath(ticketId)}/assign`, agentId ? { agentId } : {});
    return data;
  },

  async changeStatus(ticketId, change) {
    const { data } = await apiClient.patch(`${adminTicketPath(ticketId)}/status`, change);
    return data;
  },

  /** The conversation (§10c); the agent-side fields may be missing, see `AgentTicket`. */
  get(ticketId) {
    return ticketApi.get(ticketId);
  },

  /** An agent's reply notifies the customer and sets the ticket to WAITING_CUSTOMER; `409 TICKET_CLOSED` once closed. */
  reply(ticketId, message) {
    return ticketApi.reply(ticketId, message);
  },
};
