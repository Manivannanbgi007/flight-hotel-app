import { screen, waitFor, within } from '@testing-library/react';

import { agentTicketApi } from '@/features/support/agentTicketApi';
import { supportMetricsApi } from '@/features/support/supportMetricsApi';
import type { AgentTicketSummary } from '@/features/support/types';
import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { currentLocation } from '@/test/renderRoutes';
import { adminWithout, fullAdmin, pageOf, renderAdmin } from '../testUtils';
import { userApi } from '../users/userApi';
import { AdminSupportPage } from './AdminSupportPage';

vi.mock('@/features/support/agentTicketApi', () => ({
  agentTicketApi: { queue: vi.fn(), summary: vi.fn(), assign: vi.fn(), changeStatus: vi.fn() },
}));

vi.mock('@/features/support/supportMetricsApi', () => ({ supportMetricsApi: { get: vi.fn() } }));
vi.mock('../users/userApi', () => ({ userApi: { list: vi.fn() } }));

const ticket = (overrides: Partial<AgentTicketSummary> = {}): AgentTicketSummary => ({
  id: 't1', ticketNumber: 'TK-7K3M9Q2X', subject: 'Refund not received', category: 'REFUND', status: 'OPEN', bookingId: 'b1',
  bookingReference: 'HT-7K3M9Q2X', createdAt: '2026-11-04T10:00:00Z', lastMessageAt: '2026-11-05T08:00:00Z', lastMessageBy: 'CUSTOMER',
  customerEmail: 'asha@example.com', priority: 'NORMAL', assignedAgentId: null, assignedToMe: false, ...overrides,
});

const routes = [
  { path: '/admin/support', element: <AdminSupportPage /> },
  { path: '/support/tickets/:ticketId', element: <p>conversation</p> },
];

beforeEach(() => {
  vi.mocked(agentTicketApi.summary).mockResolvedValue({ open: 4, inProgress: 2, waitingCustomer: 1, escalated: 1, unassigned: 3, assignedToMe: 0, resolved: 6, highPriority: 2, total: 20 });
  vi.mocked(supportMetricsApi.get).mockResolvedValue({ resolution: { resolved: 5, averageHours: 3.25 } } as Awaited<ReturnType<typeof supportMetricsApi.get>>);
  vi.mocked(userApi.list).mockImplementation(async (filters) => pageOf(filters.role === 'SUPPORT_AGENT'
    ? [{ id: '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f', email: 'ravi@example.com', firstName: 'Ravi', lastName: 'Kumar', status: 'ACTIVE', roles: ['SUPPORT_AGENT'],
      emailVerified: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' }]
    : []));
});

describe('AdminSupportPage', () => {
  it('shows the counts and the queue, and opens a conversation in the support portal', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(pageOf([ticket(), ticket({ id: 't2', ticketNumber: 'TK-2', assignedAgentId: fullAdmin.id,
      assignedToMe: true, priority: 'HIGH', status: 'IN_PROGRESS' })]));
    const { user, router } = renderAdmin(routes, '/admin/support');

    const figures = await screen.findByLabelText('Ticket figures');
    const card = (label: string) => within(figures).getByText(label).closest('li')!;
    await waitFor(() => expect(card('Total tickets')).toHaveTextContent('20'));
    expect(card('Open tickets')).toHaveTextContent('4');
    expect(card('In progress')).toHaveTextContent('2');
    expect(card('Resolved')).toHaveTextContent('6');
    expect(card('High priority')).toHaveTextContent('2');
    expect(card('Average resolution time')).toHaveTextContent('3.3 h');
    expect(await screen.findByRole('button', { name: /Escalated\s*1/ })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Support tickets' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Refund not received');
    expect(first).toHaveTextContent('asha@example.com');
    expect(within(first!).getByText('Unassigned')).toBeInTheDocument();
    expect(within(second!).getByText('You')).toBeInTheDocument();
    expect(within(second!).queryByRole('button', { name: 'Assign TK-2 to me' })).not.toBeInTheDocument();
    expect(within(second!).getByRole('combobox', { name: 'Priority of TK-2' })).toHaveValue('HIGH');

    await user.click(within(first!).getByRole('link', { name: 'TK-7K3M9Q2X' }));
    expect(currentLocation(router)).toBe('/support/tickets/t1');
  });

  it('names the assigned agent, and filters by agent, day opened and a quick filter', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(pageOf([ticket({ assignedAgentId: '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f' })]));
    const { user, router } = renderAdmin(routes, '/admin/support');

    const table = await screen.findByRole('table', { name: 'Support tickets' });
    expect(await within(table).findByText('Ravi Kumar')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Created/ })).toBeInTheDocument();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Agent' }), 'Ravi Kumar');
    await waitFor(() => expect(agentTicketApi.queue).toHaveBeenLastCalledWith(expect.objectContaining({ agent: '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f' }), 25));
    expect(currentLocation(router)).toContain('agent=3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f');

    await user.click(screen.getByRole('button', { name: /Unassigned\s*3/ }));
    await waitFor(() => expect(agentTicketApi.queue).toHaveBeenLastCalledWith(expect.objectContaining({ assigned: 'UNASSIGNED' }), 25));
  });

  it('assigns a ticket to me and changes status and priority', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(pageOf([ticket()]));
    vi.mocked(agentTicketApi.assign).mockResolvedValue({ ...ticket(), messages: [] });
    vi.mocked(agentTicketApi.changeStatus).mockResolvedValue({ ...ticket(), messages: [] });
    const { user } = renderAdmin(routes, '/admin/support');

    await user.click(await screen.findByRole('button', { name: 'Assign TK-7K3M9Q2X to me' }));
    await waitFor(() => expect(agentTicketApi.assign).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText('TK-7K3M9Q2X is assigned to you.')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status of TK-7K3M9Q2X' }), 'Escalated');
    await waitFor(() => expect(agentTicketApi.changeStatus).toHaveBeenCalledWith('t1', { status: 'ESCALATED' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority of TK-7K3M9Q2X' }), 'High');
    await waitFor(() => expect(agentTicketApi.changeStatus).toHaveBeenCalledWith('t1', { status: 'OPEN', priority: 'HIGH' }));
  });

  it('filters the queue (kept in the URL)', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(pageOf([]));
    const { user, router } = renderAdmin(routes, '/admin/support');
    await screen.findByText('No tickets found');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Assigned' }), 'Unassigned');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'High');

    await waitFor(() => expect(agentTicketApi.queue).toHaveBeenLastCalledWith(expect.objectContaining({ assigned: 'UNASSIGNED', priority: 'HIGH', page: 0 }), 25));
    expect(currentLocation(router)).toBe('/admin/support?assigned=UNASSIGNED&priority=HIGH');
  });

  it('tells why an action failed, with the support reference', async () => {
    vi.mocked(agentTicketApi.queue).mockResolvedValue(pageOf([ticket()]));
    vi.mocked(agentTicketApi.assign).mockRejectedValue(new ApiError(409, 'TICKET_CLOSED', 'This ticket is closed.', [], 'corr-12'));
    const { user } = renderAdmin(routes, '/admin/support');

    await user.click(await screen.findByRole('button', { name: 'Assign TK-7K3M9Q2X to me' }));

    expect(await screen.findByText('This ticket is closed.')).toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-12')).toBeInTheDocument();
  });

  it('is closed without SUPPORT_TICKET_MANAGE', () => {
    renderAdmin(routes, '/admin/support', adminWithout('SUPPORT_TICKET_MANAGE'));

    expect(screen.getByRole('heading', { name: "You don't have access to this section" })).toBeInTheDocument();
    expect(agentTicketApi.queue).not.toHaveBeenCalled();
  });
});

describe('AdminSupportPage: export', () => {
  const RAVI = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';

  it('exports the tickets on the page with the agents named, never "You"', async () => {
    const files = stubFileSaving();
    vi.mocked(agentTicketApi.queue).mockResolvedValue(pageOf([
      ticket(),
      ticket({ id: 't2', ticketNumber: 'TK-2', assignedAgentId: fullAdmin.id, assignedToMe: true, priority: 'HIGH', status: 'IN_PROGRESS' }),
      ticket({ id: 't3', ticketNumber: 'TK-3', assignedAgentId: RAVI, category: 'BOOKING', bookingReference: null }),
    ]));
    const { user } = renderAdmin(routes, '/admin/support');
    await screen.findByRole('table', { name: 'Support tickets' });
    await waitFor(() => expect(screen.getAllByText('Ravi Kumar').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Export support tickets' })).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^support-tickets-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await files.blobs[0]!.text()).split('\r\n');
    expect(lines[0]).toBe('"Ticket","Booking reference","Customer","Subject","Category","Priority","Status","Assigned agent","Created","Updated"');
    const date = String.raw`2026-11-0\d \d{2}:\d{2}`;
    expect(lines[1]).toMatch(new RegExp(`^"TK-7K3M9Q2X","HT-7K3M9Q2X","asha@example.com","Refund not received","Refund","Normal","Open","Unassigned",${date},${date}$`));
    expect(lines[2]).toMatch(new RegExp(`^"TK-2","HT-7K3M9Q2X","asha@example.com","Refund not received","Refund","High","In progress","${fullAdmin.firstName} ${fullAdmin.lastName}",`));
    expect(lines[3]).toMatch(/^"TK-3",,"asha@example.com","Refund not received","Booking","Normal","Open","Ravi Kumar",/);
  });

  it('exports every matching ticket through the same queue, with its filters and sort', async () => {
    const files = stubFileSaving();
    const all = [ticket(), ticket({ id: 't2', ticketNumber: 'TK-2' }), ticket({ id: 't3', ticketNumber: 'TK-3' })];
    vi.mocked(agentTicketApi.queue).mockImplementation(async (filters) => pageOf(all.slice(filters.page * 2, filters.page * 2 + 2),
      { page: filters.page, size: 2, totalElements: 3, totalPages: 2 }));
    const { user } = renderAdmin(routes, '/admin/support?status=OPEN&priority=NORMAL&sort=createdAt,desc');
    await screen.findByRole('table', { name: 'Support tickets' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('radio', { name: /All matching rows/ }));
    await user.click(screen.getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    for (const page of [0, 1]) {
      expect(agentTicketApi.queue).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'OPEN', priority: 'NORMAL', sort: 'createdAt,desc', page }), 100);
    }
    expect((await files.blobs[0]!.text()).split('\r\n').filter(Boolean)).toHaveLength(4);
  });
});
