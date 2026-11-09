import { screen, waitFor, within } from '@testing-library/react';

import { ApiError } from '@/lib/api/apiError';
import { stubFileSaving } from '@/test/downloads';
import { admin, fakeAuth, renderRoutes } from '@/test/renderRoutes';
import { AdminFlightProvidersPage } from './AdminFlightProvidersPage';
import { flightProviderApi, type FlightProvider } from './flightProviderApi';

vi.mock('./flightProviderApi', () => ({ flightProviderApi: { list: vi.fn(), update: vi.fn(), healthCheck: vi.fn() } }));

const provider = (overrides: Partial<FlightProvider> = {}): FlightProvider => ({
  code: 'DEMO', name: 'Demo airline system', enabled: true, demo: true, priority: 1, timeoutMs: 10000,
  healthStatus: 'UP', healthCheckedAt: '2099-03-01T10:00:00Z', lastError: null, ...overrides,
});

const open = () => renderRoutes([{ path: '/admin/flight-providers', element: <AdminFlightProvidersPage /> }],
  { path: '/admin/flight-providers', auth: fakeAuth({ user: admin }) });

describe('AdminFlightProvidersPage', () => {
  it('lists the providers with their status, health, timeout and the demo label', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider(), provider({ code: 'DUFFEL', name: 'Duffel', enabled: false, demo: false, priority: 2, healthStatus: 'DOWN', lastError: 'Timeout after 10 s' })]);
    open();

    await screen.findAllByRole('listitem');
    const list = screen.getByRole('list', { name: 'Flight providers' });
    const demo = within(list).getAllByRole('listitem')[0]!;
    expect(within(demo).getByText('Demo inventory')).toBeInTheDocument();
    expect(within(demo).getByText('Enabled')).toBeInTheDocument();
    expect(within(demo).getByText('Healthy')).toBeInTheDocument();
    expect(within(demo).getByText(/Timeout 10000 ms/)).toBeInTheDocument();
    const duffel = within(list).getAllByRole('listitem')[1]!;
    expect(within(duffel).getByText('Disabled')).toBeInTheDocument();
    expect(within(duffel).getByText('Down')).toBeInTheDocument();
    expect(within(duffel).getByText('Last error: Timeout after 10 s')).toBeInTheDocument();
    expect(within(duffel).queryByText('Demo inventory')).not.toBeInTheDocument();
  });

  it('switches a provider off and on', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider(), provider({ code: 'DUFFEL', name: 'Duffel', enabled: false, demo: false, priority: 2 })]);
    vi.mocked(flightProviderApi.update).mockResolvedValue(provider());
    const { user } = open();
    await screen.findAllByRole('listitem');
    const list = screen.getByRole('list', { name: 'Flight providers' });

    await user.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(flightProviderApi.update).toHaveBeenCalledWith('DEMO', { enabled: false }));
    await user.click(within(within(list).getAllByRole('listitem')[1]!).getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(flightProviderApi.update).toHaveBeenCalledWith('DUFFEL', { enabled: true }));
  });

  it('changes the priority only to a sensible number', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider()]);
    vi.mocked(flightProviderApi.update).mockResolvedValue(provider({ priority: 3 }));
    const { user } = open();
    const input = await screen.findByLabelText('Priority of Demo airline system');
    const save = screen.getByRole('button', { name: 'Save priority' });

    expect(save).toBeDisabled();
    await user.clear(input);
    expect(save).toBeDisabled();
    await user.type(input, '3');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(flightProviderApi.update).toHaveBeenCalledWith('DEMO', { priority: 3 }));
  });

  it('runs a health check', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider({ healthStatus: 'UNKNOWN', healthCheckedAt: null })]);
    vi.mocked(flightProviderApi.healthCheck).mockResolvedValue(provider());
    const { user } = open();

    expect(await screen.findByText('Not checked yet')).toBeInTheDocument();
    expect(screen.getByText(/never checked/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run health check' }));

    await waitFor(() => expect(flightProviderApi.healthCheck).toHaveBeenCalledWith('DEMO'));
  });

  it('warns when no provider is enabled', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider({ enabled: false })]);
    open();

    expect(await screen.findByText('No flight provider is enabled')).toBeInTheDocument();
  });

  it('shows the reason when a change is refused', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider()]);
    vi.mocked(flightProviderApi.update).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this.'));
    const { user } = open();

    await user.click(await screen.findByRole('button', { name: 'Disable' }));

    expect(await screen.findByText('You are not allowed to do this.')).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    vi.mocked(flightProviderApi.list).mockRejectedValue(new ApiError(500, 'HTTP_500', 'Something went wrong on our side. Please try again later.'));
    open();

    expect(await screen.findByText('Something went wrong on our side. Please try again later.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('AdminFlightProvidersPage: export', () => {
  it('exports every provider (a short list, no pages) as CSV', async () => {
    const files = stubFileSaving();
    vi.mocked(flightProviderApi.list).mockResolvedValue([provider(), provider({ code: 'DUFFEL', name: 'Duffel', enabled: false, demo: false,
      priority: 2, healthStatus: 'DOWN', healthCheckedAt: null, lastError: 'Timeout after 10 s' })]);
    const { user } = open();
    await screen.findByRole('heading', { name: 'Duffel' });

    await user.click(screen.getByRole('button', { name: 'Export' }));
    const panel = screen.getByRole('dialog', { name: 'Export flight providers' });
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: /^CSV/ }));

    await waitFor(() => expect(files.saved).toHaveLength(1));
    expect(files.saved[0]!.fileName).toMatch(/^flight-providers-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = (await files.blobs[0]!.text()).split('\r\n');
    expect(lines[0]).toBe('"Provider","Code","Demo inventory","Status","Priority","Health","Last checked","Timeout (ms)","Last error"');
    expect(lines[1]).toMatch(/^"Demo airline system","DEMO","Yes","Enabled",1,"Healthy",2099-03-01 \d{2}:\d{2},10000,$/);
    expect(lines[2]).toBe('"Duffel","DUFFEL","No","Disabled",2,"Down",,10000,"Timeout after 10 s"');
  });

  it('has nothing to export without providers', async () => {
    vi.mocked(flightProviderApi.list).mockResolvedValue([]);
    open();

    expect(await screen.findByText('No providers configured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });
});
