import { screen, waitFor, within } from '@testing-library/react';

import { bookingApi } from '@/features/bookings/bookingApi';
import { bookingFixture, summaryFixture } from '@/features/bookings/testData';
import { ApiError } from '@/lib/api/apiError';
import { applyInvalidation } from '@/lib/realtime/invalidationRules';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { NewTicketPage } from './NewTicketPage';
import { ticketApi } from './ticketApi';
import { TicketPage } from './TicketPage';
import { TicketsPage } from './TicketsPage';
import type { Ticket, TicketSummary } from './types';

vi.mock('./ticketApi', () => ({
  ticketApi: { list: vi.fn(), summary: vi.fn(), get: vi.fn(), create: vi.fn(), reply: vi.fn(), close: vi.fn() },
}));
vi.mock('@/features/bookings/bookingApi', () => ({ bookingApi: { list: vi.fn(), details: vi.fn() } }));

const summary = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
  id: 't1', ticketNumber: 'TK-7K3M9Q2X', subject: 'Wrong name on my booking', category: 'BOOKING', status: 'OPEN',
  bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', createdAt: '2099-03-01T10:00:00Z', lastMessageAt: '2099-03-01T10:00:00Z',
  lastMessageBy: 'CUSTOMER', ...overrides,
});
const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  ...summary(),
  messages: [
    { id: 'm1', authorRole: 'CUSTOMER', message: 'My last name is spelt wrong.\nIt should be Rao.', createdAt: '2099-03-01T10:00:00Z' },
    { id: 'm2', authorRole: 'SUPPORT_AGENT', message: 'Thanks, we have asked the hotel to fix it.', createdAt: '2099-03-01T11:00:00Z' },
  ],
  ...overrides,
});
const page = <T,>(content: T[]) => ({ content, page: 0, size: 10, totalElements: content.length, totalPages: 1 });

const routes = [
  { path: '/account/support', element: <TicketsPage /> },
  { path: '/account/support/new', element: <NewTicketPage /> },
  { path: '/account/support/:ticketId', element: <TicketPage /> },
  { path: '/my-trips/:bookingId', element: <p>booking page</p> },
];
const open = (path: string) => renderRoutes(routes, { path, auth: fakeAuth({ user: customer }) });

beforeEach(() => {
  vi.mocked(ticketApi.summary).mockResolvedValue({ total: 7, open: 2, inProgress: 1, waitingForYou: 1, resolved: 2, closed: 1 });
  vi.mocked(bookingApi.list).mockResolvedValue(page([
    summaryFixture({ id: 'b1', reference: 'HT-7K3M9Q2X', title: 'Sea Breeze Resort' }),
    summaryFixture({ id: 'b2', reference: 'FL-AAAA1111', type: 'FLIGHT', title: 'Delhi to Mumbai', startDate: '2099-04-01' }),
  ]));
  vi.mocked(ticketApi.get).mockResolvedValue(ticket());
});

describe('TicketsPage', () => {
  it('lists my tickets with their status, topic, booking and last activity', async () => {
    vi.mocked(ticketApi.list).mockResolvedValue(page([
      summary(),
      summary({ id: 't2', ticketNumber: 'TK-BBBB2222', subject: 'Refund not received', category: 'REFUND', status: 'WAITING_CUSTOMER',
        bookingId: null, bookingReference: null, lastMessageBy: 'SUPPORT' }),
    ]));
    open('/account/support');

    const list = await screen.findByRole('list', { name: 'Support tickets' });
    expect(within(list).getByRole('link', { name: 'Wrong name on my booking' })).toHaveAttribute('href', '/account/support/t1');
    expect(within(list).getByText('TK-7K3M9Q2X · A booking · booking HT-7K3M9Q2X')).toBeInTheDocument();
    expect(within(list).getByText('Open')).toBeInTheDocument();
    expect(within(list).getByText('Waiting for your reply')).toBeInTheDocument();
    expect(within(list).getByText(/Last message from support/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New ticket' })).toHaveAttribute('href', '/account/support/new');
    expect(ticketApi.list).toHaveBeenCalledWith({ status: '', page: 0 }, 10);
  });

  it('filters by status (in the URL) and has a friendly empty state', async () => {
    vi.mocked(ticketApi.list).mockResolvedValue(page([]));
    const { user, router } = open('/account/support');
    expect(await screen.findByText('No support tickets yet')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'CLOSED');

    await waitFor(() => expect(ticketApi.list).toHaveBeenLastCalledWith({ status: 'CLOSED', page: 0 }, 10));
    expect(currentLocation(router)).toBe('/account/support?status=CLOSED');
    expect(await screen.findByText('No tickets match')).toBeInTheDocument();
    // Nothing to export.
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('exports my tickets on screen as CSV: number, subject, topic, booking, status and dates', async () => {
    const files = stubFileSaving();
    vi.mocked(ticketApi.list).mockResolvedValue(page([
      summary({ createdAt: '2099-03-01T10:00:00', lastMessageAt: '2099-03-02T08:15:00' }),
      summary({ id: 't2', ticketNumber: 'TK-BBBB2222', subject: 'Refund not received', category: 'REFUND', status: 'WAITING_CUSTOMER',
        bookingId: null, bookingReference: null, lastMessageBy: 'SUPPORT', createdAt: '2099-03-03T09:00:00', lastMessageAt: '2099-03-04T17:45:00' }),
    ]));
    const { user } = open('/account/support');
    await screen.findByRole('list', { name: 'Support tickets' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export support tickets' });
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^support-tickets-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await files.blobs[0]!.text()).split('\r\n');
    expect(lines[0]).toBe('"Ticket number","Subject","Topic","Booking reference","Status","Last message from","Last message","Opened"');
    expect(lines[1]).toBe('"TK-7K3M9Q2X","Wrong name on my booking","A booking","HT-7K3M9Q2X","Open","You",2099-03-02 08:15,2099-03-01 10:00');
    expect(lines[2]).toMatch(/^"TK-BBBB2222","Refund not received","[^"]+",,"Waiting for your reply","Support",2099-03-04 17:45,2099-03-03 09:00$/);
    expect(lines).toHaveLength(4);
  });

  it('exports every matching ticket through the same call, with the status, topic and search', async () => {
    const files = stubFileSaving();
    const all = Array.from({ length: 25 }, (_, index) => summary({ id: `t${index}`, ticketNumber: `TK-${String(index).padStart(8, '0')}` }));
    vi.mocked(ticketApi.list).mockImplementation(async (filters, size = 10) => ({
      content: all.slice(filters.page * size, filters.page * size + size), page: filters.page, size, totalElements: all.length,
      totalPages: Math.ceil(all.length / size),
    }));
    const { user } = open('/account/support?status=OPEN&q=refund&category=REFUND');
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(ticketApi.list).toHaveBeenLastCalledWith({ status: 'OPEN', page: 0, q: 'refund', category: 'REFUND' }, 100);
    const lines = (await files.blobs[0]!.text()).split('\r\n');
    expect(lines).toHaveLength(27);
    expect(lines[25]).toMatch(/^"TK-00000024",/);
  });
});

describe('TicketsPage figures and search', () => {
  it('shows my ticket counts, points to the tickets waiting for me and filters them', async () => {
    vi.mocked(ticketApi.list).mockResolvedValue(page([summary()]));
    const { user, router } = open('/account/support');

    const figures = await screen.findByLabelText('Ticket figures');
    const card = (label: string) => within(figures).getByText(label).closest('li')!;
    await waitFor(() => expect(card('Total tickets')).toHaveTextContent('7'));
    expect(card('Open')).toHaveTextContent('2');
    expect(card('In progress')).toHaveTextContent('1');
    expect(card('Resolved')).toHaveTextContent('3');
    expect(await screen.findByText(/1 ticket is waiting for your reply/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show them' }));
    await waitFor(() => expect(ticketApi.list).toHaveBeenLastCalledWith({ status: 'WAITING_CUSTOMER', page: 0 }, 10));
    expect(currentLocation(router)).toBe('/account/support?status=WAITING_CUSTOMER');
  });

  it('searches by words and topic through the API and shows an empty state with a way back', async () => {
    vi.mocked(ticketApi.list).mockResolvedValue(page([summary()]));
    const { user, router } = open('/account/support');
    await screen.findByRole('list', { name: 'Support tickets' });

    await user.type(screen.getByRole('searchbox', { name: 'Search my tickets' }), 'wrong name');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(ticketApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'wrong name' }), 10));
    expect(currentLocation(router)).toBe('/account/support?q=wrong+name');

    vi.mocked(ticketApi.list).mockResolvedValue(page([]));
    await user.selectOptions(screen.getByLabelText('Topic'), 'A payment');
    await waitFor(() => expect(ticketApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'wrong name', category: 'PAYMENT' }), 10));
    expect(await screen.findByText('No tickets match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
    await waitFor(() => expect(currentLocation(router)).toBe('/account/support'));
  });
});

describe('NewTicketPage', () => {
  it('starts from a booking ("Get help with this booking") and creates the ticket for it', async () => {
    vi.mocked(ticketApi.create).mockResolvedValue(ticket({ id: 't9', ticketNumber: 'TK-NEW00001', messages: [] }));
    const { user, router } = open('/account/support/new?bookingId=b1');

    const booking = await screen.findByLabelText(/^Booking/);
    expect(booking).toHaveValue('b1');
    expect(within(booking).getByRole('option', { name: /HT-7K3M9Q2X · Sea Breeze Resort/ })).toBeInTheDocument();
    expect(screen.getByLabelText('What is it about?')).toHaveValue('BOOKING');

    await user.type(screen.getByLabelText('Subject'), 'Wrong name on my booking');
    await user.type(screen.getByLabelText('Message'), 'My last name is spelt wrong.');
    await user.click(screen.getByRole('button', { name: 'Send ticket' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/account/support/t9'));
    expect(ticketApi.create).toHaveBeenCalledWith({
      subject: 'Wrong name on my booking', category: 'BOOKING', bookingId: 'b1', message: 'My last name is spelt wrong.',
    });
    expect(await screen.findByText('Ticket TK-NEW00001 created. We will answer here.')).toBeInTheDocument();
  });

  it('loads a pre-selected booking that is not in the first page of bookings', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(bookingFixture({ id: 'old', reference: 'HT-OLD00001', title: 'Palm Grove' }));
    open('/account/support/new?bookingId=old');

    const booking = await screen.findByLabelText(/^Booking/);
    expect(booking).toHaveValue('old');
    expect(within(booking).getByRole('option', { name: /HT-OLD00001 · Palm Grove/ })).toBeInTheDocument();
    expect(bookingApi.details).toHaveBeenCalledWith('old');
  });

  it('sends a ticket without a booking and checks the fields first', async () => {
    vi.mocked(ticketApi.create).mockResolvedValue(ticket({ id: 't9' }));
    const { user } = open('/account/support/new');

    await user.type(await screen.findByLabelText('Subject'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send ticket' }));

    expect(await screen.findByText('Use at least 5 characters')).toBeInTheDocument();
    expect(screen.getByText('Choose what it is about')).toBeInTheDocument();
    expect(screen.getByText('Tell us how we can help')).toBeInTheDocument();
    expect(ticketApi.create).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Subject'), ' there, a question');
    await user.selectOptions(screen.getByLabelText('What is it about?'), 'ACCOUNT');
    await user.type(screen.getByLabelText('Message'), 'How do I change my e-mail?');
    await user.click(screen.getByRole('button', { name: 'Send ticket' }));

    await waitFor(() => expect(ticketApi.create).toHaveBeenCalledWith({
      subject: 'Hi there, a question', category: 'ACCOUNT', message: 'How do I change my e-mail?',
    }));
  });

  it('shows a refused booking next to the booking field (422 INVALID_BOOKING)', async () => {
    vi.mocked(ticketApi.create).mockRejectedValue(new ApiError(422, 'INVALID_BOOKING', 'This booking is not yours.'));
    const { user } = open('/account/support/new?bookingId=b2');

    await user.type(await screen.findByLabelText('Subject'), 'Seat question');
    await user.type(screen.getByLabelText('Message'), 'Can I choose a seat?');
    await user.click(screen.getByRole('button', { name: 'Send ticket' }));

    expect(await screen.findByText('This booking is not yours.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Booking/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows other errors with the support reference', async () => {
    vi.mocked(ticketApi.create).mockRejectedValue(new ApiError(429, 'HTTP_429', 'Too many requests. Please wait a moment.', [], 'corr-3'));
    const { user } = open('/account/support/new?bookingId=b1');

    await user.type(await screen.findByLabelText('Subject'), 'Wrong name on my booking');
    await user.type(screen.getByLabelText('Message'), 'Please fix it.');
    await user.click(screen.getByRole('button', { name: 'Send ticket' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many requests. Please wait a moment.');
    expect(alert).toHaveTextContent('Support reference: corr-3');
  });
});

describe('TicketPage (conversation)', () => {
  it('shows the conversation with who wrote each message, the status and the booking', async () => {
    open('/account/support/t1');

    expect(await screen.findByRole('heading', { name: 'Wrong name on my booking' })).toBeInTheDocument();
    const messages = screen.getByRole('list', { name: 'Messages' });
    const items = within(messages).getAllByRole('listitem');
    expect(within(items[0]!).getByText('You')).toBeInTheDocument();
    expect(within(items[0]!).getByText(/My last name is spelt wrong/)).toBeInTheDocument();
    expect(within(items[1]!).getByText('Support agent')).toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Booking HT-7K3M9Q2X' })).toHaveAttribute('href', '/my-trips/b1');
  });

  it('labels automatic and admin messages', async () => {
    vi.mocked(ticketApi.get).mockResolvedValue(ticket({
      category: 'CANCELLATION',
      messages: [
        { id: 's1', authorRole: 'SYSTEM', message: 'The hotel could not cancel your booking.', createdAt: '2099-03-01T10:00:00Z' },
        { id: 's2', authorRole: 'ADMIN', message: 'We are on it.', createdAt: '2099-03-01T10:05:00Z' },
      ],
    }));
    open('/account/support/t1');

    expect(await screen.findByText('Automatic message')).toBeInTheDocument();
    expect(screen.getByText('Support team')).toBeInTheDocument();
  });

  it('sends a reply and shows it at once', async () => {
    vi.mocked(ticketApi.reply).mockImplementation(async () => {
      // The refresh after the reply is still on its way: the reply must show without it.
      vi.mocked(ticketApi.get).mockReturnValue(new Promise(() => {}));
      return { id: 'm3', authorRole: 'CUSTOMER', message: 'Thank you!', createdAt: '2099-03-01T12:00:00Z' };
    });
    const { user } = open('/account/support/t1');

    await user.type(await screen.findByLabelText('Your reply'), 'Thank you!');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(ticketApi.reply).toHaveBeenCalledWith('t1', 'Thank you!'));
    expect(await within(screen.getByRole('list', { name: 'Messages' })).findByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByLabelText('Your reply')).toHaveValue('');
    expect(await screen.findByText('Reply sent.')).toBeInTheDocument();
  });

  it('does not send an empty reply', async () => {
    const { user } = open('/account/support/t1');

    await user.click(await screen.findByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText('Write your reply first')).toBeInTheDocument();
    expect(ticketApi.reply).not.toHaveBeenCalled();
  });

  it('a reply to a resolved ticket reopens it', async () => {
    vi.mocked(ticketApi.get).mockResolvedValueOnce(ticket({ status: 'RESOLVED' })).mockResolvedValue(ticket({ status: 'OPEN' }));
    vi.mocked(ticketApi.reply).mockResolvedValue({ id: 'm3', authorRole: 'CUSTOMER', message: 'Still wrong.', createdAt: '2099-03-02T12:00:00Z' });
    const { user } = open('/account/support/t1');

    expect(await screen.findByText(/If you still need help, reply below: that reopens the ticket/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your reply'), 'Still wrong.');
    await user.click(screen.getByRole('button', { name: 'Send and reopen' }));

    expect(await screen.findByText('Reply sent. The ticket is open again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Open').length).toBeGreaterThan(0));
  });

  it('closes the ticket after asking, and then takes no more replies', async () => {
    vi.mocked(ticketApi.close).mockResolvedValue(ticket({ status: 'CLOSED' }));
    const { user } = open('/account/support/t1');

    await user.click(await screen.findByRole('button', { name: 'Close ticket' }));
    const confirm = screen.getByRole('region', { name: 'Close this ticket?' });
    expect(within(confirm).getByRole('heading', { name: 'Close this ticket?' })).toHaveFocus();
    expect(ticketApi.close).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Yes, close ticket' }));

    await waitFor(() => expect(ticketApi.close).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText(/This ticket is closed and takes no more replies/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close ticket' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a new ticket' })).toHaveAttribute('href', '/account/support/new?bookingId=b1');
  });

  it('keeps the ticket open when the customer changes their mind', async () => {
    const { user } = open('/account/support/t1');

    await user.click(await screen.findByRole('button', { name: 'Close ticket' }));
    await user.click(screen.getByRole('button', { name: 'Keep it open' }));

    expect(screen.queryByRole('region', { name: 'Close this ticket?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close ticket' })).toHaveFocus();
  });

  it('a closed ticket shows no reply box', async () => {
    vi.mocked(ticketApi.get).mockResolvedValue(ticket({ status: 'CLOSED' }));
    open('/account/support/t1');

    expect(await screen.findByText(/This ticket is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
  });

  it('keeps a reply refused as closed (409 TICKET_CLOSED) and carries it into a new ticket', async () => {
    vi.mocked(ticketApi.get).mockResolvedValueOnce(ticket()).mockResolvedValue(ticket({ status: 'CLOSED' }));
    vi.mocked(ticketApi.reply).mockRejectedValue(new ApiError(409, 'TICKET_CLOSED', 'This ticket is closed.'));
    const { user, router } = open('/account/support/t1');

    await user.type(await screen.findByLabelText('Your reply'), 'One more thing.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText('Your reply was not sent')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Start a new ticket with your text' }));

    await waitFor(() => expect(currentLocation(router)).toBe('/account/support/new?bookingId=b1'));
    expect(await screen.findByLabelText('Message')).toHaveValue('One more thing.');
  });

  it('shows a new answer from support live (support.ticket-changed)', async () => {
    vi.mocked(ticketApi.get).mockResolvedValueOnce(ticket()).mockResolvedValue(ticket({
      status: 'WAITING_CUSTOMER',
      messages: [...ticket().messages, { id: 'm4', authorRole: 'SUPPORT_AGENT', message: 'Could you send the guest name?', createdAt: '2099-03-01T13:00:00Z' }],
    }));
    const { queryClient } = open('/account/support/t1');
    await screen.findByRole('heading', { name: 'Wrong name on my booking' });

    applyInvalidation(queryClient, { id: 'e1', type: 'support.ticket-changed', resourceType: 'SUPPORT_TICKET', resourceId: 't1', data: {}, occurredAt: '2099-03-01T13:00:00Z' });

    expect(await screen.findByText('Could you send the guest name?')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for your reply').length).toBeGreaterThan(0);
  });

  it('says when the ticket does not exist (or is someone else\'s)', async () => {
    vi.mocked(ticketApi.get).mockRejectedValue(new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found'));
    open('/account/support/nope');

    expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Support tickets' })).toHaveAttribute('href', '/account/support');
  });
});
