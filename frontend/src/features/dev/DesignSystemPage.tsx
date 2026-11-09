import { useState, type ComponentType } from 'react';
import { BedDouble, CalendarCheck, IndianRupee, Plane, Users } from 'lucide-react';

import { AreaChart, BarChart, ChartCard, DonutChart, LineChart, Sparkline, formatINR } from '@/components/charts';
import * as Illustrations from '@/components/illustrations';
import { Reveal } from '@/components/motion/Reveal';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, Td, Th, Tr } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { DateField } from '@/components/ui/DateField';
import { CheckboxField, PasswordField, SelectField, TextField } from '@/components/ui/Field';
import { radioClass } from '@/components/ui/fieldStyles';
import { PageHeader, Section } from '@/components/ui/PageHeader';
import { StarRatingInput } from '@/components/ui/StarRatingInput';
import { StatCard } from '@/components/ui/StatCard';
import { SuggestField } from '@/components/ui/SuggestField';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { Stepper } from '@/components/ui/Stepper';
import { Switch } from '@/components/ui/Switch';
import { Tabs } from '@/components/ui/Tabs';
import { TimeField } from '@/components/ui/TimeField';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';

/*
 * Component gallery, development builds only (`/dev/design-system`, see app/router.tsx). The figures below are made-up
 * SAMPLE values that only show what the components look like: never copy them into a page. Real pages take every
 * number from the API.
 */

const SAMPLE_DAYS = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
const sampleRows = SAMPLE_DAYS.map((date, index) => ({
  date,
  hotel: [3, 5, 4, 7, 6, 9, 8][index] ?? 0,
  flight: [2, 2, 5, 4, 6, 5, 7][index] ?? 0,
  revenue: [42000, 61500, 58000, 93500, 87000, 124000, 118500][index] ?? 0,
  refunds: [0, 4500, 0, 12000, 3000, 0, 9500][index] ?? 0,
}));

const swatches: { name: string; steps: string[] }[] = [
  { name: 'brand', steps: ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] },
  { name: 'accent', steps: ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] },
  { name: 'success', steps: ['50', '100', '200', '500', '600', '700'] },
  { name: 'warning', steps: ['50', '100', '200', '500', '600', '700'] },
  { name: 'danger', steps: ['50', '100', '200', '500', '600', '700'] },
  { name: 'info', steps: ['50', '100', '200', '500', '600', '700'] },
];

const illustrationEntries = (Object.entries(Illustrations) as [string, unknown][])
  .filter(([name, value]) => name.endsWith('Illustration') && typeof value === 'function')
  .map(([name, value]) => [name, value as ComponentType<{ className?: string }>] as const);

export function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [rating, setRating] = useState(4);
  const [stay, setStay] = useState({ checkIn: '2026-12-12', checkOut: '2026-12-15' });
  const [birthDate, setBirthDate] = useState('1990-04-12');
  const [filterFrom, setFilterFrom] = useState('');
  const [time, setTime] = useState('14:00');
  const [city, setCity] = useState('');
  const [dialogDate, setDialogDate] = useState('');
  const [refund, setRefund] = useState('card');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Design system v2"
        title="Component gallery"
        description="Development builds only. Every figure on this page is a made-up sample that shows the component; pages take theirs from the API."
      />

      <Section id="ds-colors" title="Colours">
        <div className="grid gap-4">
          {swatches.map(({ name, steps }) => (
            <div key={name}>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">{name}</p>
              <div className="flex flex-wrap gap-2">
                {steps.map((step) => (
                  <span key={step} className="flex w-16 flex-col items-center gap-1 text-xs text-slate-600">
                    <span className="h-10 w-full rounded-lg ring-1 ring-slate-900/5" style={{ background: `var(--color-${name}-${step})` }} />
                    {step}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            {(['role-admin', 'role-manager', 'role-support'] as const).map((role) => (
              <span key={role} className={cn(role, 'rounded-xl bg-role-600 px-4 py-2 text-sm font-semibold text-white')}>{role}</span>
            ))}
            {['bg-gradient-sky', 'bg-gradient-ocean', 'bg-gradient-sunset', 'bg-gradient-dusk'].map((gradient) => (
              <span key={gradient} className={cn(gradient, 'flex h-10 w-36 items-center justify-center rounded-xl text-xs font-semibold text-slate-900 ring-1 ring-slate-900/5')}>
                <span className="rounded bg-white/80 px-1.5">{gradient}</span>
              </span>
            ))}
          </div>
        </div>
      </Section>

      <Section id="ds-controls" title="Buttons, badges, alerts">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button size="sm" variant="secondary">Small</Button>
          <Button size="lg">Large</Button>
          <Tooltip content="Opens a dialog"><Button variant="secondary" onClick={() => setDialogOpen(true)}>Open dialog</Button></Tooltip>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['neutral', 'info', 'success', 'warning', 'danger', 'brand', 'accent'] as const).map((tone) => <Badge key={tone} tone={tone} dot>{tone}</Badge>)}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Alert tone="info" title="Info">Prices include taxes.</Alert>
          <Alert tone="success" title="Success">Booking confirmed.</Alert>
          <Alert tone="warning" title="Warning">The hold ends soon.</Alert>
          <Alert tone="danger" title="Danger">The payment failed.</Alert>
        </div>
      </Section>

      <Section id="ds-forms" title="Form fields and inputs">
        <Card className="grid gap-4 p-6 md:grid-cols-2">
          <TextField label="Email" type="email" placeholder="you@example.com" hint="We send the tickets here" />
          <PasswordField label="Password" error="Enter your password" />
          <SelectField label="Cabin" optional><option>Economy</option><option>Business</option></SelectField>
          <div className="flex flex-col gap-4">
            <CheckboxField label="Keep me logged in" />
            <div className="flex items-center gap-3"><Switch aria-label="E-mail updates" checked={switchOn} onCheckedChange={setSwitchOn} /> <span className="text-sm">E-mail updates</span></div>
            <StarRatingInput name="ds-rating" label="Your rating" value={rating} onChange={setRating} />
          </div>
        </Card>
      </Section>

      <Section id="ds-pickers" title="Date, time and choice pickers" description="SAMPLE values; the calendar and lists open on click or with ↓.">
        <Card className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-4">
          <DateField label="Check-in" months={2} min="2026-11-06" value={stay.checkIn} rangeEnd={stay.checkOut}
            onChange={(checkIn) => setStay((current) => ({ ...current, checkIn }))} />
          <DateField label="Check-out" months={2} min={stay.checkIn || '2026-11-06'} value={stay.checkOut} rangeStart={stay.checkIn}
            onChange={(checkOut) => setStay((current) => ({ ...current, checkOut }))} />
          <DateField label="Date of birth" max="2026-11-06" value={birthDate} onChange={setBirthDate} />
          <DateField label="From" optional value={filterFrom} onChange={setFilterFrom} hint="Type 25/12/2026 or pick a day" />
          <TimeField label="Check-in from" value={time} onChange={setTime} />
          <SuggestField label="Destination" placeholder="City" value={city} onChange={setCity}
            suggestions={city ? ['Goa', 'Gangtok', 'Gurugram'].filter((c) => c.toLowerCase().startsWith(city.toLowerCase())).map((value) => ({ value, description: 'Sample city' })) : []} />
          <SelectField label="Date range">
            <optgroup label="Days"><option>Last 7 days</option><option>Last 30 days</option></optgroup>
            <optgroup label="Months"><option>This month</option><option>Last 12 months</option></optgroup>
            <option disabled>Custom dates (unavailable)</option>
          </SelectField>
          <SelectField label="Travel class" disabled><option>Economy</option></SelectField>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-slate-800">Refund to</legend>
            {[['card', 'Original card'], ['wallet', 'Wallet'], ['none', 'No refund (disabled)']].map(([value, text]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" name="ds-refund" className={radioClass} value={value} checked={refund === value}
                  disabled={value === 'none'} onChange={() => setRefund(value!)} />
                {text}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <CheckboxField label="Free cancellation" defaultChecked />
            <CheckboxField label="Breakfast included" />
            <CheckboxField label="Accept the terms" error="Accept the terms to continue" />
          </div>
        </Card>
      </Section>

      <Section id="ds-kpis" title="KPI cards" description="StatCard with trend chip and sparkline slot.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Bookings" value={1284} icon={<CalendarCheck className="size-5" />} change={{ percent: 12.5, period: 'vs last month' }}
            sparkline={<Sparkline values={[4, 6, 5, 8, 7, 10, 12]} />} />
          <StatCard label="Revenue" value={2_45_000} format={(value) => formatINR(value)} icon={<IndianRupee className="size-5" />}
            change={{ percent: -3.2, period: 'vs last month' }} />
          <StatCard label="Cancellations" value={18} icon={<BedDouble className="size-5" />} change={{ percent: 4, period: 'vs last month', upIsGood: false }} />
          <StatCard label="New customers" value={0} icon={<Users className="size-5" />} loading />
        </div>
      </Section>

      <Section id="ds-charts" title="Chart kit" description="Lazy-loaded recharts with legend, tooltip, table view, loading and empty states.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Revenue per day" description="Sample values">
            <LineChart title="Revenue per day" data={sampleRows} xKey="date" xFormat="DAY" valueFormat="inr"
              series={[{ key: 'revenue', label: 'Revenue' }, { key: 'refunds', label: 'Refunds' }]} />
          </ChartCard>
          <ChartCard title="Bookings per day (stacked)" description="Sample values">
            <BarChart title="Bookings per day" data={sampleRows} xKey="date" xFormat="DAY" valueFormat="count" stacked
              series={[{ key: 'hotel', label: 'Hotels' }, { key: 'flight', label: 'Flights' }]} />
          </ChartCard>
          <ChartCard title="Bookings per day (grouped)" description="Sample values">
            <BarChart title="Bookings per day, grouped" data={sampleRows} xKey="date" xFormat="DAY" valueFormat="count"
              series={[{ key: 'hotel', label: 'Hotels' }, { key: 'flight', label: 'Flights' }]} />
          </ChartCard>
          <ChartCard title="Revenue (area)" description="Sample values">
            <AreaChart title="Revenue, area" data={sampleRows} xKey="date" xFormat="DAY" valueFormat="inr" series={[{ key: 'revenue', label: 'Revenue' }]} />
          </ChartCard>
          <ChartCard title="Cancellations by type" description="Sample values">
            <DonutChart title="Cancellations by type" valueFormat="count" centerLabel="Cancelled"
              data={[{ label: 'By customer', value: 12 }, { label: 'By hotel', value: 4 }, { label: 'Payment expired', value: 7 }]} />
          </ChartCard>
          <ChartCard title="States">
            <div className="grid gap-4 sm:grid-cols-2">
              <BarChart title="Loading chart" data={[]} xKey="date" series={[{ key: 'hotel', label: 'Hotels' }]} height={160} loading />
              <LineChart title="Empty chart" data={[]} xKey="date" series={[{ key: 'hotel', label: 'Hotels' }]} height={160} />
            </div>
          </ChartCard>
        </div>
      </Section>

      <Section id="ds-nav" title="Tabs, stepper, avatars">
        <Tabs label="Sample tabs" items={[
          { id: 'one', label: 'Upcoming', badge: 2, content: <p className="text-sm text-slate-600">Upcoming trips panel.</p> },
          { id: 'two', label: 'Completed', content: <p className="text-sm text-slate-600">Completed trips panel.</p> },
          { id: 'three', label: 'Cancelled', content: <p className="text-sm text-slate-600">Cancelled trips panel.</p> },
        ]} />
        <Tabs label="Sample pill tabs" variant="pills" items={[
          { id: 'day', label: 'Day', content: null }, { id: 'week', label: 'Week', content: null }, { id: 'month', label: 'Month', content: null },
        ]} />
        <Card className="p-6"><Stepper label="Booking steps" current={1} steps={[
          { label: 'Choose', description: 'Flight or room' }, { label: 'Guest details', description: 'Who travels' },
          { label: 'Review', description: 'Check everything' }, { label: 'Pay', description: 'Secure payment' },
        ]} /></Card>
        <div className="flex items-center gap-3">
          <Avatar name="Asha Rao" size="lg" status="online" />
          <Avatar name="Hari Manager" size="md" />
          <Avatar name="Sam Agent" size="sm" />
          <div className="flex -space-x-2">{['Ira Sen', 'Ravi K', 'Meera P'].map((name) => <Avatar key={name} name={name} ring />)}</div>
        </div>
      </Section>

      <Section id="ds-states" title="State views">
        <div className="grid gap-4 lg:grid-cols-3">
          <EmptyState title="No trips yet" description="Your bookings appear here." action={<Button size="sm">Find a hotel</Button>} />
          <EmptyState illustration="search" title="No results" description="Try other dates." />
          <ErrorState description="The server did not answer." correlationId="sample-ref" onRetry={() => undefined} />
        </div>
        <LoadingState rows={2} />
      </Section>

      <Section id="ds-table" title="Data table">
        <DataTable caption="Sample bookings" head={<><Th>Reference</Th><Th>Guest</Th><Th numeric>Amount</Th><Th>Status</Th></>}>
          {sampleRows.slice(0, 3).map((row, index) => (
            <Tr key={row.date}>
              <Td primary>SAMPLE-{index + 1}</Td>
              <Td>Sample guest</Td>
              <Td numeric>{formatINR(row.revenue)}</Td>
              <Td><Badge tone={index === 1 ? 'warning' : 'success'} dot>{index === 1 ? 'Pending' : 'Confirmed'}</Badge></Td>
            </Tr>
          ))}
        </DataTable>
      </Section>

      <Section id="ds-illustrations" title="Illustrations">
        <div className="grid grid-cols-2 gap-4 stagger sm:grid-cols-3 lg:grid-cols-4">
          {illustrationEntries.map(([name, Drawing]) => (
            <Card key={name} interactive className="flex flex-col items-center gap-2 p-4">
              <Drawing className={cn('w-full', name.includes('SignIn') && 'rounded-2xl bg-slate-900')} />
              <p className="text-xs font-semibold text-slate-600">{name}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Reveal>
        <Card variant="tinted" className="p-6">
          <CardHeader title="Reveal on scroll" description="This card fades in when it enters the viewport." actions={<Plane className="size-5 text-brand-600" aria-hidden="true" />} />
        </Card>
      </Reveal>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Sample dialog" description="Focus stays inside; Escape closes.">
        <div className="mb-4">
          <DateField label="Valid until" value={dialogDate} onChange={setDialogDate} hint="The calendar opens above the dialog." />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
        </div>
      </Dialog>
    </div>
  );
}
