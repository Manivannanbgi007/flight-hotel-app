import { z } from 'zod';

/** How each ticket status is shown to the customer, in plain words. */
export const ticketStatusInfo = {
  OPEN: { label: 'Open', tone: 'info', description: 'We have your message. A support agent will answer here soon.' },
  IN_PROGRESS: { label: 'In progress', tone: 'info', description: 'A support agent is working on it.' },
  WAITING_CUSTOMER: {
    label: 'Waiting for your reply',
    tone: 'warning',
    description: 'Support needs something from you. Please reply below.',
  },
  ESCALATED: { label: 'With a specialist', tone: 'info', description: 'A senior team member is looking into it.' },
  RESOLVED: {
    label: 'Resolved',
    tone: 'success',
    description: 'Support marked this as solved. If you still need help, reply below: that reopens the ticket.',
  },
  CLOSED: {
    label: 'Closed',
    tone: 'neutral',
    description: 'This ticket is closed and takes no more replies. Create a new ticket if you need more help.',
  },
};

export const TICKET_STATUSES = Object.keys(ticketStatusInfo);

export const ticketCategoryLabels = {
  BOOKING: 'A booking',
  PAYMENT: 'A payment',
  REFUND: 'A refund',
  CANCELLATION: 'A cancellation',
  ACCOUNT: 'My account',
  OTHER: 'Something else',
};

export const TICKET_CATEGORIES = Object.keys(ticketCategoryLabels);

/** Who wrote a message, from the customer's point of view. */
export const authorLabels = {
  CUSTOMER: 'You',
  SUPPORT_AGENT: 'Support agent',
  ADMIN: 'Support team',
  SYSTEM: 'Automatic message',
};

export const lastMessageByLabels = {
  CUSTOMER: 'you',
  SUPPORT: 'support',
  SYSTEM: 'an automatic message',
};

export function readTicketFilters(params) {
  const status = params.get('status');
  return {
    status: TICKET_STATUSES.includes(status) ? status : '',
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  };
}

/** The list's extra filters from the URL: search words and a topic. */
export function readTicketExtras(params) {
  const category = params.get('category');
  return {
    q: params.get('q')?.trim() ?? '',
    category: TICKET_CATEGORIES.includes(category) ? category : '',
  };
}

export const MESSAGE_MAX_LENGTH = 2000;

const messageField = (empty) =>
  z.string().trim().min(1, empty).max(MESSAGE_MAX_LENGTH, 'Please keep it under 2,000 characters');

/** Same limits as the API: subject 5–120, message 1–2000, a topic from the list, an optional booking of mine. */
export const newTicketSchema = z.object({
  subject: z.string().trim().min(5, 'Use at least 5 characters').max(120, 'Use at most 120 characters'),
  category: z.string().refine((value) => TICKET_CATEGORIES.includes(value), { message: 'Choose what it is about' }),
  bookingId: z.string(),
  message: messageField('Tell us how we can help'),
});

export const replySchema = z.object({ message: messageField('Write your reply first') });
