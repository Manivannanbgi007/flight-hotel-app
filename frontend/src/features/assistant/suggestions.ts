import type { AuthUser } from '@/lib/auth/types';

/** Whose tools the assistant uses: the same order as the server (SystemPrompts.PRECEDENCE). */
export type AssistantRole = 'admin' | 'support' | 'manager' | 'customer';

export function assistantRoleOf(user: Pick<AuthUser, 'roles'>): AssistantRole {
  if (user.roles.includes('ADMIN')) return 'admin';
  if (user.roles.includes('SUPPORT_AGENT')) return 'support';
  if (user.roles.includes('HOTEL_MANAGER')) return 'manager';
  return 'customer';
}

/**
 * A starter question. `send`: asked at once. Otherwise the chip puts `prompt` into the input for the user to finish
 * (a booking reference, dates).
 */
export interface Suggestion {
  label: string;
  prompt: string;
  send: boolean;
}

const ask = (label: string, prompt = label): Suggestion => ({ label, prompt, send: true });
const fill = (label: string, prompt: string): Suggestion => ({ label, prompt, send: false });

/** What the assistant can do per role (api-assistant §7): every suggestion maps to one of the role's read-only tools. */
export const SUGGESTIONS: Record<AssistantRole, Suggestion[]> = {
  customer: [
    ask('What are my upcoming trips?'),
    fill('Show booking HT-…', 'Show me the details of booking HT-'),
    fill('Refund if I cancel HT-…?', 'How much refund would I get if I cancel HT-'),
    ask('My recent payments', 'Show my recent payments'),
    ask('My open support tickets', 'Do I have open support tickets?'),
    fill('Hotels in Goa from … to …', 'Find hotels in Goa from '),
    fill('Flights Delhi to Mumbai on …', 'Find flights from Delhi to Mumbai on '),
    ask('Current offers', 'What offers are available right now?'),
  ],
  admin: [
    ask('How many bookings this month?', 'How many bookings did we get this month?'),
    ask('Failed payments last week', 'Show me the failed payments from last week'),
    ask('Net revenue last month', 'What was the net revenue last month?'),
    ask('Pending refunds', 'Which refunds are pending?'),
  ],
  manager: [
    ask('Who is arriving today?'),
    ask('Departures today', 'Who is departing today?'),
    ask('Occupancy last 7 days', 'What was the occupancy over the last 7 days?'),
  ],
  support: [
    ask('How many open tickets?', 'How many open tickets are there?'),
    ask('Show open tickets', 'Show me the open tickets'),
    ask('Bookings that need attention', 'Which bookings need attention?'),
  ],
};

/** The input's placeholder per role. */
export const PLACEHOLDERS: Record<AssistantRole, string> = {
  customer: 'Ask about your trips…',
  admin: 'Ask about bookings or revenue…',
  manager: 'Ask about arrivals or occupancy…',
  support: 'Ask about tickets or bookings…',
};
