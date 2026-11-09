import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Lock, Mail, Pencil, Plane, ShieldCheck, Ticket, Users } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CheckboxField } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { bookingApi } from '@/features/bookings/bookingApi';
import { BookingSteps } from '@/features/bookings/BookingParts';
import { newIdempotencyKey } from '@/features/bookings/bookingDraft';
import type { CreateFlightBookingBody } from '@/features/bookings/types';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { useCountdown } from '@/lib/useCountdown';
import { DemoInventoryBadge } from './FlightBadges';
import { clearFlightDraft, loadFlightDraft, recallPassportNumbers, saveFlightDraft, type FlightDraft } from './flightDraft';
import { flightApi } from './flightApi';
import { baggageLabel, describePassengers } from './flightFormat';
import { Itinerary } from './Itinerary';
import { itineraryOfTrip } from './itineraryModel';
import { passengerLabel, passengerSlots } from './passengerSchema';
import { FareCountdown, PriceLines, SectionTitle, TripPageLoading, TripProblem } from './TripParts';
import type { TripOffer } from './types';

/**
 * /book/flight/:tripOfferId/review — step 2: everything the customer entered next to the price, then "Confirm and
 * continue to payment". The server re-prices when the seats are held; this page only shows the trip offer.
 */
export function FlightReviewPage() {
  const { tripOfferId = '' } = useParams();
  // Read once: after the booking is made the draft is deleted, and that must not send the customer back to step 1.
  const [draft] = useState(() => loadFlightDraft(tripOfferId));
  const [passports] = useState(() => recallPassportNumbers(tripOfferId));
  const trip = useQuery({
    queryKey: queryKeys.flights.trip(tripOfferId),
    queryFn: () => flightApi.getTrip(tripOfferId),
    retry: false,
    staleTime: Infinity,
  });

  if (!draft) {
    return <Navigate to={`/book/flight/${tripOfferId}`} replace />;
  }
  if (trip.isPending) {
    return <TripPageLoading label="Loading your booking…" />;
  }
  if (trip.isError) {
    return <TripProblem error={ApiError.from(trip.error)} onRetry={() => void trip.refetch()} />;
  }
  // Passport numbers are never stored in the browser: after a reload they must be typed again.
  if (trip.data.international && draft.passengers.some((_, index) => !passports[index])) {
    return <Navigate to={`/book/flight/${tripOfferId}`} replace />;
  }
  return <Review trip={trip.data} draft={draft} passports={passports} />;
}

function Review({ trip, draft, passports }: { trip: TripOffer; draft: FlightDraft; passports: string[] }) {
  const navigate = useNavigate();
  const remaining = useCountdown(trip.expiresAt, 20 * 60);
  const expired = remaining <= 0;
  const [accepted, setAccepted] = useState(false);
  const [showAcceptError, setShowAcceptError] = useState(false);
  const keyRef = useRef(draft.idempotencyKey);
  const types = passengerSlots(trip.passengers);

  const book = useMutation({
    mutationFn: () => {
      // The key is made once, kept here and in the draft: a retry (timeout, reload) returns the same booking.
      const key = keyRef.current ?? newIdempotencyKey();
      if (!keyRef.current) {
        keyRef.current = key;
        saveFlightDraft({ ...draft, idempotencyKey: key });
      }
      const body: CreateFlightBookingBody = {
        tripOfferId: trip.tripOfferId,
        contact: draft.contact,
        passengers: draft.passengers.map((p, index) => ({
          passengerType: p.passengerType,
          firstName: p.firstName,
          lastName: p.lastName,
          ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}),
          ...(p.gender ? { gender: p.gender } : {}),
          ...(p.nationality ? { nationality: p.nationality } : {}),
          ...(trip.international && passports[index] ? { passportNumber: passports[index] } : {}),
          ...(trip.international && p.passportExpiry ? { passportExpiry: p.passportExpiry } : {}),
          ...(trip.international && p.passportCountry ? { passportCountry: p.passportCountry } : {}),
        })),
        ...(draft.couponCode ? { couponCode: draft.couponCode } : {}),
      };
      return bookingApi.createFlightBooking(body, key);
    },
    onSuccess: (booking) => {
      clearFlightDraft(trip.tripOfferId);
      void navigate(`/my-trips/${booking.id}/pay`);
    },
  });

  const confirm = () => {
    if (!accepted) {
      setShowAcceptError(true);
      return;
    }
    book.mutate();
  };


  const error = book.error ? ApiError.from(book.error) : null;
  return (
    <PageContainer width="xl">
      <BookingSteps current={2} type="FLIGHT" />
      <PageHeader className="mt-6" title="Review your booking" description="Check the flights, the travellers and the rules. You pay on the next step." />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SectionTitle icon={<Plane className="size-4" />}>{trip.title}</SectionTitle>
              {trip.demo && <DemoInventoryBadge />}
            </div>
            <Itinerary slices={trip.slices.map(itineraryOfTrip)} />
            <p className="mt-4 text-sm text-slate-600">{baggageLabel(trip.checkedBaggageKg, trip.cabinBaggageKg)} per passenger</p>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle icon={<Users className="size-4" />}>Passengers and contact</SectionTitle>
              <Link to={`/book/flight/${trip.tripOfferId}`} className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand-700 hover:underline">
                <Pencil className="size-3.5" aria-hidden="true" /> Edit
              </Link>
            </div>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-slate-800">
              {draft.passengers.map((p, index) => (
                <li key={index} className="rounded-xl bg-slate-50 px-3 py-2">
                  {passengerLabel(types, index)}: {p.firstName} {p.lastName}
                  {trip.international && passports[index] ? ` · passport ••••${passports[index].slice(-4)}` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <Mail className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
              {draft.contact.email} · {draft.contact.phone}
            </p>
            {draft.couponCode && (
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <Ticket className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                Coupon: <strong className="text-slate-900">{draft.couponCode}</strong> (applied to the final price)
              </p>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<ShieldCheck className="size-4" />}>Cancellation</SectionTitle>
            <p className="mt-3 text-sm text-slate-700">{trip.cancellationPolicy}</p>
          </Card>

          <Card variant="tinted" className="p-4 sm:p-5">
            <CheckboxField
              checked={accepted}
              onChange={(event) => { setAccepted(event.target.checked); setShowAcceptError(false); }}
              label="I accept the fare rules, the cancellation policy and the terms of this booking."
              error={showAcceptError ? 'Please accept to continue' : undefined}
            />
          </Card>
          {error && (
            <Alert tone="danger" title="We could not start your booking">
              {error.message}
              {error.correlationId && <span className="block text-xs">Support reference: {error.correlationId}</span>}
            </Alert>
          )}
        </div>

        <Card variant="elevated" className="h-fit p-5 sm:p-6 lg:sticky lg:top-24">
          <h2 className="text-base font-bold text-slate-900">Price details</h2>
          <p className="text-xs text-slate-500">{describePassengers(trip.passengers)}</p>
          <PriceLines lines={trip.priceLines} total={trip.total} currency={trip.currency} />
          {draft.couponCode && <p className="mt-2 text-xs text-slate-500">Your coupon is taken off when the seats are held.</p>}
          <FareCountdown remaining={remaining} />
          <Button size="lg" className="mt-5 w-full" loading={book.isPending} disabled={expired} onClick={confirm}>
            Confirm and continue to payment
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
            <Lock className="size-3.5" aria-hidden="true" /> You pay on the next step. Nothing is charged yet.
          </p>
        </Card>
      </div>
    </PageContainer>
  );
}
