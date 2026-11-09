import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Luggage, Plane, ShieldCheck } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { Alert } from '@/components/ui/Alert';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CheckboxField } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatMoney } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { DemoInventoryBadge } from './FlightBadges';
import { flightApi } from './flightApi';
import { baggageLabel, describePassengers } from './flightFormat';
import { FareCountdown, PriceLines, SectionTitle, TripPageLoading, TripProblem } from './TripParts';
import { Itinerary } from './Itinerary';
import { itineraryOfTrip } from './itineraryModel';
import { CABIN_LABELS, type TripOffer } from './types';

/**
 * /flights/trip/:tripOfferId — the re-priced trip (kept 20 minutes): itinerary, baggage, fare rules and the exact
 * price. Selecting a flight does not reserve seats; the seats are held when the booking is submitted.
 */
export function FlightDetailsPage() {
  const { tripOfferId = '' } = useParams();
  const trip = useQuery({
    queryKey: queryKeys.flights.trip(tripOfferId),
    queryFn: () => flightApi.getTrip(tripOfferId),
    retry: false,
    staleTime: Infinity,
  });

  if (trip.isPending) {
    return <TripPageLoading label="Loading the flight…" />;
  }
  if (trip.isError) {
    return <TripProblem error={ApiError.from(trip.error)} onRetry={() => void trip.refetch()} />;
  }
  return <TripSummary trip={trip.data} />;
}

function TripSummary({ trip }: { trip: TripOffer }) {
  const navigate = useNavigate();
  const remaining = useCountdown(trip.expiresAt, 20 * 60);
  const expired = remaining <= 0;
  const [accepted, setAccepted] = useState(false);
  const mustAccept = trip.priceChanged && !accepted;

  return (
    <PageContainer width="xl">
      <Breadcrumbs className="mb-4" items={[{ label: 'Flights', to: '/flights' }, { label: 'Flight details' }]} />
      <PageHeader
        icon={<Plane className="size-5" />}
        eyebrow="Your flight"
        title={trip.title}
        description={`${trip.tripType === 'ROUND_TRIP' ? 'Round trip' : 'One way'} · ${CABIN_LABELS[trip.cabin]} · ${describePassengers(trip.passengers)}`}
        actions={trip.demo ? <DemoInventoryBadge /> : undefined}
      />

      {trip.priceChanged && (
        <div className="mt-6">
          <Alert tone="warning" title="The price changed">
            The fare is now {formatMoney(trip.total, trip.currency, true)}
            {trip.previousTotal !== null && <> (it was {formatMoney(trip.previousTotal, trip.currency, true)} in the search results)</>}.
            Please accept the new price to continue.
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Plane className="size-4" />}>Itinerary</SectionTitle>
            <div className="mt-4"><Itinerary slices={trip.slices.map(itineraryOfTrip)} /></div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Luggage className="size-4" />}>Baggage</SectionTitle>
            <p className="mt-3 text-sm font-medium text-slate-800">{baggageLabel(trip.checkedBaggageKg, trip.cabinBaggageKg)} per passenger</p>
            <p className="mt-1 text-xs text-slate-500">Infants travel on a lap without their own baggage allowance.</p>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<ShieldCheck className="size-4" />}>Fare rules</SectionTitle>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
              {trip.slices.map((slice, index) => (
                <li key={`${slice.flightNumber}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2">
                  <strong>{trip.slices.length > 1 ? (index === 0 ? 'Outbound' : 'Return') : 'Fare'}:</strong> {slice.fare.name} ·{' '}
                  {slice.fare.refundable ? 'Refundable' : 'Non-refundable'} · {slice.fare.cancellationPolicy}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-slate-700">{trip.cancellationPolicy}</p>
            <p className="mt-2 text-xs text-slate-500">Date changes and rebooking are not available for this fare.</p>
          </Card>
        </div>

        <Card variant="elevated" className="h-fit p-5 sm:p-6 lg:sticky lg:top-24">
          <h2 className="text-base font-bold text-slate-900">Price details</h2>
          <PriceLines lines={trip.priceLines} total={trip.total} currency={trip.currency} />
          <FareCountdown remaining={remaining} />
          <p className="mt-2 text-xs text-slate-500">Seats are not reserved yet. They are held when you confirm the booking.</p>
          {trip.priceChanged && (
            <div className="mt-4">
              <CheckboxField label={`I accept the new price of ${formatMoney(trip.total, trip.currency, true)}`} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            </div>
          )}
          <Button className="mt-5 w-full" size="lg" disabled={expired || mustAccept} onClick={() => void navigate(`/book/flight/${trip.tripOfferId}`)}>
            Continue to passenger details
          </Button>
          <Link to="/flights" className="mt-3 block rounded-md text-center text-sm font-semibold text-brand-700 hover:underline">
            {expired ? 'Search again' : 'Search other flights'}
          </Link>
        </Card>
      </div>
    </PageContainer>
  );
}
