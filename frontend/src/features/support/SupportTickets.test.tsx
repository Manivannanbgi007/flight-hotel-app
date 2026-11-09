import { screen, waitFor, within } from '@testing-library/react';
import { format, parseISO } from 'date-fns';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { formatDateTime } from '@/lib/format';
import { applyInvalidation } from '@/lib/realtime/invalidationRules';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { AgentTicketPage } from './AgentTicketPage';
import { agentTicketApi } from './agentTicketApi';
import { TicketQueuePage } from './TicketQueuePage';
import type { AgentTicket, AgentTicketSummary } from './types';

vi.mock('./agentTicketApi', () => ({
  agentTicketApi: { queue: vi.fn(), summary: vi.fn(), assign: vi.fn(), changeStatus: vi.fn(), get: vi.fn(), reply: vi.fn() },
}));

const agent: AuthUser = {
  ...customer, id: 'agent-1', email: 'agent@example.com', roles: ['SUPPORT_AGENT'],
  permissions: ['BOOKING_READ_ANY', 'BOOKING_MANAGE_ANY', 'SUPPORT_TICKET_MANAGE'],
};

const row = (overrides: Partial<AgentTicketSummary> = {}): AgentTicketSummary => ({
  id: 't1', ticketNumber: 'TK-7K3M9Q2X', subject: 'Wrong name on my booking', category: 'BOOKING', status: 'OPEN',
  bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', createdAt: '2099-03-01T10:00:00Z', lastMessageAt: '2099-03-01T10:00:00Z',
  lastMessageBy: 'CUSTOMER', customerEmail: 'asha@example.com', priority: 'NORMAL', assignedAgentId: null, assignedToMe: false,
  ...overrides,
});
const ticket = (overrides: Partial<AgentTicket> = {}): AgentTicket => ({
  ...row(),
  messages: [
    { id: 'm1', authorRole: 'CUSTOMER', message: 'My last name is spelt wrong.', createdAt: '2099-03-01T10:00:00Z' },
    { id: 'm2', authorRole: 'SYSTEM', message: 'We received your message.', createdAt: '2099-03-01T10:00:01Z' },
  ],
  ...overrides,
});
const page = <T,>(content: T[], totalPages = 1) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages });

describe('TicketQueuePage', () => {
  const open = (path = '/support/tickets') => renderRoutes([
    { path: '/support/tickets', element: <TicketQueuePage /> },
    { path: '/support/tickets/:ticketId', element: <p>conversation</p> },
  ], { path, auth: fakeAuth({ user: agent }) });
  const lastFilters = () => vi.mocked(agentTicketApi.queue).mock.lastCall?.[0];

  it('lists tickets with customer, status, priority, assignee and last activity', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([
      row(),
      row({ id: 't2', ticketNumber: 'TK-BBBB2222', subject: 'Refund not received', category: 'REFUND', status: 'WAITING_CUSTOMER',
        priority: 'HIGH', assignedAgentId: 'agent-1', assignedToMe: true, lastMessageBy: 'SUPPORT', customerEmail: 'ravi@example.com' }),
      row({ id: 't3', ticketNumber: 'TK-CCCC3333', subject: 'Invoice name', assignedAgentId: 'agent-9', assignedToMe: false }),
    ]));
    const { user, router } = open();

    const table = await screen.findByRole('table', { name: 'Tickets' });
    const [, first, second, third] = within(table).getAllByRole('row');
    expect(within(first!).getByText('asha@example.com')).toBeInTheDocument();
    expect(within(first!).getByText('TK-7K3M9Q2X · Booking · HT-7K3M9Q2X')).toBeInTheDocument();
    expect(within(first!).getByText('Open')).toBeInTheDocument();
    expect(within(first!).getByText('Unassigned')).toBeInTheDocument();
    expect(within(first!).getByText(formatDateTime('2099-03-01T10:00:00Z'))).toBeInTheDocument();
    expect(within(second!).getByText('Waiting for customer')).toBeInTheDocument();
    expect(within(second!).getByText('High priority')).toBeInTheDocument();
    expect(within(second!).getByText('You')).toBeInTheDocument();
    expect(within(second!).queryByRole('button', { name: /Assign to me/ })).not.toBeInTheDocument();
    expect(within(third!).getByText('Another agent')).toBeInTheDocument();
    expect(within(third!).getByRole('button', { name: 'Assign to me TK-CCCC3333' })).toBeInTheDocument();
    expect(lastFilters()).toEqual({ q: '', status: '', category: '', priority: '', assigned: 'ANY', sort: 'lastMessageAt,asc', page: 0 });
    expect(vi.mocked(agentTicketApi.queue).mock.lastCall?.[1]).toBe(25); // page size

    await user.click(within(first!).getByRole('link', { name: 'Wrong name on my booking' }));
    expect(currentLocation(router)).toBe('/support/tickets/t1');
  });

  it('keeps search, filters and sorting in the URL and sends them to the API', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([]));
    const { user, router } = open();
    expect(await screen.findByText('No tickets yet')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), ' TK-7K3M9Q2X ');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Escalated');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), 'Refund');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'High');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned' }), 'Unassigned');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Oldest tickets first');

    await waitFor(() => expect(lastFilters()).toEqual({
      q: 'TK-7K3M9Q2X', status: 'ESCALATED', category: 'REFUND', priority: 'HIGH', assigned: 'UNASSIGNED', sort: 'createdAt,asc', page: 0,
    }));
    expect(currentLocation(router)).toBe(
      '/support/tickets?q=TK-7K3M9Q2X&status=ESCALATED&category=REFUND&priority=HIGH&assigned=UNASSIGNED&sort=createdAt%2Casc');
    expect(screen.getByText('No tickets match these filters')).toBeInTheDocument();
  });

  it('shows the desk\'s counts in the hero and on the quick filter pills, and a pill filters the queue', async () => {
    vi.mocked(agentTicketApi.summary).mockResolvedValue({ open: 4, inProgress: 2, waitingCustomer: 7, escalated: 1, resolved: 9, highPriority: 2, total: 40, unassigned: 3, assignedToMe: 5 });
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([row()]));
    const { user, router } = open();

    const glance = await screen.findByRole('list', { name: 'At a glance' });
    await waitFor(() => expect(glance).toHaveTextContent('Open4'));
    expect(glance).toHaveTextContent('Escalated1');
    expect(glance).toHaveTextContent('Unassigned3');
    const status = screen.getByRole('group', { name: 'Quick status filter' });
    expect(within(status).getByRole('button', { name: /All tickets/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(status).getByRole('button', { name: /Waiting for customer\s*7/ })).toBeInTheDocument();

    await user.click(within(status).getByRole('button', { name: /^Open\s*4/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'OPEN', page: 0 }));
    expect(currentLocation(router)).toBe('/support/tickets?status=OPEN');
    expect(within(screen.getByRole('group', { name: 'Quick status filter' })).getByRole('button', { name: /^Open\s*4/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(screen.getByRole('group', { name: 'Quick assignment filter' })).getByRole('button', { name: /Assigned to me\s*5/ }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'OPEN', assigned: 'ME' }));
    await user.click(within(screen.getByRole('group', { name: 'Quick assignment filter' })).getByRole('button', { name: 'Anyone' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ assigned: 'ANY' }));
  });

  it('opens a ticket from anywhere on its row, but not from the assign button', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([row({ assignedAgentId: 'agent-9', assignedToMe: false })]));
    vi.mocked(agentTicketApi.assign).mockResolvedValue(ticket({ assignedAgentId: 'agent-1', assignedToMe: true }));
    const { user, router } = open();
    const table = await screen.findByRole('table', { name: 'Tickets' });

    await user.click(within(table).getByRole('button', { name: 'Assign to me TK-7K3M9Q2X' }));
    expect(currentLocation(router)).toBe('/support/tickets');

    await user.click(within(table).getByText('asha@example.com'));
    expect(currentLocation(router)).toBe('/support/tickets/t1');
  });

  it('jumps to a page of a long queue', async () => {
    vi.mocked(agentTicketApi.queue).mockImplementation(async (filters) => ({ ...page([row()], 12), page: filters.page, totalElements: 300 }));
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }));
    const { user, router } = open();

    const jump = await screen.findByRole('spinbutton', { name: 'Go to page' });
    await user.type(jump, '9');
    await user.click(screen.getByRole('button', { name: 'Go' }));

    await waitFor(() => expect(lastFilters()).toMatchObject({ page: 8 }));
    expect(currentLocation(router)).toBe('/support/tickets?page=8');
    expect(await screen.findByText('Page 9 of 12')).toBeInTheDocument();
  });

  it('reads the filters of a dashboard link and pages through the results', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([row()], 3));
    const { user, router } = open('/support/tickets?assigned=ME');

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(lastFilters()).toMatchObject({ assigned: 'ME', page: 0 });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(lastFilters()).toMatchObject({ assigned: 'ME', page: 1 }));
    expect(currentLocation(router)).toBe('/support/tickets?assigned=ME&page=1');
  });

  it('assigns a ticket to me and refreshes the queue', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([row()]));
    vi.mocked(agentTicketApi.assign).mockResolvedValue({ ...ticket(), assignedAgentId: 'agent-1', assignedToMe: true });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Assign to me TK-7K3M9Q2X' }));

    await waitFor(() => expect(agentTicketApi.assign).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText('TK-7K3M9Q2X is assigned to you.')).toBeInTheDocument();
    await waitFor(() => expect(agentTicketApi.queue).toHaveBeenCalledTimes(2));
  });

  it('shows the server\'s message and the support reference when the queue cannot load', async () => {
    vi.mocked(agentTicketApi.queue).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this.', [], 'corr-403'));
    open();

    expect(await screen.findByRole('heading', { name: 'No access to support tickets' })).toBeInTheDocument();
    expect(screen.getByText('You are not allowed to do this.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-403')).toBeInTheDocument();
  });

  it('exports the tickets on screen, and every ticket matching the same search, filters and sort', async () => {
    const files = stubFileSaving();
    const all = [
      row(),
      row({ id: 't2', ticketNumber: 'TK-BBBB2222', subject: 'Refund not received', category: 'REFUND', status: 'WAITING_CUSTOMER',
        priority: 'HIGH', assignedAgentId: 'agent-1', assignedToMe: true, lastMessageBy: 'SUPPORT', customerEmail: 'ravi@example.com' }),
      row({ id: 't3', ticketNumber: 'TK-CCCC3333', subject: 'Invoice name', assignedAgentId: 'agent-9', assignedToMe: false, bookingReference: null }),
    ];
    // The screen asks for 25 a page (2 shown, 3 in all); the export asks for 100 and gets them all.
    vi.mocked(agentTicketApi.queue).mockImplementation(async (filters, size = 25) => (size === 25
      ? { content: all.slice(0, 2), page: filters.page, size, totalElements: 3, totalPages: 2 }
      : { content: all, page: filters.page, size, totalElements: 3, totalPages: 1 }));
    const { user } = open('/support/tickets?q=refund&status=OPEN&priority=HIGH');
    await screen.findByRole('table', { name: 'Tickets' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Export support tickets' })).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    const local = (instant: string) => format(parseISO(instant), 'yyyy-MM-dd HH:mm');
    expect((await files.blobs[0]!.text()).split('\r\n').filter(Boolean)).toEqual([
      '"Ticket","Subject","Topic","Booking reference","Customer e-mail","Status","Priority","Assigned to","Opened","Last activity","Last message by"',
      `"TK-7K3M9Q2X","Wrong name on my booking","Booking","HT-7K3M9Q2X","asha@example.com","Open","Normal","Unassigned",${local('2099-03-01T10:00:00Z')},${local('2099-03-01T10:00:00Z')},"Customer"`,
      // A ticket of the agent who exported carries their name ("You" would mean nothing in a shared file).
      `"TK-BBBB2222","Refund not received","Refund","HT-7K3M9Q2X","ravi@example.com","Waiting for customer","High","Asha Rao",${local('2099-03-01T10:00:00Z')},${local('2099-03-01T10:00:00Z')},"Support"`,
    ]);
    expect(files.saved[0]!.fileName).toMatch(/^support-tickets-\d{4}-\d{2}-\d{2}\.csv$/);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export support tickets' });
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(vi.mocked(agentTicketApi.queue).mock.lastCall).toEqual([
      { q: 'refund', status: 'OPEN', category: '', priority: 'HIGH', assigned: 'ANY', sort: 'lastMessageAt,asc', page: 0 }, 100,
    ]);
    const lines = (await files.blobs[1]!.text()).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('"TK-CCCC3333","Invoice name","Booking",,"asha@example.com","Open","Normal","Another agent"');
  });
});

describe('AgentTicketPage', () => {
  const open = () => renderRoutes([
    { path: '/support/tickets/:ticketId', element: <AgentTicketPage /> },
    { path: '/support/bookings/:bookingId', element: <p>booking assist</p> },
  ], { path: '/support/tickets/t1', auth: fakeAuth({ user: agent }) });

  beforeEach(() => {
    vi.mocked(agentTicketApi.get).mockResolvedValue(ticket());
  });

  it('shows the ticket, the customer, the booking link and who wrote each message', async () => {
    const { user, router } = open();

    expect(await screen.findByRole('heading', { name: 'Wrong name on my booking' })).toBeInTheDocument();
    expect(screen.getByText(`TK-7K3M9Q2X · Booking · opened ${formatDateTime('2099-03-01T10:00:00Z')}`)).toBeInTheDocument();
    expect(screen.getByText('Customer: asha@example.com')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Assignment' })).getByText('Nobody is assigned yet.')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Messages' })).getAllByRole('listitem');
    expect(within(items[0]!).getByText('Customer')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Automatic message')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Open booking HT-7K3M9Q2X' }));
    expect(currentLocation(router)).toBe('/support/bookings/b1');
  });

  it('sends a reply, shows it at once and says the ticket now waits for the customer', async () => {
    vi.mocked(agentTicketApi.reply).mockResolvedValue({ id: 'm3', authorRole: 'SUPPORT_AGENT', message: 'We have fixed it.', createdAt: '2099-03-01T12:00:00Z' });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText('Write your reply first')).toBeInTheDocument();
    expect(agentTicketApi.reply).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Reply to the customer'), 'We have fixed it.');
    expect(screen.getByText(/17 \/ 2000 characters/)).toBeInTheDocument();
    // What the server answers on the refetch after the reply.
    vi.mocked(agentTicketApi.get).mockResolvedValue(ticket({
      status: 'WAITING_CUSTOMER',
      messages: [...ticket().messages, { id: 'm3', authorRole: 'SUPPORT_AGENT', message: 'We have fixed it.', createdAt: '2099-03-01T12:00:00Z' }],
    }));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(agentTicketApi.reply).toHaveBeenCalledWith('t1', 'We have fixed it.'));
    const messages = screen.getByRole('list', { name: 'Messages' });
    expect(await within(messages).findByText('We have fixed it.')).toBeInTheDocument();
    expect(within(messages).getByText('Support agent')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for customer').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Reply to the customer')).toHaveValue('');
  });

  it('keeps a reply refused because the ticket was closed meanwhile (409 TICKET_CLOSED)', async () => {
    vi.mocked(agentTicketApi.reply).mockRejectedValue(new ApiError(409, 'TICKET_CLOSED', 'This ticket is closed.'));
    const { user } = open();

    await user.type(await screen.findByLabelText('Reply to the customer'), 'One more thing.');
    vi.mocked(agentTicketApi.get).mockResolvedValue(ticket({ status: 'CLOSED' }));
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    const alert = await screen.findByText('Your reply was not sent');
    expect(alert.closest('[role="alert"]')).toHaveTextContent('One more thing.');
    expect(screen.queryByLabelText('Reply to the customer')).not.toBeInTheDocument();
    expect(screen.getByText(/This ticket is closed and takes no more replies/)).toBeInTheDocument();
  });

  it('changes status and priority', async () => {
    vi.mocked(agentTicketApi.changeStatus).mockResolvedValue({ ...ticket(), status: 'ESCALATED', priority: 'HIGH', messages: undefined as never });
    const { user } = open();

    const form = await screen.findByRole('form', { name: 'Status and priority' });
    expect(within(form).getByRole('button', { name: 'Save status' })).toBeDisabled();
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Status' }), 'Escalated');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Priority' }), 'High');
    vi.mocked(agentTicketApi.get).mockResolvedValue(ticket({ status: 'ESCALATED', priority: 'HIGH' }));
    await user.click(within(form).getByRole('button', { name: 'Save status' }));

    await waitFor(() => expect(agentTicketApi.changeStatus).toHaveBeenCalledWith('t1', { status: 'ESCALATED', priority: 'HIGH' }));
    expect(await screen.findByText('Ticket TK-7K3M9Q2X updated: Escalated.')).toBeInTheDocument();
    expect(screen.getByText('High priority')).toBeInTheDocument();
    // The messages stay although the answer had none.
    expect(within(screen.getByRole('list', { name: 'Messages' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the server\'s message when a status change is refused', async () => {
    vi.mocked(agentTicketApi.changeStatus).mockRejectedValue(
      new ApiError(422, 'INVALID_STATUS', 'A closed ticket cannot change.', [], 'corr-422'));
    const { user } = open();

    const form = await screen.findByRole('form', { name: 'Status and priority' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Status' }), 'Resolved');
    await user.click(within(form).getByRole('button', { name: 'Save status' }));

    expect(await screen.findByText('A closed ticket cannot change.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-422')).toBeInTheDocument();
  });

  it('assigns the ticket to me from the conversation', async () => {
    vi.mocked(agentTicketApi.assign).mockResolvedValue({ ...ticket(), assignedAgentId: 'agent-1', assignedToMe: true });
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Assign to me' }));

    await waitFor(() => expect(agentTicketApi.assign).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText('Assigned to you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
  });

  it('works out the assignment from the agent id when the answer has no assignedToMe', async () => {
    const withoutFlag = ticket({ assignedAgentId: 'agent-1' });
    delete withoutFlag.assignedToMe;
    vi.mocked(agentTicketApi.get).mockResolvedValue(withoutFlag);
    open();

    expect(await screen.findByText('Assigned to you.')).toBeInTheDocument();
  });

  it('shows a closed ticket without a reply box or status form', async () => {
    vi.mocked(agentTicketApi.get).mockResolvedValue(ticket({ status: 'CLOSED' }));
    open();

    expect(await screen.findByText(/This ticket is closed and takes no more replies/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply to the customer')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Status and priority' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument();
  });

  it('shows a new customer message live (support.ticket-changed)', async () => {
    const { queryClient } = open();
    expect(await screen.findByRole('heading', { name: 'Wrong name on my booking' })).toBeInTheDocument();

    vi.mocked(agentTicketApi.get).mockResolvedValue(ticket({
      messages: [...ticket().messages, { id: 'm4', authorRole: 'CUSTOMER', message: 'Any news?', createdAt: '2099-03-01T13:00:00Z' }],
    }));
    applyInvalidation(queryClient, {
      id: 'e1', type: 'support.ticket-changed', resourceType: 'SUPPORT_TICKET', resourceId: 't1', data: {}, occurredAt: '2099-03-01T13:00:00Z',
    });

    expect(await screen.findByText('Any news?')).toBeInTheDocument();
  });

  it('says when the ticket does not exist', async () => {
    vi.mocked(agentTicketApi.get).mockRejectedValue(new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found.', [], 'corr-404'));
    open();

    expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ticket queue' })).toHaveAttribute('href', '/support/tickets');
  });
});
