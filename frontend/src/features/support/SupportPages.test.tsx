import { screen, waitFor, within } from '@testing-library/react';
import { format, parseISO } from 'date-fns';

import { RequireRole } from '@/app/guards';
import { bookingApi } from '@/features/bookings/bookingApi';
import {
  bookingFixture,
  cancellationQuoteFixture,
  refundFixture,
} from '@/features/bookings/testData';
import type { BookingDetails } from '@/features/bookings/types';
import { paymentApi } from '@/features/payments/paymentApi';
import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { formatDateTime } from '@/lib/format';
import { stubFileSaving } from '@/test/downloads';
import { admin, currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { agentTicketApi } from './agentTicketApi';
import { SupportBookingPage } from './SupportBookingPage';
import { SupportDashboardPage } from './SupportDashboardPage';
import { SupportLayout } from './SupportLayout';
import { NeedsAttentionPage, SupportBookingsPage } from './SupportBookingsPage';
import { supportApi } from './supportApi';
import type { SupportBookingRow } from './types';

vi.mock('./supportApi', () => ({ supportApi: { searchBookings: vi.fn(), escalate: vi.fn(), resolve: vi.fn(), retryRefund: vi.fn() } }));
vi.mock('./agentTicketApi', () => ({
  agentTicketApi: { queue: vi.fn(), summary: vi.fn(), assign: vi.fn(), changeStatus: vi.fn(), get: vi.fn(), reply: vi.fn() },
}));
vi.mock('@/features/bookings/bookingApi', () => ({
  bookingApi: { details: vi.fn(), timeline: vi.fn(), cancellationQuote: vi.fn(), cancel: vi.fn() },
}));
vi.mock('@/features/payments/paymentApi', () => ({ paymentApi: { forBooking: vi.fn(), invoiceForBooking: vi.fn() } }));

/** Permissions as identity-service gives them (V3__roles_and_permissions.sql). */
const agent: AuthUser = {
  ...customer, id: 'agent-1', email: 'agent@example.com', firstName: 'Sam', lastName: 'Agent', roles: ['SUPPORT_AGENT'],
  permissions: ['BOOKING_READ_ANY', 'BOOKING_MANAGE_ANY', 'PAYMENT_READ_ANY', 'SUPPORT_TICKET_MANAGE', 'USER_READ_ANY'],
};
const readOnly: AuthUser = { ...agent, permissions: ['BOOKING_READ_ANY'] };
const refundAdmin: AuthUser = { ...admin, permissions: ['BOOKING_READ_ANY', 'BOOKING_MANAGE_ANY', 'PAYMENT_READ_ANY', 'REFUND_MANAGE'] };

const row = (overrides: Partial<SupportBookingRow> = {}): SupportBookingRow => ({
  id: 'b1', reference: 'HT-7K3M9Q2X', type: 'HOTEL', status: 'CONFIRMED', paymentStatus: 'PAID', title: 'Sea Breeze Resort',
  destination: 'Goa', startDate: '2099-03-10', endDate: '2099-03-12', totalAmount: 2625, currency: 'INR',
  createdAt: '2099-03-01T10:00:00Z', contactEmail: 'asha@example.com', leadName: 'Asha Rao', attentionReason: null,
  attentionSince: null, demo: true, ...overrides,
});
const page = (content: SupportBookingRow[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 });

const confirmed = (overrides: Partial<BookingDetails> = {}) => bookingFixture({
  status: 'CONFIRMED', paymentStatus: 'PAID', canPay: false, canCancel: true, ...overrides,
});
const refundFailed = () => confirmed({
  status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING', canCancel: false,
  refunds: [refundFixture({ status: 'FAILED' })],
  attention: { reason: 'REFUND_FAILED', note: null, since: '2099-03-02T11:00:00Z' },
});

beforeEach(() => {
  vi.mocked(supportApi.searchBookings).mockResolvedValue(page([]));
  vi.mocked(agentTicketApi.summary).mockResolvedValue({ open: 0, inProgress: 0, waitingCustomer: 0, escalated: 0, unassigned: 0, assignedToMe: 0, resolved: 0, highPriority: 0, total: 0 });
  vi.mocked(bookingApi.details).mockResolvedValue(confirmed());
  vi.mocked(bookingApi.timeline).mockResolvedValue([
    { fromStatus: 'SUPPLIER_PENDING', status: 'CONFIRMED', reason: 'Hotel confirmed', at: '2099-03-01T10:02:00Z' },
  ]);
  vi.mocked(bookingApi.cancellationQuote).mockResolvedValue(cancellationQuoteFixture());
  vi.mocked(paymentApi.forBooking).mockResolvedValue([]);
  vi.mocked(paymentApi.invoiceForBooking).mockRejectedValue(new ApiError(404, 'INVOICE_NOT_FOUND', 'Not found'));
});

describe('Support portal', () => {
  // Same shape as app/router.tsx: the role guard, then the portal layout.
  const open = (user: AuthUser, path = '/support') => renderRoutes([{
    path: '/support',
    element: <RequireRole roles={['SUPPORT_AGENT', 'ADMIN']} />,
    children: [{
      element: <SupportLayout />,
      children: [
        { index: true, element: <SupportDashboardPage /> },
        { path: 'bookings', element: <SupportBookingsPage /> },
      ],
    }],
  }], { path, auth: fakeAuth({ user }) });

  it('is closed to customers', () => {
    open(customer);
    expect(screen.getByRole('heading', { name: "You don't have access to this page" })).toBeInTheDocument();
    expect(supportApi.searchBookings).not.toHaveBeenCalled();
    expect(agentTicketApi.summary).not.toHaveBeenCalled();
  });

  it('opens on the dashboard for support agents, with tickets, escalations and bookings one click away', async () => {
    open(agent);
    const nav = screen.getByRole('navigation', { name: 'Support' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Ticket queue' })).toHaveAttribute('href', '/support/tickets');
    expect(within(nav).getByRole('link', { name: 'Escalations' })).toHaveAttribute('href', '/support/escalations');
    expect(within(nav).getByRole('link', { name: 'Booking lookup' })).toHaveAttribute('href', '/support/bookings');
    expect(within(nav).getByRole('link', { name: 'Needs attention' })).toHaveAttribute('href', '/support/attention');
    expect(within(nav).queryByText(/Coming soon|Phase 9/)).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Support dashboard' })).toBeInTheDocument();
  });

  it('shows the booking lookup at /support/bookings', async () => {
    open(agent, '/support/bookings');
    const nav = screen.getByRole('navigation', { name: 'Support' });
    expect(within(nav).getByRole('link', { name: 'Booking lookup' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('heading', { name: 'Booking lookup' })).toBeInTheDocument();
  });
});

describe('Support booking lookup', () => {
  const open = (path = '/support/bookings', user: AuthUser = agent) => renderRoutes([
    { path: '/support/bookings', element: <SupportBookingsPage /> },
    { path: '/support/attention', element: <NeedsAttentionPage /> },
    { path: '/support/bookings/:bookingId', element: <p>assist page</p> },
  ], { path, auth: fakeAuth({ user }) });
  const lastFilters = () => vi.mocked(supportApi.searchBookings).mock.lastCall?.[0];

  it('lists bookings with customer, status, payment, amount and attention flag, and opens one', async () => {
    vi.mocked(supportApi.searchBookings).mockResolvedValue(page([
      row({ attentionReason: 'REFUND_FAILED', attentionSince: '2099-03-02T11:00:00Z', status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING' }),
      row({ id: 'b2', reference: 'FL-AB12CD34', type: 'FLIGHT', title: 'Delhi to Mumbai', leadName: null, contactEmail: 'ravi@example.com' }),
    ]));
    const { user, router } = open();

    const table = await screen.findByRole('table', { name: 'Bookings' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(within(first!).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(first!).getByText('asha@example.com')).toBeInTheDocument();
    expect(within(first!).getAllByText('Refund in progress')).toHaveLength(2); // booking status and payment status
    expect(within(first!).getByText('₹2,625.00')).toBeInTheDocument();
    expect(within(first!).getByText('Refund failed')).toBeInTheDocument();
    expect(within(first!).getByText(`since ${formatDateTime('2099-03-02T11:00:00Z')}`)).toBeInTheDocument();
    expect(within(second!).getByText('ravi@example.com')).toBeInTheDocument();
    expect(within(second!).getByText('Paid')).toBeInTheDocument();
    expect(lastFilters()).toEqual({ q: '', status: '', type: '', attention: false, page: 0 });
    expect(vi.mocked(supportApi.searchBookings).mock.lastCall?.[1]).toBe(25); // page size

    await user.click(within(first!).getByRole('link', { name: 'HT-7K3M9Q2X' }));
    expect(currentLocation(router)).toBe('/support/bookings/b1');
  });

  it('filters by type with the quick pills, counts what it found in the hero and opens a row anywhere', async () => {
    vi.mocked(supportApi.searchBookings).mockResolvedValue(page([row()]));
    const { user, router } = open();
    await screen.findByRole('table', { name: 'Bookings' });

    expect(await screen.findByRole('list', { name: 'At a glance' })).toHaveTextContent('Bookings found1');
    const pills = screen.getByRole('group', { name: 'Quick type filter' });
    expect(within(pills).getByRole('button', { name: 'Hotels and flights' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(pills).getByRole('button', { name: 'Flights' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ type: 'FLIGHT', page: 0 }));
    expect(currentLocation(router)).toBe('/support/bookings?type=FLIGHT');

    await user.click(within(await screen.findByRole('table', { name: 'Bookings' })).getByText('asha@example.com'));
    expect(currentLocation(router)).toBe('/support/bookings/b1');
  });

  it('searches by reference, e-mail, PNR or confirmation number and keeps the search in the URL', async () => {
    const { user, router } = open();
    await screen.findByText('No bookings found');

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), ' ht-7k3m9q2x ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(lastFilters()).toEqual({ q: 'ht-7k3m9q2x', status: '', type: '', attention: false, page: 0 }));
    expect(currentLocation(router)).toBe('/support/bookings?q=ht-7k3m9q2x');
  });

  it('filters by "Needs attention only", status and type', async () => {
    const { user, router } = open();
    await screen.findByText('No bookings found');

    await user.click(screen.getByRole('checkbox', { name: 'Needs attention only' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ attention: true }));
    expect(currentLocation(router)).toBe('/support/bookings?attention=true');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Refund in progress');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'Flights');

    await waitFor(() => expect(lastFilters()).toEqual({ q: '', status: 'REFUND_PENDING', type: 'FLIGHT', attention: true, page: 0 }));
  });

  it('shows the "Needs attention" queue: flagged bookings only', async () => {
    open('/support/attention');

    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
    expect(lastFilters()).toMatchObject({ attention: true });
    expect(screen.queryByRole('checkbox', { name: 'Needs attention only' })).not.toBeInTheDocument();
  });

  it('shows the support reference when the search fails', async () => {
    vi.mocked(supportApi.searchBookings).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.', [], 'corr-77'));
    open();

    expect(await screen.findByText('Support reference: corr-77')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('exports the bookings found, and every booking matching the same search and filters', async () => {
    const files = stubFileSaving();
    const all = [
      row(),
      row({ id: 'b2', reference: 'FL-AB12CD34', type: 'FLIGHT', title: 'Delhi to Mumbai', destination: null, leadName: null, demo: false,
        contactEmail: 'ravi@example.com', attentionReason: 'REFUND_FAILED', attentionSince: '2099-03-02T11:00:00Z', totalAmount: 9000 }),
      row({ id: 'b3', reference: 'HT-CCCC3333' }),
    ];
    // The screen asks for 25 a page (2 shown, 3 in all); the export asks for 100, which the server cuts to its 50.
    vi.mocked(supportApi.searchBookings).mockImplementation(async (filters, size = 25) => (size === 25
      ? { content: all.slice(0, 2), page: filters.page, size, totalElements: 3, totalPages: 2 }
      : { content: all, page: filters.page, size: Math.min(size, 50), totalElements: 3, totalPages: 1 }));
    const { user } = open('/support/bookings?q=asha%40example.com&status=CONFIRMED&attention=true');
    await screen.findByRole('table', { name: 'Bookings' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    let panel = screen.getByRole('dialog', { name: 'Export bookings' });
    expect(within(panel).getByText(/The file holds personal data/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    const local = (instant: string) => format(parseISO(instant), 'yyyy-MM-dd HH:mm');
    const lines = (await files.blobs[0]!.text()).split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('"Reference","Type","Demo booking","Lead traveller","Contact e-mail","Trip","Destination","From","To","Status","Payment",'
      + '"Amount","Currency","Needs attention","Flagged since","Booked at"');
    expect(lines.slice(1)).toEqual([
      `"HT-7K3M9Q2X","Hotel","Yes","Asha Rao","asha@example.com","Sea Breeze Resort","Goa",2099-03-10,2099-03-12,"Confirmed","Paid",2625.00,"INR",,,${local('2099-03-01T10:00:00Z')}`,
      `"FL-AB12CD34","Flight","No",,"ravi@example.com","Delhi to Mumbai",,2099-03-10,2099-03-12,"Confirmed","Paid",9000.00,"INR","Refund failed",${local('2099-03-02T11:00:00Z')},${local('2099-03-01T10:00:00Z')}`,
    ]);
    expect(files.saved[0]!.fileName).toMatch(/^support-bookings-\d{4}-\d{2}-\d{2}\.csv$/);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    panel = screen.getByRole('dialog', { name: 'Export bookings' });
    await user.click(within(panel).getByRole('radio', { name: /All matching rows/ }));
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(2));
    expect(vi.mocked(supportApi.searchBookings).mock.lastCall).toEqual([
      { q: 'asha@example.com', status: 'CONFIRMED', type: '', attention: true, page: 0 }, 100,
    ]);
    expect((await files.blobs[1]!.text()).split('\r\n').filter(Boolean)).toHaveLength(4);
  });

  it('names the export after the "Needs attention" queue there', async () => {
    vi.mocked(supportApi.searchBookings).mockResolvedValue(page([row({ attentionReason: 'REFUND_FAILED', attentionSince: '2099-03-02T11:00:00Z' })]));
    const { user } = open('/support/attention');
    await screen.findByRole('table', { name: 'Bookings that need attention' });

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByRole('dialog', { name: 'Export bookings needing attention' })).toBeInTheDocument();
  });
});

describe('Support booking assist', () => {
  const open = (user: AuthUser = agent) => renderRoutes([{ path: '/support/bookings/:bookingId', element: <SupportBookingPage /> }],
    { path: '/support/bookings/b1', auth: fakeAuth({ user }) });
  const actions = () => screen.queryByRole('region', { name: 'Actions' });

  it('shows the booking, the attention flag, the internal notes and the timeline', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      attention: { reason: 'ESCALATED', note: 'Customer called twice', since: '2099-03-02T11:00:00Z' },
      supportNotes: [
        { action: 'ESCALATED', note: 'Customer called twice', authorRole: 'SUPPORT_AGENT', createdAt: '2099-03-02T11:00:00Z' },
        { action: 'REFUND_RETRIED', note: null, authorRole: 'ADMIN', createdAt: '2099-03-02T12:00:00Z' },
      ],
    }));
    open();

    expect(await screen.findByRole('heading', { name: 'HT-7K3M9Q2X' })).toBeInTheDocument();
    const flag = screen.getByRole('region', { name: 'Needs attention' });
    expect(flag).toHaveTextContent('Needs attention: Escalated');
    expect(flag).toHaveTextContent('Note: Customer called twice');
    const notes = screen.getByRole('region', { name: 'Internal notes' });
    expect(within(notes).getByText('Refund retried')).toBeInTheDocument();
    expect(within(notes).getByText(`Admin · ${formatDateTime('2099-03-02T12:00:00Z')}`)).toBeInTheDocument();
    expect(screen.getByText(/Customer contact: asha@example.com/)).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Booking timeline' })).toBeInTheDocument();
    expect(paymentApi.forBooking).toHaveBeenCalledWith('b1');
  });

  it('shows no actions to a user who may only read bookings', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(refundFailed());
    open(readOnly);

    expect(await screen.findByRole('heading', { name: 'HT-7K3M9Q2X' })).toBeInTheDocument();
    expect(actions()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel on behalf|Escalate|Mark resolved|Retry refund/ })).not.toBeInTheDocument();
  });

  it('lets an agent cancel on behalf with a required reason, without a fee waiver', async () => {
    vi.mocked(bookingApi.cancel).mockResolvedValue({
      id: 'c1', status: 'PENDING', initiatedBy: 'SUPPORT_AGENT', reason: 'Customer asked us to cancel', feeWaived: false, currency: 'INR',
      cancellationFee: 656.25, refundAmount: 1968.75, requestedAt: '2099-03-02T10:00:00Z', completedAt: null, supplierReference: null,
      failureReason: null, failureMessage: null,
    });
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Cancel on behalf' }));

    expect(await screen.findByRole('region', { name: 'Refund calculation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cancel on behalf of the customer' })).toHaveFocus();
    expect(screen.queryByRole('checkbox', { name: /Waive/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel for the customer' }));
    expect(await screen.findByText('Choose a reason')).toBeInTheDocument();
    expect(bookingApi.cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: 'Customer asked us to cancel' }));
    await user.click(screen.getByRole('button', { name: 'Cancel for the customer' }));

    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(1));
    const [id, body, key] = vi.mocked(bookingApi.cancel).mock.calls[0]!;
    expect(id).toBe('b1');
    expect(body).toEqual({ reason: 'Customer asked us to cancel', expectedRefundAmount: 1968.75 });
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(await screen.findByText('Cancellation requested for the customer.')).toBeInTheDocument();
  });

  it('shows the server\'s answer when the reason is missing (422 REASON_REQUIRED)', async () => {
    vi.mocked(bookingApi.cancel).mockRejectedValue(new ApiError(422, 'REASON_REQUIRED', 'Give a reason when you cancel for a customer.'));
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Cancel on behalf' }));
    await user.click(await screen.findByRole('radio', { name: 'Other' }));
    await user.type(screen.getByLabelText('Write the reason'), 'Asked by phone');
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel for the customer' }));

    expect(await screen.findByText('Give a reason when you cancel for a customer.')).toBeInTheDocument();
  });

  it('lets a user with REFUND_MANAGE waive the fee: the quote is asked again with waiveFee', async () => {
    vi.mocked(bookingApi.cancellationQuote).mockImplementation(async (_id, waiveFee) => (waiveFee
      ? cancellationQuoteFixture({ cancellationFee: 0, refundAmount: 2625, feeWaived: true })
      : cancellationQuoteFixture()));
    vi.mocked(bookingApi.cancel).mockReturnValue(new Promise(() => {}));
    const { user } = open(refundAdmin);
    await user.click(await screen.findByRole('button', { name: 'Cancel on behalf' }));
    await user.click(await screen.findByRole('checkbox', { name: /Waive the cancellation fee/ }));

    const figures = screen.getByRole('region', { name: 'Refund calculation' });
    await waitFor(() => expect(within(figures).getByText('Waived')).toBeInTheDocument());
    expect(bookingApi.cancellationQuote).toHaveBeenLastCalledWith('b1', true);
    await user.click(screen.getByRole('radio', { name: 'The hotel or airline cannot honour the booking' }));
    await user.click(screen.getByRole('checkbox', { name: /I understand/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel for the customer' }));

    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(1));
    expect(vi.mocked(bookingApi.cancel).mock.calls[0]?.[1]).toEqual({
      reason: 'The hotel or airline cannot honour the booking', expectedRefundAmount: 2625, waiveFee: true,
    });
  });

  it('escalates with a required internal note', async () => {
    vi.mocked(supportApi.escalate).mockResolvedValue({ reason: 'ESCALATED', note: 'Customer called twice', since: '2099-03-02T11:00:00Z' });
    const { user } = open();
    expect(await screen.findByRole('heading', { name: 'HT-7K3M9Q2X' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument(); // not flagged

    await user.click(screen.getByRole('button', { name: 'Escalate' }));
    await user.click(screen.getByRole('button', { name: 'Escalate booking' }));
    expect(await screen.findByText('Write a short note')).toBeInTheDocument();
    expect(supportApi.escalate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Note'), 'Customer called twice');
    await user.click(screen.getByRole('button', { name: 'Escalate booking' }));

    await waitFor(() => expect(supportApi.escalate).toHaveBeenCalledWith('b1', 'Customer called twice'));
    expect(await screen.findByText(/Escalated. The booking is in the "Needs attention" queue./)).toBeInTheDocument();
  });

  it('marks a flagged booking resolved; the note is optional', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(confirmed({
      attention: { reason: 'CANCELLATION_REJECTED', note: null, since: '2099-03-02T11:00:00Z' },
    }));
    vi.mocked(supportApi.resolve).mockResolvedValue(undefined);
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }));
    await user.click(screen.getByRole('button', { name: 'Save and resolve' }));

    await waitFor(() => expect(supportApi.resolve).toHaveBeenCalledWith('b1', undefined));
  });

  it('offers "Retry refund" only to REFUND_MANAGE, and only when the latest refund failed', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue(refundFailed());
    vi.mocked(supportApi.retryRefund).mockResolvedValue(refundFixture({ id: 'r2', status: 'REQUESTED' }));
    const first = open(agent);
    expect(await screen.findByRole('button', { name: 'Escalate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry refund/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel on behalf' })).not.toBeInTheDocument(); // REFUND_PENDING
    first.unmount();

    const { user } = open(refundAdmin);
    await user.click(await screen.findByRole('button', { name: 'Retry refund of ₹1,968.75' }));
    await waitFor(() => expect(supportApi.retryRefund).toHaveBeenCalledWith('b1'));
  });

  it('does not offer "Retry refund" once a newer request is under way', async () => {
    vi.mocked(bookingApi.details).mockResolvedValue({
      ...refundFailed(),
      refunds: [
        refundFixture({ id: 'r1', status: 'FAILED', requestedAt: '2099-03-02T10:05:00Z' }),
        refundFixture({ id: 'r2', status: 'REQUESTED', requestedAt: '2099-03-02T12:00:00Z' }),
      ],
    });
    open(refundAdmin);

    expect(await screen.findByRole('button', { name: 'Escalate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry refund/ })).not.toBeInTheDocument();
  });

  it('says so when the booking does not exist', async () => {
    vi.mocked(bookingApi.details).mockRejectedValue(new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found.', [], 'corr-404'));
    open();

    expect(await screen.findByText('Booking not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Booking lookup' })).toHaveAttribute('href', '/support/bookings');
  });
});
