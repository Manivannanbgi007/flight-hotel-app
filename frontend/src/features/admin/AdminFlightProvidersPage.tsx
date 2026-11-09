import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Plane } from 'lucide-react';
import { toast } from 'sonner';

import { ExportMenu } from '@/components/export/ExportMenu';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { controlClass } from '@/components/ui/fieldStyles';
import { EmptyState, ErrorState } from '@/components/ui/StateViews';
import { DemoInventoryBadge } from '@/features/flights/FlightBadges';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import type { ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { ListLoading, PageHeader } from './shared/adminUi';
import { flightProviderApi, type FlightProvider, type HealthStatus } from './flightProviderApi';

const HEALTH: Record<HealthStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  UP: { label: 'Healthy', tone: 'success' },
  DEGRADED: { label: 'Degraded', tone: 'warning' },
  DOWN: { label: 'Down', tone: 'danger' },
  UNKNOWN: { label: 'Not checked yet', tone: 'neutral' },
};

/** The columns of an export (CSV, Excel, PDF): what each provider card shows. Credentials are never part of it. */
const EXPORT_COLUMNS: ExportColumn<FlightProvider>[] = [
  { header: 'Provider', value: (provider) => provider.name },
  { header: 'Code', value: (provider) => provider.code },
  { header: 'Demo inventory', value: (provider) => provider.demo },
  { header: 'Status', value: (provider) => (provider.enabled ? 'Enabled' : 'Disabled') },
  { header: 'Priority', value: (provider) => provider.priority, type: 'integer' },
  { header: 'Health', value: (provider) => HEALTH[provider.healthStatus]?.label ?? provider.healthStatus },
  { header: 'Last checked', value: (provider) => provider.healthCheckedAt, type: 'datetime' },
  { header: 'Timeout (ms)', value: (provider) => provider.timeoutMs, type: 'integer' },
  { header: 'Last error', value: (provider) => provider.lastError, width: 40 },
];

/** Admin: Flight Provider Management. Providers can be switched off, ordered by priority and health-checked. */
export function AdminFlightProvidersPage() {
  const providers = useQuery({ queryKey: queryKeys.admin.flightProviders, queryFn: flightProviderApi.list });
  const enabled = providers.data?.filter((p) => p.enabled).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={<Plane className="size-5" />}
        title="Flight providers"
        description={<>
          Flight search and booking use the enabled providers in priority order. A disabled provider stops showing new flights;
          bookings that are already paid keep being handled by the provider that holds them.
        </>}
        actions={providers.data && providers.data.length > 0 && (
          <ExportMenu title="Flight providers" subtitle="Admin portal" fileName="flight-providers" columns={EXPORT_COLUMNS}
            rows={providers.data} />
        )}
      />
      {providers.data && enabled === 0 && (
        <Alert tone="warning" title="No flight provider is enabled">Customers see "Flight search is temporarily unavailable" until one is switched on.</Alert>
      )}
      {providers.isPending && <ListLoading label="Loading flight providers…" rows={2} />}
      {providers.isError && <ErrorState description={ApiError.from(providers.error).message} onRetry={() => void providers.refetch()} />}
      {providers.data && providers.data.length === 0 && <EmptyState title="No providers configured" description="Flight providers are set up in the flight service's configuration." />}
      <ul className="flex flex-col gap-3 stagger" aria-label="Flight providers">
        {providers.data?.map((provider) => <ProviderRow key={`${provider.code}-${provider.priority}-${provider.enabled}`} provider={provider} />)}
      </ul>
    </div>
  );
}

function ProviderRow({ provider }: { provider: FlightProvider }) {
  const queryClient = useQueryClient();
  const [priority, setPriority] = useState(String(provider.priority));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.flightProviders });
  const fail = (error: unknown) => toast.error(ApiError.from(error).message);

  const update = useMutation({
    mutationFn: (body: { enabled?: boolean; priority?: number }) => flightProviderApi.update(provider.code, body),
    onSuccess: () => { toast.success(`${provider.name} updated`); refresh(); },
    onError: fail,
  });
  const check = useMutation({
    mutationFn: () => flightProviderApi.healthCheck(provider.code),
    onSuccess: refresh,
    onError: fail,
  });
  const health = HEALTH[provider.healthStatus];
  const priorityValue = Number(priority);
  const priorityValid = Number.isInteger(priorityValue) && priorityValue >= 1 && priorityValue <= 99;

  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-role-100">
              <Plane className="size-5" />
            </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">{provider.name}</h2>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{provider.code}</span>
              {provider.demo && <DemoInventoryBadge />}
              <Badge dot tone={provider.enabled ? 'success' : 'neutral'}>{provider.enabled ? 'Enabled' : 'Disabled'}</Badge>
              <Badge tone={health.tone}><Activity className="size-3" aria-hidden="true" /> {health.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Timeout {provider.timeoutMs} ms · {provider.healthCheckedAt ? `checked ${formatDateTime(provider.healthCheckedAt)}` : 'never checked'}
            </p>
            {provider.lastError && <p className="mt-1 text-sm text-danger-600">Last error: {provider.lastError}</p>}
          </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-800">
              Priority
              <input
                inputMode="numeric"
                value={priority}
                onChange={(event) => setPriority(event.target.value.replace(/[^\d]/g, ''))}
                className={cn(controlClass(false), 'w-20')}
                aria-label={`Priority of ${provider.name}`}
              />
            </label>
            <Button variant="secondary" disabled={!priorityValid || priorityValue === provider.priority} loading={update.isPending && update.variables?.priority !== undefined}
              onClick={() => update.mutate({ priority: priorityValue })}>
              Save priority
            </Button>
            <Button variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>Run health check</Button>
            <Button
              variant={provider.enabled ? 'danger' : 'role'}
              loading={update.isPending && update.variables?.enabled !== undefined}
              onClick={() => update.mutate({ enabled: !provider.enabled })}
            >
              {provider.enabled ? 'Disable' : 'Enable'}
            </Button>
          </div>
        </div>
      </Card>
    </li>
  );
}
