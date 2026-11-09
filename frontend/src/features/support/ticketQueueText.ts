import { TICKET_CATEGORIES, TICKET_STATUSES } from '@/features/tickets/ticketText';
import type { TicketAuthorRole, TicketCategory, TicketStatus } from '@/features/tickets/types';
import type { AgentTicket, AssignedFilter, TicketPriority, TicketQueueFilters } from './types';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Ticket statuses in the agents' words (the customer sees "Waiting for your reply" where agents see "Waiting for customer"). */
export const agentStatusInfo: Record<TicketStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  WAITING_CUSTOMER: { label: 'Waiting for customer', tone: 'neutral' },
  ESCALATED: { label: 'Escalated', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const agentStatusLabel = (status: TicketStatus): string => agentStatusInfo[status]?.label ?? status;

export const agentCategoryLabels: Record<TicketCategory, string> = {
  BOOKING: 'Booking',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CANCELLATION: 'Cancellation',
  ACCOUNT: 'Account',
  OTHER: 'Other',
};

export const agentCategoryLabel = (category: TicketCategory): string => agentCategoryLabels[category] ?? category;

export const TICKET_PRIORITIES: readonly TicketPriority[] = ['NORMAL', 'HIGH'];

export const priorityLabels: Record<TicketPriority, string> = { NORMAL: 'Normal', HIGH: 'High' };

export const assignedLabels: Record<AssignedFilter, string> = {
  ANY: 'Everyone',
  ME: 'Assigned to me',
  UNASSIGNED: 'Unassigned',
};

/** Who wrote a message, from an agent's point of view. */
export const agentAuthorLabels: Record<TicketAuthorRole, string> = {
  CUSTOMER: 'Customer',
  SUPPORT_AGENT: 'Support agent',
  ADMIN: 'Admin',
  SYSTEM: 'Automatic message',
};

/** Support's own messages sit on the right of the agent's conversation view. */
export const isSupportMessage = (role: TicketAuthorRole): boolean => role === 'SUPPORT_AGENT' || role === 'ADMIN';

/** A queue: the ticket waiting longest comes first (the API's default too). */
export const DEFAULT_QUEUE_SORT = 'lastMessageAt,asc';

export const QUEUE_SORTS: readonly { value: string; label: string }[] = [
  { value: DEFAULT_QUEUE_SORT, label: 'Waiting longest first' },
  { value: 'lastMessageAt,desc', label: 'Latest activity first' },
  { value: 'createdAt,desc', label: 'Newest tickets first' },
  { value: 'createdAt,asc', label: 'Oldest tickets first' },
];

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | '' =>
  allowed.includes(value as T) ? (value as T) : '';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const pickPattern = (value: string | null, pattern: RegExp): string => (value && pattern.test(value) ? value : '');

/** The admin queue's extra filters from the URL: one agent (user id) and the days tickets were opened in. */
export function readQueueExtras(params: URLSearchParams): { agent: string; from: string; to: string } {
  return {
    agent: pickPattern(params.get('agent'), UUID_PATTERN),
    from: pickPattern(params.get('from'), DAY_PATTERN),
    to: pickPattern(params.get('to'), DAY_PATTERN),
  };
}

/** The queue's filters from the URL; unknown values fall back to "all". */
export function readQueueFilters(params: URLSearchParams): TicketQueueFilters {
  const assigned = params.get('assigned');
  const sort = params.get('sort');
  return {
    q: params.get('q')?.trim() ?? '',
    status: pick(params.get('status'), TICKET_STATUSES),
    category: pick(params.get('category'), TICKET_CATEGORIES),
    priority: pick(params.get('priority'), TICKET_PRIORITIES),
    assigned: assigned === 'ME' || assigned === 'UNASSIGNED' ? assigned : 'ANY',
    sort: QUEUE_SORTS.some((option) => option.value === sort) ? (sort as string) : DEFAULT_QUEUE_SORT,
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}

/**
 * Whether the ticket is assigned to the current agent: the server's `assignedToMe` when it sent one, otherwise the
 * assigned agent's id compared with mine. Undefined when the answer has no assignment at all.
 */
export function isAssignedToMe(ticket: Pick<AgentTicket, 'assignedToMe' | 'assignedAgentId'>, myUserId: string | undefined): boolean | undefined {
  if (typeof ticket.assignedToMe === 'boolean') return ticket.assignedToMe;
  if (ticket.assignedAgentId === undefined) return undefined;
  return ticket.assignedAgentId !== null && ticket.assignedAgentId === myUserId;
}

/**
 * The cached conversation after an assign or status change: the answer's fields win, the messages stay when the answer
 * has none.
 */
export function mergeTicket(old: AgentTicket, next: Partial<AgentTicket>): AgentTicket {
  return { ...old, ...next, messages: next.messages ?? old.messages };
}

/** "You", "Unassigned" or "Another agent". */
export function assigneeLabel(ticket: Pick<AgentTicket, 'assignedToMe' | 'assignedAgentId'>, myUserId?: string): string {
  if (isAssignedToMe(ticket, myUserId)) return 'You';
  return ticket.assignedAgentId ? 'Another agent' : 'Unassigned';
}
