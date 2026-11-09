/** Support tickets, customer side (API_DOCUMENTATION.md §10c). */
export type TicketCategory = 'BOOKING' | 'PAYMENT' | 'REFUND' | 'CANCELLATION' | 'ACCOUNT' | 'OTHER';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

export type TicketAuthorRole = 'CUSTOMER' | 'SUPPORT_AGENT' | 'ADMIN' | 'SYSTEM';

export interface TicketSummary {
  id: string;
  /** e.g. TK-7K3M9Q2X */
  ticketNumber: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  bookingId: string | null;
  bookingReference: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastMessageBy: 'CUSTOMER' | 'SUPPORT' | 'SYSTEM';
}

export interface TicketMessage {
  id: string;
  authorRole: TicketAuthorRole;
  message: string;
  createdAt: string;
}

/** A ticket with its conversation, oldest message first. */
export interface Ticket extends TicketSummary {
  messages: TicketMessage[];
}

export interface CreateTicketBody {
  subject: string;
  category: TicketCategory;
  bookingId?: string;
  message: string;
}

/** My tickets' filters, as kept in the URL. `status: ''` = every status. */
export interface TicketFilters {
  status: TicketStatus | '';
  page: number;
  /** Ticket number (exact) or words of the subject. */
  q?: string;
  category?: TicketCategory | '';
}

/** `GET /api/support/tickets/summary`: my tickets per status. */
export interface MyTicketSummary {
  total: number;
  open: number;
  /** Being worked on, or with a specialist. */
  inProgress: number;
  /** Support asked something and waits for my reply. */
  waitingForYou: number;
  resolved: number;
  closed: number;
}
