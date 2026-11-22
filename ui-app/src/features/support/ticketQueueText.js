import { TICKET_CATEGORIES, TICKET_STATUSES } from '@/features/tickets/ticketText';

/** Ticket statuses in the agents' words (the customer sees "Waiting for your reply" where agents see "Waiting for customer"). */
export const agentStatusInfo = {
  OPEN: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  WAITING_CUSTOMER: { label: 'Waiting for customer', tone: 'neutral' },
  ESCALATED: { label: 'Escalated', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const agentStatusLabel = (status) => agentStatusInfo[status]?.label ?? status;

export const agentCategoryLabels = {
  BOOKING: 'Booking',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CANCELLATION: 'Cancellation',
  ACCOUNT: 'Account',
  OTHER: 'Other',
};

export const agentCategoryLabel = (category) => agentCategoryLabels[category] ?? category;

export const TICKET_PRIORITIES = ['NORMAL', 'HIGH'];

export const priorityLabels = { NORMAL: 'Normal', HIGH: 'High' };

export const assignedLabels = {
  ANY: 'Everyone',
  ME: 'Assigned to me',
  UNASSIGNED: 'Unassigned',
};

/** Who wrote a message, from an agent's point of view. */
export const agentAuthorLabels = {
  CUSTOMER: 'Customer',
  SUPPORT_AGENT: 'Support agent',
  ADMIN: 'Admin',
  SYSTEM: 'Automatic message',
};

/** Support's own messages sit on the right of the agent's conversation view. */
export const isSupportMessage = (role) => role === 'SUPPORT_AGENT' || role === 'ADMIN';

/** A queue: the ticket waiting longest comes first (the API's default too). */
export const DEFAULT_QUEUE_SORT = 'lastMessageAt,asc';

export const QUEUE_SORTS = [
  { value: DEFAULT_QUEUE_SORT, label: 'Waiting longest first' },
  { value: 'lastMessageAt,desc', label: 'Latest activity first' },
  { value: 'createdAt,desc', label: 'Newest tickets first' },
  { value: 'createdAt,asc', label: 'Oldest tickets first' },
];

const pick = (value, allowed) => (allowed.includes(value) ? value : '');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const pickPattern = (value, pattern) => (value && pattern.test(value) ? value : '');

/** The admin queue's extra filters from the URL: one agent (user id) and the days tickets were opened in. */
export function readQueueExtras(params) {
  return {
    agent: pickPattern(params.get('agent'), UUID_PATTERN),
    from: pickPattern(params.get('from'), DAY_PATTERN),
    to: pickPattern(params.get('to'), DAY_PATTERN),
  };
}

/** The queue's filters from the URL; unknown values fall back to "all". */
export function readQueueFilters(params) {
  const assigned = params.get('assigned');
  const sort = params.get('sort');
  return {
    q: params.get('q')?.trim() ?? '',
    status: pick(params.get('status'), TICKET_STATUSES),
    category: pick(params.get('category'), TICKET_CATEGORIES),
    priority: pick(params.get('priority'), TICKET_PRIORITIES),
    assigned: assigned === 'ME' || assigned === 'UNASSIGNED' ? assigned : 'ANY',
    sort: QUEUE_SORTS.some((option) => option.value === sort) ? sort : DEFAULT_QUEUE_SORT,
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}

/**
 * Whether the ticket is assigned to the current agent: the server's `assignedToMe` when it sent one, otherwise the
 * assigned agent's id compared with mine. Undefined when the answer has no assignment at all.
 */
export function isAssignedToMe(ticket, myUserId) {
  if (typeof ticket.assignedToMe === 'boolean') return ticket.assignedToMe;
  if (ticket.assignedAgentId === undefined) return undefined;
  return ticket.assignedAgentId !== null && ticket.assignedAgentId === myUserId;
}

/**
 * The cached conversation after an assign or status change: the answer's fields win, the messages stay when the answer
 * has none.
 */
export function mergeTicket(old, next) {
  return { ...old, ...next, messages: next.messages ?? old.messages };
}

/** "You", "Unassigned" or "Another agent". */
export function assigneeLabel(ticket, myUserId) {
  if (isAssignedToMe(ticket, myUserId)) return 'You';
  return ticket.assignedAgentId ? 'Another agent' : 'Unassigned';
}
