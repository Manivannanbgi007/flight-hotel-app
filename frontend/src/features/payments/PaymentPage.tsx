import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { BedDouble, CreditCard, Headset, Landmark, Lock, Mail, Plane, RotateCcw, ShieldCheck, Smartphone } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { LostIllustration, PaymentFailedIllustration, StormIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/StateViews';
import { BookingSteps, PriceBreakdown } from '@/features/bookings/BookingParts';
import { Art, BookingPageSkeleton, WaitingRing } from '@/features/bookings/BookingUi';
import { HoldTimer, SecureSeal, StayCover, StayTimeline } from '@/features/bookings/CheckoutParts';
import { FlightSummaryLines } from '@/features/bookings/FlightParts';
import { failureAdvice, isDeadEnd } from '@/features/bookings/status';
import type { BookingDetails } from '@/features/bookings/types';
import { useBookingDetails } from '@/features/bookings/useBookingDetails';
import { usePublicSettings } from '@/features/settings/usePublicSettings';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatMoney } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { createOrderWhenReady } from './createOrderWhenReady';
import { DemoCheckout } from './DemoCheckout';
import { paymentApi } from './paymentApi';
import { loadRazorpay, toPaise } from './razorpay';
import type { CheckoutCallback, PaymentOrder } from './types';

/** /my-trips/:bookingId/pay — step 3: pay for a held room (or held seats). The amount always comes from the server. */
export function PaymentPage() {
  const { bookingId = '' } = useParams();
  const booking = useBookingDetails(bookingId);

  if (booking.isPending) {
    return <PageContainer width="lg"><BookingPageSkeleton label="Loading your booking…" /></PageContainer>;
  }
  if (booking.isError) {
    const error = ApiError.from(booking.error);
    return (
      <PageContainer width="md">
        <div className="mx-auto max-w-xl">
          <ErrorState title={error.status === 404 ? 'Booking not found' : undefined} description={error.message}
            illustration={<Art>{error.status === 404 ? <LostIllustration /> : <StormIllustration />}</Art>}
            onRetry={error.status === 404 ? undefined : () => void booking.refetch()} />
          <p className="mt-4 text-center"><Link to="/my-trips" className="font-semibold text-role-700 hover:underline">My Trips</Link></p>
        </div>
      </PageContainer>
    );
  }
  const data = booking.data;
  if (data.status === 'INITIATED') {
    return <HoldingRoom type={data.type} />;
  }
  if (isDeadEnd(data.status)) {
    return <NotBooked booking={data} />;
  }
  if (data.status !== 'PENDING_PAYMENT') {
    return <Navigate to={`/my-trips/${data.id}/result`} replace />;
  }
  return <PayPanel booking={data} />;
}

/** INITIATED: the hotel (airline) is holding the room (seats). A turning ring, soft rings and a moving bar while we wait. */
function HoldingRoom({ type }: { type: 'HOTEL' | 'FLIGHT' }) {
  const flight = type === 'FLIGHT';
  return (
    <PageContainer width="md">
      <div
        className="relative isolate mx-auto flex max-w-xl flex-col items-center overflow-hidden rounded-3xl border border-slate-200/80 bg-white px-6 py-12 text-center shadow-card animate-scale-in"
        role="status"
        aria-live="polite"
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-48 bg-gradient-to-b from-role-50 to-transparent" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-48 bg-grid-light" />
        <span aria-hidden="true" className="relative flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-role-200/60 opacity-0 animate-halo" />
          <span className="absolute inset-0 rounded-full bg-role-200/60 opacity-0 animate-halo [animation-delay:1.2s]" />
          <WaitingRing>{flight ? <Plane aria-hidden="true" /> : <BedDouble aria-hidden="true" />}</WaitingRing>
        </span>
        <h1 className="mt-7 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{flight ? 'Securing your seats…' : 'Securing your room…'}</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          {flight
            ? 'We are holding the seats at the fare you saw and checking it with the airline. This takes a few seconds. Please do not close this page.'
            : 'We are holding the room at the price you saw and checking it with the hotel. This takes a few seconds. Please do not close this page.'}
        </p>
        <span aria-hidden="true" className="mt-7 block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-role-100">
          <span className="block h-full w-2/5 rounded-full bg-gradient-to-r from-role-400 to-role-600 animate-indeterminate" />
        </span>
      </div>
    </PageContainer>
  );
}

/** The hotel or airline could not hold the room or seats (sold out, price changed, ...), or the time to pay ran out. */
export function NotBooked({ booking }: { booking: BookingDetails }) {
  const slug = booking.hotel?.hotelSlug;
  const flight = booking.type === 'FLIGHT';
  return (
    <PageContainer width="md">
      <Card className="mx-auto flex max-w-xl flex-col items-center px-6 py-10 text-center">
        <Art><PaymentFailedIllustration /></Art>
        <Alert
          className="mt-6 w-full text-left"
          tone={booking.status === 'EXPIRED' ? 'warning' : 'danger'}
          title={booking.status === 'EXPIRED' ? 'This booking expired' : flight ? 'We could not book this flight' : 'We could not book this room'}
        >
          <p>{booking.failureMessage ?? failureAdvice(booking.failureReason, booking.type)}</p>
          <p className="mt-1">{failureAdvice(booking.failureReason, booking.type)}</p>
          <p className="mt-1 font-semibold">Nothing was charged.</p>
        </Alert>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {flight && <ButtonLink to="/flights">Search flights</ButtonLink>}
          {slug && <ButtonLink to={`/hotels/${slug}`}>Choose another room</ButtonLink>}
          {!flight && <ButtonLink to="/hotels" variant="secondary">Search hotels</ButtonLink>}
          <ButtonLink to="/my-trips" variant="ghost">My Trips</ButtonLink>
        </div>
      </Card>
    </PageContainer>
  );
}

function PayPanel({ booking }: { booking: BookingDetails }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { settings } = usePublicSettings();
  const remaining = useCountdown(booking.paymentDeadline);
  const expired = remaining <= 0;
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.detail(booking.id) });
    void navigate(`/my-trips/${booking.id}/result`);
  };

  const verify = useMutation({
    mutationFn: (callback: CheckoutCallback) => paymentApi.verify(callback),
    onSuccess: (result) => {
      setBusy(false);
      if (result.status === 'FAILED') {
        setOrder(null);
        setNotice({ tone: 'danger', text: result.failureMessage ?? 'Your payment did not go through. You can try again.' });
        return;
      }
      finish();
    },
    onError: (error) => {
      setBusy(false);
      setNotice({ tone: 'danger', text: ApiError.from(error).message });
    },
  });

  const failed = useMutation({
    mutationFn: (callback: { orderId: string; paymentId: string }) => paymentApi.reportFailure(callback.orderId, callback.paymentId),
    onSettled: () => {
      setBusy(false);
      setOrder(null);
      setNotice({ tone: 'danger', text: 'Your payment did not go through. No money was taken. You can try again.' });
    },
  });

  const openRazorpay = async (paymentOrder: PaymentOrder) => {
    const Razorpay = await loadRazorpay();
    const checkout = new Razorpay({
      key: paymentOrder.keyId ?? '',
      amount: toPaise(paymentOrder.amount),
      currency: paymentOrder.currency,
      name: settings.siteName,
      description: paymentOrder.description,
      order_id: paymentOrder.orderId,
      prefill: { email: paymentOrder.contactEmail },
      // The brand colour (brand-600): the provider's window cannot read our CSS tokens.
      theme: { color: '#1f5ce8' },
      handler: (response) =>
        verify.mutate({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }),
      modal: { ondismiss: () => setBusy(false) },
    });
    checkout.on('payment.failed', (failure) => {
      const paymentId = failure.error.metadata?.payment_id;
      if (paymentId) {
        failed.mutate({ orderId: paymentOrder.orderId, paymentId });
      }
    });
    checkout.open();
  };

  const start = useMutation({
    // A new key for every attempt: the server returns the same order while one is still open (double click, two tabs).
    mutationFn: () => createOrderWhenReady(booking.id),
    onSuccess: async (created) => {
      setOrder(created);
      if (created.provider === 'RAZORPAY') {
        try {
          await openRazorpay(created);
        } catch {
          setBusy(false);
          setNotice({ tone: 'danger', text: 'The payment window could not be opened. Check your connection or ad blocker and try again.' });
        }
      } else {
        setBusy(false);
      }
    },
    onError: (error) => {
      setBusy(false);
      setNotice({ tone: 'danger', text: ApiError.from(error).message });
    },
  });

  const pay = () => {
    setNotice(null);
    setBusy(true);
    start.mutate();
  };

  const hotel = booking.hotel;
  const flight = booking.type === 'FLIGHT';
  const supplier = flight ? 'airline' : 'hotel';
  const held = flight ? 'seats are' : 'room is';
  const holdSeconds = booking.paymentDeadline
    ? Math.round((new Date(booking.paymentDeadline).getTime() - new Date(booking.createdAt).getTime()) / 1000) || 15 * 60
    : 15 * 60;
  // What is happening right now, under the button (announced politely).
  const progress = verify.isPending
    ? 'Checking your payment…'
    : start.isPending
      ? 'Preparing your secure payment…'
      : busy && order?.provider === 'RAZORPAY'
        ? 'Complete the payment in the secure window.'
        : null;

  return (
    <PageContainer width="lg">
      <BookingSteps current={3} type={booking.type} />
      <PageHeader className="mt-6" icon={<Lock className="size-5" />} title="Payment" description="One last step: pay securely to confirm your booking." />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        {/* 1. Checkout: the amount, the time left and the Pay button. */}
        <Card className="min-w-0 overflow-hidden animate-fade-up lg:col-start-1 lg:row-start-1">
          <div className="relative isolate overflow-hidden bg-[linear-gradient(120deg,var(--role-950),var(--role-800)_38%,var(--role-600)_72%,var(--role-800))] bg-[length:220%_220%] px-5 py-6 text-white animate-gradient-pan sm:px-7 sm:py-7">
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid-faint" />
            <div aria-hidden="true" className="absolute -right-16 -top-24 -z-10 size-72 rounded-full bg-role-400/30 blur-3xl" />
            <div aria-hidden="true" className="absolute -bottom-24 left-1/4 -z-10 size-56 rounded-full bg-accent-400/15 blur-3xl" />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                  <Lock className="size-4" aria-hidden="true" />
                  Pay securely
                </h2>
                <p className="mt-4 text-sm font-medium text-white/90">Amount to pay</p>
                <p className="mt-0.5 text-[2.125rem] font-bold leading-tight tracking-tight tabular-nums sm:text-[2.5rem]">
                  {formatMoney(booking.totalAmount, booking.currency, true)}
                </p>
              </div>
              <SecureSeal className="mt-1 hidden sm:flex" />
            </div>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/90">
              {flight ? 'Your seats are held for you.' : 'Your room is held for you.'} Pay now to confirm the booking.
            </p>
          </div>

          <div className="p-5 sm:p-7">
            <HoldTimer
              remaining={remaining}
              total={holdSeconds}
              label="Pay within"
              deadline={booking.paymentDeadline}
              note={`After that the ${held} released.`}
              expiredText={`The time to pay is over. The ${held} being released.`}
              expiredNote="Nothing was charged."
            />
            {booking.paymentStatus === 'PAYMENT_FAILED' && !notice && (
              <Alert tone="warning" className="mt-4" title="Your last payment did not go through">
                No money was taken. You can try again.
              </Alert>
            )}
            {notice && <Alert tone={notice.tone} className="mt-4 animate-scale-in">{notice.text}</Alert>}
            {booking.couponNote && <Alert tone="warning" className="mt-4" title="Coupon not applied">{booking.couponNote}</Alert>}

            {order?.provider === 'DEMO' ? (
              <DemoCheckout
                order={order}
                disabled={verify.isPending || failed.isPending || expired}
                onCallback={(callback) => { setBusy(true); verify.mutate(callback); }}
                onFailure={(callback) => { setBusy(true); failed.mutate(callback); }}
                onError={(message) => setNotice({ tone: 'danger', text: message })}
              />
            ) : (
              <>
                <div className="mt-5">
                  <p id="pay-methods" className="text-xs font-semibold uppercase tracking-wider text-slate-600">Ways to pay</p>
                  <ul aria-labelledby="pay-methods" className="mt-2 flex flex-wrap gap-2 stagger">
                    <PayMethod icon={<CreditCard />}>Cards</PayMethod>
                    <PayMethod icon={<Smartphone />}>UPI</PayMethod>
                    <PayMethod icon={<Landmark />}>Net banking</PayMethod>
                  </ul>
                </div>
                <Button size="lg" className="sheen-sweep mt-6 h-14 w-full text-lg shadow-glow" loading={busy} disabled={expired} onClick={pay}>
                  <Lock className="size-[1.125rem]" aria-hidden="true" />
                  Pay {formatMoney(booking.totalAmount, booking.currency, true)}
                </Button>
              </>
            )}
            <p role="status" className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-role-700 empty:hidden">
              {progress && (
                <>
                  <span aria-hidden="true" className="flex gap-1">
                    {[0, 150, 300].map((delay) => (
                      <span key={delay} className="size-1.5 rounded-full bg-role-600 animate-typing" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </span>
                  {progress}
                </>
              )}
            </p>
            <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-600">
              <ShieldCheck className="size-4 shrink-0 text-success-600" aria-hidden="true" />
              Card, UPI and bank details are entered with the payment provider and never reach our servers.
            </p>
          </div>
        </Card>

        {/* 2. What is being paid for (on the right from laptop width, staying in view; second on phones). */}
        <Card className="h-fit min-w-0 overflow-hidden animate-fade-up [animation-delay:120ms] lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {hotel ? (
            <StayCover slug={hotel.hotelSlug} size="sm">
              <div className="py-5 pl-5">
                <p className="text-xs font-bold uppercase tracking-wider text-white">Your stay</p>
                <h2 className="mt-1 text-lg font-bold tracking-tight text-white">{booking.title ?? hotel.hotelName ?? 'Your stay'}</h2>
                {(hotel.city ?? booking.destination) && <p className="mt-0.5 text-sm text-white">{hotel.city ?? booking.destination}</p>}
              </div>
            </StayCover>
          ) : (
            <div className="relative isolate overflow-hidden bg-[linear-gradient(130deg,var(--role-950),var(--role-700)_60%,var(--role-500))] p-5 text-white">
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-grid-faint" />
              <Plane aria-hidden="true" className="absolute -right-3 top-3 -z-10 size-24 -rotate-12 text-white/15 animate-float" />
              <p className="text-xs font-bold uppercase tracking-wider text-white">{flight ? 'Your flight' : 'Your stay'}</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight text-white">{booking.title ?? (flight ? 'Your flight' : 'Your stay')}</h2>
            </div>
          )}
          <div className="p-5">
            {booking.flight && <FlightSummaryLines flight={booking.flight} />}
            {hotel && (
              <>
                <p className="text-sm font-medium text-slate-700">{hotel.roomTypeName} · {hotel.ratePlanName}</p>
                {hotel.checkIn && hotel.checkOut && (
                  <StayTimeline className="mt-3" compact checkIn={hotel.checkIn} checkOut={hotel.checkOut}
                    checkInTime={hotel.checkInTime} checkOutTime={hotel.checkOutTime} nights={hotel.nights ?? 0} />
                )}
              </>
            )}
            <div className="mt-5 border-t border-dashed border-slate-200 pt-4">
              <PriceBreakdown items={booking.priceItems} total={booking.totalAmount} currency={booking.currency} />
            </div>
            <p className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200/70">
              Booking reference
              <span className="font-mono text-sm font-semibold tracking-wide text-slate-900">{booking.reference}</span>
            </p>
          </div>
        </Card>

        {/* 3. Reassurance: refunds, the confirmation e-mail, and the cancellation terms (or where to get help). */}
        <section aria-labelledby="pay-good-to-know" className="min-w-0 lg:col-start-1 lg:row-start-2">
          <h2 id="pay-good-to-know" className="text-base font-bold tracking-tight text-slate-900">Good to know</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3 stagger">
            <Reassurance icon={<RotateCcw />} title="Refunded if not confirmed">
              If the {supplier} cannot confirm your booking, the payment is refunded in full.
            </Reassurance>
            <Reassurance icon={<Mail />} title="Confirmation by e-mail">
              Sent to <span className="break-all font-medium text-slate-800">{booking.contactEmail}</span> once the {supplier} confirms.
            </Reassurance>
            {hotel?.cancellation?.policy ? (
              <Reassurance icon={<ShieldCheck />} title="Cancellation">{hotel.cancellation.policy}</Reassurance>
            ) : (
              <Reassurance icon={<Headset />} title="Help with this booking">Our support team can help you from My Trips.</Reassurance>
            )}
          </ul>
        </section>
      </div>
    </PageContainer>
  );
}

/** A way to pay offered in the provider's window (a chip). */
function PayMethod({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-xs ring-1 ring-inset ring-slate-200 [&_svg]:size-4">
      {icon}
      {children}
    </li>
  );
}

/** One "Good to know" card: icon beside the text on phones, above it in the three columns from `sm` up. */
function Reassurance({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card hover-lift sm:flex-col sm:gap-2.5">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-role-50 text-role-600 ring-1 ring-inset ring-role-100 [&_svg]:size-[1.125rem]">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="text-xs leading-relaxed text-slate-600">{children}</span>
      </span>
    </li>
  );
}
