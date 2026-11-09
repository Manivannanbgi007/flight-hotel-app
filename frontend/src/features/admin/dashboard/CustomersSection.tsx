import { useState } from 'react';
import { UserCheck, UserPlus, Users, UsersRound } from 'lucide-react';

import { SegmentedControl, toStatChange } from '@/components/analytics';
import { AreaChart, ChartCard, formatCount, formatPercent, Sparkline } from '@/components/charts';
import { StatCard } from '@/components/ui/StatCard';
import { INTERVAL_LABELS } from '@/components/analytics';
import { DashSection, ViewAll } from './dashKit';
import { chartBase, share } from './dashHelpers';
import { RecentCustomers } from './DashboardRecent';
import type { AdminDashboard } from './dashboardApi';

type View = 'total' | 'new';

/**
 * Customers: how many accounts there are, how many joined in the range, how many of them booked (active), the growth
 * over time, and the newest registrations. "Total" at the end of each point is the registered customers then: the
 * total at the end of the range minus everyone who joined after that point, so it always ends at the total above.
 */
export function CustomersSection({ data }: { data?: AdminDashboard }) {
  const [view, setView] = useState<View>('total');
  const loading = !data;
  const customers = data?.customers;
  const c = data?.comparison;
  const per = INTERVAL_LABELS[data?.interval ?? 'DAY'].per;

  // Registered customers at the end of each point of the series (the last point equals `customers.total`).
  const rows = (() => {
    if (!data) return [];
    let after = 0;
    const totals = [...data.series].reverse().map((point) => {
      const total = data.customers.total - after;
      after += point.newCustomers;
      return total;
    }).reverse();
    return data.series.map((point, index) => ({ ...point, registered: totals[index] }));
  })();
  const newSpark = (data?.series ?? []).map((point) => point.newCustomers);

  return (
    <DashSection
      id="customers"
      title="Customers"
      description="Accounts, growth and who joined lately"
      icon={<Users />}
      accent="purple"
      action={<ViewAll to="/admin/users?role=CUSTOMER" label="All customers" permission="USER_READ_ANY" />}
    >
      <ul aria-label="Customer figures" className="stagger grid gap-4 sm:grid-cols-3">
        <li>
          <StatCard className="h-full" label="Registered customers" value={customers?.total ?? 0} format={formatCount} loading={loading}
            icon={<UsersRound className="size-5" />} footer="Registered by the end of the range" />
        </li>
        <li>
          <StatCard className="h-full" label="New customers" value={customers?.newInRange ?? 0} format={formatCount} loading={loading}
            icon={<UserPlus className="size-5" />} change={toStatChange(c?.newCustomers)}
            sparkline={newSpark.length > 1 && newSpark.some((value) => value > 0) ? <Sparkline values={newSpark} width={96} height={32} /> : undefined} />
        </li>
        <li>
          <StatCard className="h-full" label="Active customers" value={customers?.active ?? 0} format={formatCount} loading={loading}
            icon={<UserCheck className="size-5" />}
            footer={customers && customers.total > 0 ? `${formatPercent(share(customers.active, customers.total))} of registered booked in the range` : 'Booked at least once in the range'} />
        </li>
      </ul>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ChartCard
          as="h3"
          title={view === 'total' ? 'Customer growth' : `New customers ${per}`}
          description={view === 'total' ? 'Registered customers at the end of each point' : 'Accounts registered in each point'}
          actions={(
            <SegmentedControl<View>
              legend="Customer chart"
              legendHidden
              size="sm"
              value={view}
              onChange={setView}
              options={[{ value: 'total', label: 'Total' }, { value: 'new', label: 'New' }]}
            />
          )}
        >
          <AreaChart
            {...chartBase(data)}
            data={rows}
            loading={loading}
            title={view === 'total' ? 'Registered customers over time' : `New customers ${per}`}
            valueFormat="count"
            series={view === 'total'
              ? [{ key: 'registered', label: 'Registered customers', color: 'var(--color-role-500)', level: true }]
              : [{ key: 'newCustomers', label: 'New customers', color: 'var(--color-role-500)' }]}
            emptyMessage="No customers in this period"
            height={260}
          />
        </ChartCard>
        <RecentCustomers />
      </div>
    </DashSection>
  );
}
