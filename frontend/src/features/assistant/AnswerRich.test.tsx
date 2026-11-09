import { screen, waitFor, within } from '@testing-library/react';

import type { AuthUser } from '@/lib/auth/types';
import { currentLocation, customer, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { AnswerActions } from './AnswerActions';
import { AnswerBlocks } from './AnswerBlocks';
import { toActions, toBlocks } from './blocks';
import { applyEvent, fromConversation, type AssistantMessage } from './chatReducer';
import { toChatEvent } from './chatStream';

vi.mock('@/features/hotel-manager/managerApi', () => ({ managerApi: { myHotels: vi.fn() } }));

const manager: AuthUser = { ...customer, id: 'm1', roles: ['HOTEL_MANAGER'] };

const trips = toBlocks([{
  type: 'BOOKINGS', title: 'Your trips', summary: '1 booking', total: 1, empty: null, tone: null,
  items: [{
    title: 'Sea Breeze Resort', subtitle: 'Goa', badge: 'Confirmed', tone: 'success',
    fields: [{ label: 'Reference', value: 'HT-7K3M9Q2X', kind: 'text' }, { label: 'From', value: '2026-12-01', kind: 'date' },
      { label: 'Total', value: '₹18,900', kind: 'money' }],
  }],
}]);

const open = (ui: React.ReactElement, user: AuthUser = customer, path = '/') => renderRoutes([
  { path: '/', element: ui },
  { path: '/my-trips', element: <p>my trips page</p> },
  { path: '/account/payments', element: <p>payments page</p> },
  { path: '*', element: <p>elsewhere</p> },
], { path, auth: fakeAuth({ user }) });

describe('answer cards', () => {
  it('shows a booking with the backend\'s values and a status badge', () => {
    open(<AnswerBlocks blocks={trips} />);

    const card = screen.getByRole('region', { name: 'Your trips' });
    expect(within(card).getByText('Sea Breeze Resort')).toBeInTheDocument();
    expect(within(card).getByText('Confirmed')).toBeInTheDocument();
    expect(within(card).getByText('HT-7K3M9Q2X')).toBeInTheDocument();
    expect(within(card).getByText('₹18,900')).toBeInTheDocument();
    expect(within(card).getByText('1 Dec 2026')).toBeInTheDocument();
  });

  it('says "no matching records" for an empty result instead of an empty card', () => {
    const blocks = toBlocks([{ type: 'PAYMENTS', title: 'Your payments', total: 0, empty: 'No matching payments were found.', items: [] }]);
    open(<AnswerBlocks blocks={blocks} />);

    expect(screen.getByRole('status')).toHaveTextContent('No matching payments were found.');
  });

  it('shows figures, steps, tables and notices', () => {
    const blocks = toBlocks([
      { type: 'METRICS', title: 'Ticket summary', metrics: [{ label: 'Open', value: '0', kind: 'text' }, { label: 'In progress', value: '3', kind: 'text' }] },
      { type: 'STEPS', title: 'Update your profile', steps: ['Open My Profile.', 'Save the changes.'] },
      { type: 'TABLE', title: 'Revenue', columns: ['Day', 'Revenue'], rows: [['Mon', '₹1,000']], metrics: [{ label: 'Total', value: '₹1,000', kind: 'money' }] },
      { type: 'NOTICE', title: 'Temporarily unavailable', summary: 'Please try again later.', tone: 'warning' },
    ]);
    open(<AnswerBlocks blocks={blocks} />);

    // A zero is shown as 0, not left out.
    expect(within(screen.getByRole('region', { name: 'Ticket summary' })).getByText('Open').nextSibling).toHaveTextContent('0');
    expect(screen.getByRole('list', { name: 'Update your profile' })).toHaveTextContent('Open My Profile.');
    expect(screen.getByRole('table', { name: 'Revenue' })).toHaveTextContent('₹1,000');
    expect(screen.getByRole('alert')).toHaveTextContent('Temporarily unavailable');
  });

  it('renders text as text: no HTML, no links', () => {
    const blocks = toBlocks([{ type: 'NOTIFICATIONS', title: 'Notifications', items: [{
      title: '<img src=x onerror=alert(1)>', subtitle: '<a href="https://evil.example">click</a>', tone: 'neutral', fields: [],
    }] }]);
    const { container } = open(<AnswerBlocks blocks={blocks} />);

    expect(container.querySelector('img, a')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('drops card types it does not know and reads malformed data safely', () => {
    expect(toBlocks([{ type: 'SCRIPT', title: 'x' }, null, 'text', { type: 'METRICS', title: 5, metrics: 'bad' }])).toHaveLength(1);
    expect(toActions([{ route: '' }, { label: 'x' }, { route: 'PAYMENTS' }])).toEqual([
      { route: 'PAYMENTS', label: 'PAYMENTS', icon: '', hotel: null, query: null }]);
  });
});

describe('answer buttons', () => {
  it('opens the page with the router, without leaving the app', async () => {
    const actions = toActions([{ route: 'MY_TRIPS', label: 'View My Trips', icon: 'luggage' }, { route: 'PAYMENTS', label: 'View All Payments', icon: 'wallet' }]);
    const onNavigate = vi.fn();
    const { user, router } = open(<AnswerActions actions={actions} onNavigate={onNavigate} />);

    await user.click(screen.getByRole('button', { name: /View All Payments/ }));

    expect(currentLocation(router)).toBe('/account/payments');
    expect(screen.getByText('payments page')).toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows no button for a page the user may not open or that is not on the list', () => {
    const actions = toActions([{ route: 'ADMIN_DASHBOARD', label: 'Admin Dashboard' }, { route: 'https://evil.example', label: 'Click' }]);
    open(<AnswerActions actions={actions} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives a manager the page of their own hotel (the id comes from their hotel list)', async () => {
    const { managerApi } = await import('@/features/hotel-manager/managerApi');
    vi.mocked(managerApi.myHotels).mockResolvedValue([
      { id: 'h-2', name: 'Hill View Inn' }, { id: 'h-1', name: 'Sea Breeze Resort' },
    ] as Awaited<ReturnType<typeof managerApi.myHotels>>);
    const actions = toActions([{ route: 'HOTEL_RESERVATIONS', label: 'View Reservations', icon: 'clipboard-list', hotel: 'Sea Breeze Resort' }]);
    const { user, router } = open(<AnswerActions actions={actions} />, manager);

    await user.click(await screen.findByRole('button', { name: /View Reservations/ }));

    await waitFor(() => expect(currentLocation(router)).toBe('/hotel-manager/hotels/h-1/reservations'));
  });
});

describe('cards and buttons in the conversation state', () => {
  const answer = (): AssistantMessage => ({
    id: 'a1', role: 'assistant', question: 'q', text: '', status: 'streaming', statusText: null, sources: [], blocks: [], actions: [],
    grounded: true, error: null,
  });

  it('the stream\'s blocks event fills the answer; a saved conversation brings them back', () => {
    const event = toChatEvent({ event: 'blocks', data: JSON.stringify({
      blocks: [{ type: 'PAYMENTS', title: 'Your payments', items: [] }], actions: [{ route: 'PAYMENTS', label: 'View All Payments', icon: 'wallet' }],
    }) })!;
    const next = applyEvent(answer(), event);

    expect(next.blocks).toHaveLength(1);
    expect(next.actions[0]).toMatchObject({ route: 'PAYMENTS' });

    const restored = fromConversation([
      { id: 'u', role: 'user', text: 'q', createdAt: '', sources: [], grounded: true },
      { id: 'a', role: 'assistant', text: 'ok', createdAt: '', sources: [], grounded: true, blocks: next.blocks, actions: next.actions },
      { id: 'b', role: 'assistant', text: 'old answer, saved before cards existed', createdAt: '', sources: [], grounded: true },
    ]);
    expect(restored[1]).toMatchObject({ blocks: [{ type: 'PAYMENTS' }], actions: [{ route: 'PAYMENTS' }] });
    expect(restored[2]).toMatchObject({ blocks: [], actions: [] });
  });
});
