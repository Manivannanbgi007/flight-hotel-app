import type { AttentionReason, BookingPaymentStatus, BookingStatus } from '@/features/bookings/types';
import type { Ticket, TicketCategory, TicketStatus, TicketSummary } from '@/features/tickets/types';

/** One row of the support booking lookup (`GET /api/support/bookings`, API_DOCUMENTATION.md §8.5). */
export interface SupportBookingRow {
  id: string;
  reference: string;
  type: 'HOTEL' | 'FLIGHT';
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  title: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  totalAmount: number;
  currency: string;
  createdAt: string;
  contactEmail: string;
  leadName: string | null;
  /** Set while the booking is in the "Needs attention" queue. */
  attentionReason: AttentionReason | null;
  attentionSince: string | null;
  demo: boolean;
}

/** The lookup's filters, as kept in the URL. Empty strings mean "all". */
export type SupportBookingFilters = {
  /** Booking reference, contact e-mail, PNR or hotel confirmation number (exact, case-insensitive). */
  q: string;
  status: BookingStatus | '';
  type: 'HOTEL' | 'FLIGHT' | '';
  /** Only flagged bookings, oldest flag first. */
  attention: boolean;
  page: number;
};

/* ---- Support agents: tickets (API_DOCUMENTATION.md §14.6) ---- */

export type TicketPriority = 'NORMAL' | 'HIGH';

/** Who a queue page shows: tickets assigned to me, nobody's tickets, or all of them. */
export type AssignedFilter = 'ANY' | 'ME' | 'UNASSIGNED';

/** One row of the agents' ticket queue: the customer's ticket summary (§10c) plus the agent-side fields. */
export interface AgentTicketSummary extends TicketSummary {
  customerEmail: string | null;
  priority: TicketPriority;
  assignedAgentId: string | null;
  assignedToMe: boolean;
}

/**
 * A ticket with its conversation, as an agent sees it. `GET /api/support/tickets/{id}` is the customer's endpoint
 * (§10c): the agent-side fields may be missing there, so they are optional. Assign and status changes return them.
 */
export interface AgentTicket extends Ticket {
  customerEmail?: string | null;
  priority?: TicketPriority;
  assignedAgentId?: string | null;
  assignedToMe?: boolean;
}

/** `GET /api/admin/support/summary`: open tickets per status and assignment. */
export interface SupportSummary {
  open: number;
  inProgress: number;
  waitingCustomer: number;
  escalated: number;
  unassigned: number;
  assignedToMe: number;
  /** Resolved, waiting to be closed. */
  resolved: number;
  /** HIGH priority and not resolved or closed. */
  highPriority: number;
  /** Every ticket ever opened. */
  total: number;
}

/** The queue's filters, as kept in the URL. Empty strings mean "all". */
export interface TicketQueueFilters {
  /** Ticket number, customer e-mail or subject. */
  q: string;
  status: TicketStatus | '';
  category: TicketCategory | '';
  priority: TicketPriority | '';
  assigned: AssignedFilter;
  /** The admin queue only: tickets of one agent (user id), and the day range they were opened in (YYYY-MM-DD). */
  agent?: string;
  from?: string;
  to?: string;
  /** `field,asc|desc` (§14). */
  sort: string;
  page: number;
}

export interface TicketStatusChange {
  status: TicketStatus;
  priority?: TicketPriority;
}
