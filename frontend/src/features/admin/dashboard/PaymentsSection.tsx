import { useState } from 'react';
import { CheckCircle2, Clock3, CreditCard, Percent, RotateCcw, Wallet, XCircle } from 'lucide-react';

import { INTERVAL_LABELS, SegmentedControl, rateChange, toStatChange } from '@/components/analytics';
import { AreaChart, BarChart, ChartCard, formatCount, formatINR, formatPercent } from '@/components/charts';
import { StatCard } from '@/components/ui/StatCard';
import { DashSection, ViewAll } from './dashKit';
import { chartBase } from './dashHelpers';
import { RecentPayments } from './DashboardRecent';
import type { AdminDashboard } from './dashboardApi';

type View = 'amount' | 'attempts';

const GREEN = 'var(--color-success-500)';
const RED = 'var(--color-danger-500)';
const INDIGO = 'var(--color-role-500)';

/**
 * Payments, each figure for what it is: money collected (captured payments), refunds (money paid back), payment
 * attempts that succeeded or failed, and bookings still waiting for payment (money due, not collected). Pending money
 * is never part of the revenue.
 */
export function PaymentsSection({ data }: { data?: AdminDashboard }) {
  const [view, setView] = useState<View>('amount');
  const loading = !data;
  const payments = data?.payments;
  const c = data?.comparison;
  const per = INTERVAL_LABELS[data?.interval ?? 'DAY'].per;
  const money = (value: number) => formatINR(value);
  const icon = (Icon: typeof Wallet) => <Icon className="size-5" />;

  return (
    <DashSection
      id="payments"
      title="Payments"
      description="Money collected and payment attempts in the range"
      icon={<CreditCard />}
      accent="green"
      action={<ViewAll to="/admin/payments" label="All payments" permission="PAYMENT_READ_ANY" />}
    >
      <ul aria-label="Payment figures" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <StatCard className="h-full" label="Collected revenue" value={data?.revenue.gross ?? 0} format={money} loading={loading}
            icon={icon(Wallet)} change={toStatChange(c?.grossRevenue)} footer="Captured payments, before refunds" />
        </li>
        <li>
          <StatCard className="h-full" label="Successful payments" value={payments?.successfulCount ?? 0} format={formatCount} loading={loading}
            icon={icon(CheckCircle2)} change={toStatChange(c?.successfulPayments)}
            footer={payments && <>{money(payments.successfulAmount)} captured</>} />
        </li>
        <li>
          <StatCard className="h-full" label="Failed payments" value={payments?.failedCount ?? 0} format={formatCount} loading={loading}
            icon={icon(XCircle)} change={toStatChange(c?.failedPayments, { upIsGood: false })}
            footer={payments && <>{money(payments.failedAmount)} not collected</>} />
        </li>
        <li>
          <StatCard className="h-full" label="Pending payments" value={payments?.pendingCount ?? 0} format={formatCount} loading={loading}
            icon={icon(Clock3)} footer={payments && <>{money(payments.pendingAmount)} due, not collected yet</>} />
        </li>
        <li>
          <StatCard className="h-full" label="Refunded" value={data?.revenue.refunds ?? 0} format={money} loading={loading}
            icon={icon(RotateCcw)} change={toStatChange(c?.refunds, { upIsGood: false })} footer="Paid back to customers" />
        </li>
        <li>
          <StatCard className="h-full" label="Payment success rate" value={payments?.successRate ?? 0} format={formatPercent} loading={loading}
            icon={icon(Percent)}
            change={data ? toStatChange(rateChange(c?.successfulPayments, c?.failedPayments, data.payments.successRate), { kind: 'rate' }) : undefined}
            footer="Successful of all payment attempts" />
        </li>
      </ul>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ChartCard
          as="h3"
          title={view === 'amount' ? `Revenue ${per}` : `Payment attempts ${per}`}
          description={view === 'amount' ? 'Collected, and what is left after refunds' : 'Successful and failed attempts'}
          actions={(
            <SegmentedControl<View>
              legend="Payment chart"
              legendHidden
              size="sm"
              value={view}
              onChange={setView}
              options={[{ value: 'amount', label: 'Amount' }, { value: 'attempts', label: 'Attempts' }]}
            />
          )}
        >
          {view === 'amount' ? (
            <AreaChart
              {...chartBase(data)}
              loading={loading}
              title={`Collected and net revenue ${per}`}
              valueFormat="inr"
              series={[{ key: 'gross', label: 'Collected', color: GREEN }, { key: 'net', label: 'After refunds', color: INDIGO }]}
              emptyMessage="No payments in this period"
              height={260}
            />
          ) : (
            <BarChart
              {...chartBase(data)}
              loading={loading}
              title={`Payment attempts ${per}`}
              valueFormat="count"
              series={[{ key: 'successfulPayments', label: 'Successful', color: GREEN }, { key: 'failedPayments', label: 'Failed', color: RED }]}
              emptyMessage="No payment attempts in this period"
              height={260}
            />
          )}
        </ChartCard>
        <RecentPayments />
      </div>
    </DashSection>
  );
}
