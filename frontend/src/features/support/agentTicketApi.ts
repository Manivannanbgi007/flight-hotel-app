import { ticketApi } from '@/features/tickets/ticketApi';
import type { TicketMessage } from '@/features/tickets/types';
import { apiClient } from '@/lib/api/client';
import type { Page } from '@/lib/api/types';
import type { AgentTicket, AgentTicketSummary, SupportSummary, TicketQueueFilters, TicketStatusChange } from './types';

const adminTicketPath = (ticketId: string) => `/admin/support/tickets/${encodeURIComponent(ticketId)}`;

/**
 * Support agents' side of the tickets (API_DOCUMENTATION.md §14.6, permission SUPPORT_TICKET_MANAGE): the queue, its
 * counts, assignment and status. Reading a conversation and replying use the same endpoints as the customer (§10c).
 */
export const agentTicketApi = {
  async queue(filters: TicketQueueFilters, size = 20): Promise<Page<AgentTicketSummary>> {
    const { data } = await apiClient.get<Page<AgentTicketSummary>>('/admin/support/tickets', {
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

  async summary(): Promise<SupportSummary> {
    const { data } = await apiClient.get<SupportSummary>('/admin/support/summary');
    return data;
  },

  /** No `agentId` = assign to me. */
  async assign(ticketId: string, agentId?: string): Promise<AgentTicket> {
    const { data } = await apiClient.post<AgentTicket>(`${adminTicketPath(ticketId)}/assign`, agentId ? { agentId } : {});
    return data;
  },

  async changeStatus(ticketId: string, change: TicketStatusChange): Promise<AgentTicket> {
    const { data } = await apiClient.patch<AgentTicket>(`${adminTicketPath(ticketId)}/status`, change);
    return data;
  },

  /** The conversation (§10c); the agent-side fields may be missing, see `AgentTicket`. */
  get(ticketId: string): Promise<AgentTicket> {
    return ticketApi.get(ticketId);
  },

  /** An agent's reply notifies the customer and sets the ticket to WAITING_CUSTOMER; `409 TICKET_CLOSED` once closed. */
  reply(ticketId: string, message: string): Promise<TicketMessage> {
    return ticketApi.reply(ticketId, message);
  },
};
