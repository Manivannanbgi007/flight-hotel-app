import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import type { AuthUser } from '@/lib/auth/types';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { agentTicketApi } from './agentTicketApi';
import { EscalationsPage } from './EscalationsPage';
import { SupportDashboardPage } from './SupportDashboardPage';
import { supportApi } from './supportApi';
import { supportMetricsApi, type SupportMetrics } from './supportMetricsApi';
import type { AgentTicketSummary, SupportBookingRow } from './types';

vi.mock('./supportApi', () => ({ supportApi: { searchBookings: vi.fn() } }));
vi.mock('./supportMetricsApi', () => ({ supportMetricsApi: { get: vi.fn() } }));
vi.mock('./agentTicketApi', () => ({
  agentTicketApi: { queue: vi.fn(), summary: vi.fn(), assign: vi.fn(), changeStatus: vi.fn(), get: vi.fn(), reply: vi.fn() },
}));

const agent: AuthUser = {
  ...customer, id: 'agent-1', email: 'agent@example.com', roles: ['SUPPORT_AGENT'],
  permissions: ['BOOKING_READ_ANY', 'BOOKING_MANAGE_ANY', 'SUPPORT_TICKET_MANAGE'],
};

const page = <T,>(content: T[], totalElements = content.length) => ({ content, page: 0, size: 10, totalElements, totalPages: 1 });

const ticket = (overrides: Partial<AgentTicketSummary> = {}): AgentTicketSummary => ({
  id: 't1', ticketNumber: 'TK-7K3M9Q2X', subject: 'Refund not received', category: 'REFUND', status: 'ESCALATED',
  bookingId: 'b1', bookingReference: 'HT-7K3M9Q2X', createdAt: '2099-03-01T10:00:00Z', lastMessageAt: '2099-03-02T10:00:00Z',
  lastMessageBy: 'CUSTOMER', customerEmail: 'asha@example.com', priority: 'HIGH', assignedAgentId: null, assignedToMe: false,
  ...overrides,
});

const booking = (overrides: Partial<SupportBookingRow> = {}): SupportBookingRow => ({
  id: 'b1', reference: 'HT-7K3M9Q2X', type: 'HOTEL', status: 'REFUND_PENDING', paymentStatus: 'REFUND_PENDING', title: 'Sea Breeze Resort',
  destination: 'Goa', startDate: '2099-03-10', endDate: '2099-03-12', totalAmount: 2625, currency: 'INR', createdAt: '2099-03-01T10:00:00Z',
  contactEmail: 'asha@example.com', leadName: 'Asha Rao', attentionReason: 'REFUND_FAILED', attentionSince: '2099-03-02T11:00:00Z',
  demo: false, ...overrides,
});

const metrics = (overrides: Partial<SupportMetrics> = {}): SupportMetrics => ({
  range: { preset: 'LAST_30_DAYS', from: '2026-10-08', to: '2026-11-06' },
  previousRange: { preset: 'PREVIOUS_PERIOD', from: '2026-09-08', to: '2026-10-07' },
  interval: 'DAY',
  byStatus: { OPEN: 4, IN_PROGRESS: 2, WAITING_CUSTOMER: 7, ESCALATED: 1, RESOLVED: 5, CLOSED: 3 },
  open: 14,
  age: {
    buckets: [
      { key: 'UNDER_1_DAY', label: 'Under 1 day', count: 6 },
      { key: '1_TO_3_DAYS', label: '1–3 days', count: 5 },
      { key: '3_TO_7_DAYS', label: '3–7 days', count: 2 },
      { key: 'OVER_7_DAYS', label: '7 days or more', count: 1 },
    ],
    averageHours: 30.5,
    oldestOpenedAt: '2026-10-20T10:00:00Z',
  },
  opened: 12,
  resolved: 8,
  openedByCategory: { BOOKING: 5, PAYMENT: 3, REFUND: 2, CANCELLATION: 1, ACCOUNT: 0, OTHER: 1 },
  firstResponse: { averageMinutes: 95, medianMinutes: 42, responded: 10, awaiting: 2 },
  resolution: { resolved: 8, averageHours: 26 },
  series: [
    { key: '2026-11-05', start: '2026-11-05', end: '2026-11-05', opened: 7, resolved: 3 },
    { key: '2026-11-06', start: '2026-11-06', end: '2026-11-06', opened: 5, resolved: 5 },
  ],
  comparison: {
    opened: { current: 12, previous: 8, change: 4, changePercent: 50, trend: 'UP' },
    resolved: { current: 8, previous: 0, change: 8, changePercent: null, trend: 'UP' },
    averageFirstResponseMinutes: { current: 95, previous: 120, change: -25, changePercent: -20.8, trend: 'DOWN' },
  },
  generatedAt: '2026-11-06T10:00:00Z',
  ...overrides,
});

beforeEach(() => {
  vi.mocked(supportMetricsApi.get).mockResolvedValue(metrics());
  vi.mocked(agentTicketApi.summary).mockResolvedValue({ open: 4, inProgress: 2, waitingCustomer: 7, escalated: 1, unassigned: 3, assignedToMe: 5, resolved: 0, highPriority: 0, total: 14 });
  vi.mocked(supportApi.searchBookings).mockResolvedValue(page([booking()], 6));
  vi.mocked(agentTicketApi.queue).mockResolvedValue(page([ticket()]));
});

describe('SupportDashboardPage', () => {
  const open = () => renderRoutes([{ path: '/support', element: <SupportDashboardPage /> }], { path: '/support', auth: fakeAuth({ user: agent }) });

  it('shows the ticket counts and the bookings that need attention, each linking to its list', async () => {
    open();

    expect(await screen.findByRole('link', { name: 'Open: 4' })).toHaveAttribute('href', '/support/tickets?status=OPEN');
    expect(screen.getByRole('link', { name: 'In progress: 2' })).toHaveAttribute('href', '/support/tickets?status=IN_PROGRESS');
    expect(screen.getByRole('link', { name: 'Waiting for customer: 7' })).toHaveAttribute('href', '/support/tickets?status=WAITING_CUSTOMER');
    expect(screen.getByRole('link', { name: 'Escalated: 1' })).toHaveAttribute('href', '/support/escalations');
    expect(screen.getByRole('link', { name: 'Unassigned: 3' })).toHaveAttribute('href', '/support/tickets?assigned=UNASSIGNED');
    expect(screen.getByRole('link', { name: 'Assigned to me: 5' })).toHaveAttribute('href', '/support/tickets?assigned=ME');
    expect(await screen.findByRole('link', { name: 'Need attention: 6' })).toHaveAttribute('href', '/support/attention');
    // Only the size of the "Needs attention" queue is asked for.
    expect(supportApi.searchBookings).toHaveBeenCalledWith({ q: '', status: '', type: '', attention: true, page: 0 }, 1);
  });

  it('keeps the booking figure when the ticket counts fail, with the support reference and a retry', async () => {
    vi.mocked(agentTicketApi.summary).mockRejectedValue(new ApiError(503, 'HTTP_503', 'Something went wrong on our side.', [], 'corr-55'));
    const { user } = open();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the ticket counts');
    expect(alert).toHaveTextContent('Support reference: corr-55');
    expect(await screen.findByRole('link', { name: 'Need attention: 6' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Open:/ })).not.toBeInTheDocument();

    vi.mocked(agentTicketApi.summary).mockResolvedValue({ open: 1, inProgress: 0, waitingCustomer: 0, escalated: 0, unassigned: 0, assignedToMe: 0, resolved: 0, highPriority: 0, total: 1 });
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Open: 1' })).toBeInTheDocument();
  });

  it('keeps the ticket counts when the bookings figure fails', async () => {
    vi.mocked(supportApi.searchBookings).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this.'));
    open();

    expect(await screen.findByText('Could not load the bookings that need attention')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open: 4' })).toBeInTheDocument();
  });
});

describe('SupportDashboardPage metrics', () => {
  const open = (path = '/support') => renderRoutes([{ path: '/support', element: <SupportDashboardPage /> }], { path, auth: fakeAuth({ user: agent }) });
  const card = (region: HTMLElement, label: string) =>
    within(region).getAllByRole('listitem').find((item) => within(item).queryByText(label, { exact: true })) as HTMLElement;

  beforeAll(async () => {
    await import('@/components/charts/impl/rechartsPlots');
  }, 60_000);

  it('shows tickets opened and resolved, open tickets and response times against the previous period', async () => {
    open();

    await screen.findByRole('table', { name: 'All tickets by status' });
    const flow = screen.getByRole('region', { name: 'Ticket flow' });
    expect(card(flow, 'Tickets opened')).toHaveTextContent('12');
    expect(card(flow, 'Tickets opened')).toHaveTextContent('Up 50%');
    expect(card(flow, 'Tickets resolved')).toHaveTextContent('8');
    expect(card(flow, 'Tickets resolved')).toHaveTextContent('New: nothing in the previous period');
    expect(card(flow, 'Open tickets now')).toHaveTextContent('14');
    expect(card(flow, 'Open tickets now')).toHaveTextContent('Open for 1.3 days on average');

    const times = screen.getByRole('region', { name: 'Response times' });
    expect(card(times, 'First response, average')).toHaveTextContent('1 h 35 min');
    // A shorter response time is good news.
    expect(within(card(times, 'First response, average')).getByText('Down', { exact: false }).parentElement).toHaveClass('bg-success-50');
    expect(card(times, 'First response, average')).toHaveTextContent('10 answered · 2 still waiting');
    expect(card(times, 'First response, median')).toHaveTextContent('42 min');
    expect(card(times, 'Resolution time, average')).toHaveTextContent('1.1 days');
    expect(card(times, 'Resolution time, average')).toHaveTextContent('8 resolved');
    expect(supportMetricsApi.get).toHaveBeenCalledWith({ preset: 'LAST_30_DAYS', from: '', to: '', interval: null });
  });

  it('charts opened vs resolved, tickets by status, open tickets by age and opened by category', async () => {
    open();

    expect(await screen.findByRole('img', { name: /^Tickets opened and resolved per day, 5 Nov to 6 Nov\. Opened: 12 in total.*Resolved: 8 in total/ })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'All tickets by status' })).getAllByRole('row').map((row) => row.textContent)).toEqual([
      'StatusTickets', 'Open4', 'In progress2', 'Waiting for customer7', 'Escalated1', 'Resolved5', 'Closed3',
    ]);
    expect(within(screen.getByRole('table', { name: 'Open tickets by age' })).getAllByRole('row').map((row) => row.textContent)).toEqual([
      'Open forOpen tickets', 'Under 1 day6', '1–3 days5', '3–7 days2', '7 days or more1',
    ]);
    expect(screen.getByRole('img', { name: /^Tickets opened by category, Booking to Other\. Tickets opened: 12 in total, highest 5 on Booking\./ })).toBeInTheDocument();
  });

  it('shows no change chip and a dash when nothing was answered', async () => {
    vi.mocked(supportMetricsApi.get).mockResolvedValue(metrics({
      firstResponse: { averageMinutes: null, medianMinutes: null, responded: 0, awaiting: 3 },
      resolution: { resolved: 0, averageHours: null },
      comparison: { ...metrics().comparison, averageFirstResponseMinutes: null },
    }));
    open();

    await screen.findByRole('table', { name: 'All tickets by status' });
    const times = screen.getByRole('region', { name: 'Response times' });
    expect(card(times, 'First response, average')).toHaveTextContent('–');
    expect(card(times, 'First response, average')).not.toHaveTextContent(/Up|Down|NaN/);
    expect(card(times, 'Resolution time, average')).toHaveTextContent('–');
  });

  it('keeps the range and the interval in the URL', async () => {
    const { user, router } = open();
    await screen.findByRole('table', { name: 'All tickets by status' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Date range' }), 'Last 90 days');
    await waitFor(() => expect(supportMetricsApi.get).toHaveBeenLastCalledWith({ preset: 'LAST_90_DAYS', from: '', to: '', interval: null }));
    await user.click(screen.getByRole('radio', { name: 'Day' }));
    await waitFor(() => expect(supportMetricsApi.get).toHaveBeenLastCalledWith({ preset: 'LAST_90_DAYS', from: '', to: '', interval: 'DAY' }));
    expect(currentLocation(router)).toBe('/support?range=LAST_90_DAYS&interval=DAY');
  });

  it('keeps the ticket counts when the metrics fail', async () => {
    vi.mocked(supportMetricsApi.get).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side.', [], 'corr-m'));
    open();

    expect(await screen.findByText('Could not load the support metrics')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-m')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open: 4' })).toBeInTheDocument();
  });
});

describe('EscalationsPage', () => {
  const open = () => renderRoutes([{ path: '/support/escalations', element: <EscalationsPage /> }],
    { path: '/support/escalations', auth: fakeAuth({ user: agent }) });

  it('lists escalated tickets and flagged bookings, each with a link to the full list', async () => {
    open();

    const tickets = await screen.findByRole('table', { name: 'Escalated tickets' });
    expect(within(tickets).getByRole('link', { name: 'Refund not received' })).toHaveAttribute('href', '/support/tickets/t1');
    expect(within(tickets).getByText('High priority')).toBeInTheDocument();
    expect(vi.mocked(agentTicketApi.queue).mock.calls[0]).toEqual([
      { q: '', status: 'ESCALATED', category: '', priority: '', assigned: 'ANY', sort: 'lastMessageAt,asc', page: 0 }, 10,
    ]);
    expect(screen.getByRole('link', { name: 'See all in the ticket queue' })).toHaveAttribute('href', '/support/tickets?status=ESCALATED');

    const bookings = await screen.findByRole('list', { name: 'Bookings that need attention' });
    expect(within(bookings).getByRole('link', { name: 'HT-7K3M9Q2X' })).toHaveAttribute('href', '/support/bookings/b1');
    expect(within(bookings).getByText('Refund failed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bookings that need attention (6)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the full queue' })).toHaveAttribute('href', '/support/attention');
    expect(supportApi.searchBookings).toHaveBeenCalledWith({ q: '', status: '', type: '', attention: true, page: 0 }, 10);
  });

  it('shows each section\'s own empty and error state', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(page([]));
    vi.mocked(supportApi.searchBookings).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side.', [], 'corr-9'));
    open();

    expect(await screen.findByText('No escalated tickets')).toBeInTheDocument();
    expect(await screen.findByText('Support reference: corr-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
