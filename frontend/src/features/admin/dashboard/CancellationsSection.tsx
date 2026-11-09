import { AlertTriangle, Ban, BedDouble, Percent, Plane, ReceiptIndianRupee, RotateCcw } from 'lucide-react';

import { INTERVAL_LABELS, toStatChange } from '@/components/analytics';
import { AreaChart, ChartCard, DonutChart, formatCount, formatINR, formatPercent, seriesColor } from '@/components/charts';
import { StatCard } from '@/components/ui/StatCard';
import { DashSection } from './dashKit';
import { chartBase } from './dashHelpers';
import type { AdminDashboard } from './dashboardApi';

const RED = 'var(--color-danger-500)';
const ORANGE = 'var(--color-warning-500)';

/**
 * Cancellations, in warning colours. Two figures with two different bases, both written out: the count is the
 * cancellations the hotel or airline confirmed in the range (by the day they were confirmed); the rate is, of the paid
 * bookings created in the range, the share that was cancelled since (cancelled ÷ paid bookings of the range).
 */
export function CancellationsSection({ data }: { data?: AdminDashboard }) {
  const loading = !data;
  const x = data?.cancellations;
  const c = data?.comparison;
  const per = INTERVAL_LABELS[data?.interval ?? 'DAY'].per;
  const money = (value: number) => formatINR(value);
  const icon = (Icon: typeof Ban) => <Icon className="size-5" />;

  return (
    <DashSection
      id="cancellations"
      title="Cancellations"
      description="Cancellations confirmed by the hotel or the airline in the range"
      icon={<Ban />}
      accent="red"
    >
      <ul aria-label="Cancellation figures" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <StatCard className="h-full" label="Cancellations" value={x?.count ?? 0} format={formatCount} loading={loading}
            icon={icon(Ban)} change={toStatChange(c?.cancellations, { upIsGood: false })} footer="Confirmed in the range" />
        </li>
        <li>
          <StatCard className="h-full" label="Cancellation rate" value={x?.rate ?? 0} format={formatPercent} loading={loading}
            icon={icon(Percent)} change={toStatChange(c?.cancellationRate, { kind: 'rate', upIsGood: false })}
            footer={data && <>{formatCount(data.products.all.cancelled)} of {formatCount(data.products.all.bookings)} paid bookings created in the range</>} />
        </li>
        <li>
          <StatCard className="h-full" label="Hotel cancellations" value={x?.hotel ?? 0} format={formatCount} loading={loading}
            icon={icon(BedDouble)} footer={x && <>Rate {formatPercent(x.hotelRate)} of hotel bookings</>} />
        </li>
        <li>
          <StatCard className="h-full" label="Flight cancellations" value={x?.flight ?? 0} format={formatCount} loading={loading}
            icon={icon(Plane)} footer={x && <>Rate {formatPercent(x.flightRate)} of flight bookings</>} />
        </li>
        <li>
          <StatCard className="h-full" label="Cancellation fees kept" value={x?.cancellationFees ?? 0} format={money} loading={loading}
            icon={icon(ReceiptIndianRupee)} footer="Kept from cancelled bookings" />
        </li>
        <li>
          <StatCard className="h-full" label="Refunded for cancellations" value={x?.refundAmount ?? 0} format={money} loading={loading}
            icon={icon(RotateCcw)} footer="Paid back to customers" />
        </li>
      </ul>

      <p className="flex items-start gap-2 rounded-xl bg-warning-50 px-3.5 py-2.5 text-xs text-warning-700 ring-1 ring-inset ring-warning-200">
        <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
        <span>
          The rate is cancelled ÷ paid bookings created in the same range. The count above it is by the day the hotel or
          airline confirmed the cancellation, so the two can differ when bookings are cancelled long after they were made.
        </span>
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ChartCard as="h3" title={`Cancellations ${per}`} description="Confirmed by the hotel or the airline">
          <AreaChart
            {...chartBase(data)}
            loading={loading}
            title={`Cancellations ${per}`}
            valueFormat="count"
            series={[{ key: 'cancellations', label: 'Cancellations', color: RED }]}
            emptyMessage="No cancellations in this period"
            height={260}
          />
        </ChartCard>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <ChartCard as="h3" title="By booking type">
            <DonutChart
              title="Cancellations by booking type"
              valueFormat="count"
              centerLabel="Cancelled"
              height={170}
              loading={loading}
              emptyMessage="No cancellations in this period"
              data={[{ label: 'Hotels', value: x?.hotel ?? 0, color: seriesColor(0) }, { label: 'Flights', value: x?.flight ?? 0, color: seriesColor(1) }]}
            />
          </ChartCard>
          <ChartCard as="h3" title="By who cancelled">
            <DonutChart
              title="Cancellations by who cancelled"
              valueFormat="count"
              centerLabel="Cancelled"
              height={170}
              loading={loading}
              emptyMessage="No cancellations in this period"
              data={[
                { label: 'Customer', value: x?.byInitiator.CUSTOMER ?? 0, color: RED },
                { label: 'Support agent', value: x?.byInitiator.SUPPORT_AGENT ?? 0, color: ORANGE },
                { label: 'Admin', value: x?.byInitiator.ADMIN ?? 0, color: 'var(--color-role-500)' },
                { label: 'Hotel', value: x?.byInitiator.HOTEL ?? 0, color: 'var(--color-info-500)' },
              ]}
            />
          </ChartCard>
        </div>
      </div>
    </DashSection>
  );
}
