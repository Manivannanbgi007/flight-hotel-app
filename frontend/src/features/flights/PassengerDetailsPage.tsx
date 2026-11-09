import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, Baby, Mail, PersonStanding, Plane, Ticket, User } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { PageContainer } from '@/components/layout/PageContainer';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateField } from '@/components/ui/DateField';
import { SelectField, TextField } from '@/components/ui/Field';
import { selectClass } from '@/components/ui/fieldStyles';
import { PageHeader } from '@/components/ui/PageHeader';
import { todayIso } from '@/features/account/schemas';
import type { Passenger } from '@/features/account/types';
import { usePassengers, useProfile } from '@/features/account/useAccount';
import { bookingApi } from '@/features/bookings/bookingApi';
import { BookingSteps } from '@/features/bookings/BookingParts';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { cn } from '@/lib/cn';
import { countries } from '@/lib/countries';
import { formatMoney, formatShortDate } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { DemoInventoryBadge } from './FlightBadges';
import { flightApi } from './flightApi';
import { dateOf, describePassengers, timeOf } from './flightFormat';
import { loadFlightDraft, recallPassportNumbers, rememberPassportNumbers, saveFlightDraft } from './flightDraft';
import { flightPassengersSchema, passengerLabel, passengerSlots, type FlightPassengersForm } from './passengerSchema';
import { FareCountdown, SectionTitle, TripPageLoading, TripProblem } from './TripParts';
import type { TripOffer } from './types';

/** /book/flight/:tripOfferId — step 1: who travels, how the airline reaches the customer, optional coupon. */
export function PassengerDetailsPage() {
  const { tripOfferId = '' } = useParams();
  const trip = useQuery({
    queryKey: queryKeys.flights.trip(tripOfferId),
    queryFn: () => flightApi.getTrip(tripOfferId),
    retry: false,
    staleTime: Infinity,
  });

  if (trip.isPending) {
    return <TripPageLoading label="Loading your trip…" />;
  }
  if (trip.isError) {
    return <TripProblem error={ApiError.from(trip.error)} onRetry={() => void trip.refetch()} />;
  }
  return <PassengerForm trip={trip.data} />;
}

const GENDERS = [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' }];

const TRAVELLER_KIND = {
  ADULT: { icon: User, note: '12 years or older' },
  CHILD: { icon: PersonStanding, note: 'Aged 2 to 11' },
  INFANT: { icon: Baby, note: 'Under 2, travels on an adult’s lap' },
} as const;

function PassengerForm({ trip }: { trip: TripOffer }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const profile = useProfile();
  const saved = usePassengers();
  const remaining = useCountdown(trip.expiresAt, 20 * 60);
  const expired = remaining <= 0;
  const types = useMemo(() => passengerSlots(trip.passengers), [trip.passengers]);
  const firstSlice = trip.slices[0];
  const lastSlice = trip.slices[trip.slices.length - 1];
  const schema = useMemo(() => flightPassengersSchema({
    international: trip.international,
    firstDeparture: firstSlice ? dateOf(firstSlice.departureLocal) : todayIso(),
    lastDeparture: lastSlice ? dateOf(lastSlice.departureLocal) : todayIso(),
  }), [trip.international, firstSlice, lastSlice]);
  const [draft] = useState(() => loadFlightDraft(trip.tripOfferId));
  const [passports] = useState(() => recallPassportNumbers(trip.tripOfferId));
  const [hints, setHints] = useState<Record<number, string>>({});
  const [couponResult, setCouponResult] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const { register, handleSubmit, control, getValues, setValue, formState: { errors } } = useForm<FlightPassengersForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      passengers: types.map((type, index) => ({
        passengerType: type,
        firstName: draft?.passengers[index]?.firstName ?? (index === 0 ? (user?.firstName ?? '') : ''),
        lastName: draft?.passengers[index]?.lastName ?? (index === 0 ? (user?.lastName ?? '') : ''),
        dateOfBirth: draft?.passengers[index]?.dateOfBirth ?? '',
        gender: draft?.passengers[index]?.gender ?? '',
        nationality: draft?.passengers[index]?.nationality ?? '',
        passportNumber: passports[index] ?? '',
        passportExpiry: draft?.passengers[index]?.passportExpiry ?? '',
        passportCountry: draft?.passengers[index]?.passportCountry ?? '',
      })),
      contactEmail: draft?.contact.email ?? user?.email ?? '',
      contactPhone: draft?.contact.phone ?? '',
      couponCode: draft?.couponCode ?? '',
    },
  });
  const { fields } = useFieldArray({ control, name: 'passengers' });

  // The phone number from the profile, once, when it has loaded and the customer has not typed one.
  const savedPhone = profile.data?.phone;
  const phoneFilled = useRef(false);
  useEffect(() => {
    if (savedPhone && !phoneFilled.current) {
      phoneFilled.current = true;
      if (!getValues('contactPhone')) setValue('contactPhone', savedPhone);
    }
  }, [savedPhone, getValues, setValue]);

  const fillFromSaved = (index: number, id: string) => {
    const person = saved.data?.find((p) => p.id === id);
    if (!person) return;
    setValue(`passengers.${index}.firstName`, person.firstName, { shouldValidate: true });
    setValue(`passengers.${index}.lastName`, person.lastName, { shouldValidate: true });
    setValue(`passengers.${index}.dateOfBirth`, person.dateOfBirth ?? '');
    setValue(`passengers.${index}.gender`, person.gender ?? '');
    setValue(`passengers.${index}.nationality`, person.nationality ?? '');
    setValue(`passengers.${index}.passportExpiry`, person.passportExpiry ?? '');
    setValue(`passengers.${index}.passportCountry`, person.passportCountry ?? '');
    setValue(`passengers.${index}.passportNumber`, '');
    setHints((current) => ({
      ...current,
      [index]: person.hasPassport ? `Saved passport ${person.passportNumberMasked ?? ''}: please type the number again, it is never shown in full.` : '',
    }));
  };

  const coupon = useMutation({
    mutationFn: (code: string) => bookingApi.checkCoupon({ code, bookingType: 'FLIGHT', amount: trip.total }),
    onSuccess: (result) =>
      setCouponResult({ tone: 'success', message: `${result.title}: you save ${formatMoney(result.discount, result.currency, true)} (the final amount is confirmed when the seats are held).` }),
    onError: (error) => setCouponResult({ tone: 'danger', message: ApiError.from(error).message }),
  });

  const onSubmit = (form: FlightPassengersForm) => {
    const numbers = form.passengers.map((p) => (trip.international ? p.passportNumber.toUpperCase() : ''));
    rememberPassportNumbers(trip.tripOfferId, numbers);
    saveFlightDraft({
      tripOfferId: trip.tripOfferId,
      contact: { email: form.contactEmail, phone: form.contactPhone },
      passengers: form.passengers.map((p) => ({ passengerType: p.passengerType, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, gender: p.gender, nationality: p.nationality, passportExpiry: p.passportExpiry, passportCountry: p.passportCountry })),
      couponCode: form.couponCode.toUpperCase(),
    });
    void navigate(`/book/flight/${trip.tripOfferId}/review`);
  };

  const checkCoupon = () => {
    const code = getValues('couponCode').trim();
    if (code) {
      setCouponResult(null);
      coupon.mutate(code);
    }
  };

  return (
    <PageContainer width="xl">
      <BookingSteps current={1} type="FLIGHT" />
      <PageHeader
        className="mt-6"
        title="Passenger details"
        description={`Enter the names exactly as on each traveller’s ID${trip.international ? ' and passport' : ''}.`}
      />
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {fields.map((field, index) => {
            const type = types[index] ?? 'ADULT';
            const kind = TRAVELLER_KIND[type];
            const Icon = kind.icon;
            const candidates = (saved.data ?? []).filter((p: Passenger) => p.passengerType === type);
            const e = errors.passengers?.[index];
            return (
              <Card key={field.id} className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">{passengerLabel(types, index)}</h2>
                      <p className="text-xs text-slate-500">{kind.note}</p>
                    </div>
                  </div>
                  {candidates.length > 0 && (
                    <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
                      Use a saved passenger
                      <select
                        aria-label={`Saved passenger for ${passengerLabel(types, index)}`}
                        className={cn(selectClass(false, { inline: true, size: 'sm' }), 'min-w-40')}
                        defaultValue=""
                        onChange={(event) => fillFromSaved(index, event.target.value)}
                      >
                        <option value="">Choose…</option>
                        {candidates.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <TextField label="First name" autoComplete={index === 0 ? 'given-name' : 'off'} error={e?.firstName?.message} {...register(`passengers.${index}.firstName`)} />
                  <TextField label="Last name" autoComplete={index === 0 ? 'family-name' : 'off'} error={e?.lastName?.message} {...register(`passengers.${index}.lastName`)} />
                  <Controller
                    control={control}
                    name={`passengers.${index}.dateOfBirth`}
                    render={({ field: dateOfBirth }) => (
                      <DateField
                        label="Date of birth"
                        max={todayIso()}
                        optional={type === 'ADULT'}
                        hint={type === 'CHILD' ? 'Age 2–11 on the travel date' : type === 'INFANT' ? 'Under 2 on every flight' : undefined}
                        error={e?.dateOfBirth?.message}
                        {...dateOfBirth}
                      />
                    )}
                  />
                  <SelectField label="Gender" optional error={e?.gender?.message} {...register(`passengers.${index}.gender`)}>
                    <option value="">Prefer not to say</option>
                    {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </SelectField>
                  <SelectField label="Nationality" optional {...register(`passengers.${index}.nationality`)}>
                    <option value="">Choose…</option>
                    {countries().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </SelectField>
                </div>
                {trip.international && (
                  <fieldset className="mt-5 grid gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-3">
                    <legend className="px-1 text-sm font-semibold text-slate-800">Passport (needed for international travel)</legend>
                    <TextField label="Passport number" autoComplete="off" hint={hints[index] || undefined} error={e?.passportNumber?.message} {...register(`passengers.${index}.passportNumber`)} />
                    <Controller
                      control={control}
                      name={`passengers.${index}.passportExpiry`}
                      render={({ field: expiry }) => (
                        <DateField label="Passport expiry" min={todayIso()} error={e?.passportExpiry?.message} {...expiry} />
                      )}
                    />
                    <SelectField label="Issuing country" error={e?.passportCountry?.message} {...register(`passengers.${index}.passportCountry`)}>
                      <option value="">Choose…</option>
                      {countries().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </SelectField>
                  </fieldset>
                )}
              </Card>
            );
          })}

          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Mail className="size-4" />}>Contact for the booking</SectionTitle>
            <p className="mt-1.5 text-sm text-slate-600">We send the e-ticket here, and the airline may call this number about changes.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Email" type="email" autoComplete="email" error={errors.contactEmail?.message} {...register('contactEmail')} />
              <TextField label="Phone" type="tel" autoComplete="tel" hint="With country code, for example +91 98000 00000" error={errors.contactPhone?.message} {...register('contactPhone')} />
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionTitle icon={<Ticket className="size-4" />}>Coupon</SectionTitle>
            <div className="mt-4 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Coupon code" optional autoComplete="off" error={errors.couponCode?.message} {...register('couponCode', { onChange: () => setCouponResult(null) })} />
              </div>
              <Button type="button" variant="secondary" className="mt-7" loading={coupon.isPending} onClick={checkCoupon}>Check</Button>
            </div>
            {couponResult && <Alert tone={couponResult.tone} className="mt-3">{couponResult.message}</Alert>}
          </Card>
        </div>

        <Card variant="elevated" className="h-fit overflow-hidden lg:sticky lg:top-24">
          <div className="bg-gradient-sky px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle icon={<Plane className="size-4" />}>{trip.title}</SectionTitle>
              {trip.demo && <DemoInventoryBadge />}
            </div>
            <p className="mt-1.5 text-sm text-slate-700">{trip.tripType === 'ROUND_TRIP' ? 'Round trip' : 'One way'} · {describePassengers(trip.passengers)}</p>
          </div>
          <div className="p-5 sm:p-6">
            <ul className="flex flex-col gap-2 text-sm" aria-label="Flights in this trip">
              {trip.slices.map((slice, index) => (
                <li key={`${slice.flightNumber}-${index}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                    {slice.origin.iataCode} <ArrowRight className="size-3.5 text-brand-600" aria-hidden="true" /> {slice.destination.iataCode}
                  </span>
                  <span className="text-slate-600">{formatShortDate(dateOf(slice.departureLocal))} · {timeOf(slice.departureLocal)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-4 text-slate-900">
              <span className="text-base font-bold">Total</span>
              <span className="text-xl font-bold tracking-tight">{formatMoney(trip.total, trip.currency, true)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">Including taxes and fees. Coupons are applied when the seats are held.</p>
            <FareCountdown remaining={remaining} />
            <Button type="submit" size="lg" className="mt-5 w-full" disabled={expired}>Review booking</Button>
            <Link to={`/flights/trip/${trip.tripOfferId}`} className="mt-3 block rounded-md text-center text-sm font-semibold text-brand-700 hover:underline">
              Back to flight details
            </Link>
          </div>
        </Card>
      </form>
    </PageContainer>
  );
}
