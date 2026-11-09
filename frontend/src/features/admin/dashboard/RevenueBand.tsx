import { Luggage, Percent } from 'lucide-react';

import { HighlightFigure, HighlightPanel, rateChange, toStatChange } from '@/components/analytics';
import { formatCount, formatINR, formatPercent, Sparkline } from '@/components/charts';
import { StatCard } from '@/components/ui/StatCard';
import type { AdminDashboard } from './dashboardApi';

const money = (value: number) => formatINR(value);

/**
 * The headline band: revenue (net, gross and refunds, each against the previous period) beside the two figures an admin
 * looks at first, paid bookings and the payment success rate. `data` undefined = loading (skeletons).
 */
export function RevenueBand({ data }: { data?: AdminDashboard }) {
  const loading = !data;
  const c = data?.comparison;
  const net = (data?.series ?? []).map((point) => point.net);
  const bookingSpark = (data?.series ?? []).map((point) => point.bookings);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <HighlightPanel
        title="Revenue"
        description="Money captured in the range, and what is left after refunds"
        className="xl:col-span-2"
        aside={net.length > 1 && net.some((value) => value !== 0)
          ? <span className="hidden sm:block"><Sparkline values={net} width={180} height={72} color="#ffffff" /></span>
          : undefined}
      >
        <div className="flex flex-col gap-6">
          <HighlightFigure size="lg" label="Net revenue" value={data?.revenue.net ?? 0} format={money} loading={loading}
            change={toStatChange(c?.netRevenue)} note="Gross minus refunds" />
          <div className="grid gap-6 border-t border-white/15 pt-5 sm:grid-cols-2">
            <HighlightFigure label="Gross revenue" value={data?.revenue.gross ?? 0} format={money} loading={loading}
              change={toStatChange(c?.grossRevenue)} note="Captured payments" />
            <HighlightFigure label="Refunds" value={data?.revenue.refunds ?? 0} format={money} loading={loading}
              change={toStatChange(c?.refunds, { upIsGood: false })} note="Refunds completed" />
          </div>
        </div>
      </HighlightPanel>
      <ul aria-label="Headline figures" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <li>
          <StatCard className="h-full" label="Paid bookings" value={data?.products.all.bookings ?? 0} format={formatCount} loading={loading}
            icon={<Luggage className="size-5" />} change={toStatChange(c?.bookings)}
            sparkline={bookingSpark.length > 1 && bookingSpark.some((value) => value > 0) ? <Sparkline values={bookingSpark} width={96} height={32} /> : undefined}
            footer="Hotels and flights created in the range" />
        </li>
        <li>
          <StatCard className="h-full" label="Payment success rate" value={data?.payments.successRate ?? 0} format={formatPercent} loading={loading}
            icon={<Percent className="size-5" />}
            change={data ? toStatChange(rateChange(c?.successfulPayments, c?.failedPayments, data.payments.successRate), { kind: 'rate' }) : undefined}
            footer="Successful of all payment attempts" />
        </li>
      </ul>
    </div>
  );
}
