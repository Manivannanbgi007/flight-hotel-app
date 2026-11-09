import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router';
import { BadgePercent, Mail, UserRound } from 'lucide-react';

import { useAuth } from '@/app/providers/useAuth';
import { PageContainer } from '@/components/layout/PageContainer';
import { LostIllustration, StormIllustration } from '@/components/illustrations';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/StateViews';
import { useProfile } from '@/features/account/useAccount';
import { hotelApi } from '@/features/hotels/hotelApi';
import type { Quote } from '@/features/hotels/types';
import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatMoney } from '@/lib/format';
import { useCountdown } from '@/lib/useCountdown';
import { bookingApi } from './bookingApi';
import { loadDraft, saveDraft } from './bookingDraft';
import { BookingSteps } from './BookingParts';
import { Art, BookingPageSkeleton, DetailCard } from './BookingUi';
import { StaySummaryCard } from './StaySummaryCard';
import { guestDetailsSchema, type GuestDetailsForm } from './schemas';

/** /book/hotel/:quoteId — step 1: who stays, how the hotel can reach the customer, optional coupon. */
export function GuestDetailsPage() {
  const { quoteId = '' } = useParams();
  const quote = useQuery({
    queryKey: queryKeys.hotels.quote(quoteId),
    queryFn: () => hotelApi.getQuote(quoteId),
    retry: false,
    staleTime: Infinity,
  });

  if (quote.isPending) {
    return <PageContainer width="lg"><BookingPageSkeleton label="Loading your stay…" /></PageContainer>;
  }
  if (quote.isError) {
    return <QuoteProblem error={ApiError.from(quote.error)} onRetry={() => void quote.refetch()} />;
  }
  return <GuestForm quote={quote.data} />;
}

export function QuoteProblem({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <PageContainer width="md">
      <div className="mx-auto max-w-xl">
        {error.status === 404 ? (
          <ErrorState illustration={<Art><LostIllustration /></Art>} title="This price has expired" description="Prices are held for 15 minutes. Please check availability again." />
        ) : (
          <ErrorState illustration={<Art><StormIllustration /></Art>} description={error.message} onRetry={onRetry} />
        )}
        <p className="mt-4 text-center"><Link to="/hotels" className="font-semibold text-role-700 hover:underline">Search hotels</Link></p>
      </div>
    </PageContainer>
  );
}

function GuestForm({ quote }: { quote: Quote }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const profile = useProfile();
  const remaining = useCountdown(quote.expiresAt);
  const expired = remaining <= 0;
  const draft = loadDraft(quote.quoteId);
  const [couponResult, setCouponResult] = useState<{ code: string; message: string; tone: 'success' | 'danger' } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<GuestDetailsForm>({
    resolver: zodResolver(guestDetailsSchema),
    defaultValues: {
      guests: Array.from({ length: quote.rooms }, (_, index) => ({
        firstName: draft?.guests[index]?.firstName ?? (index === 0 ? (user?.firstName ?? '') : ''),
        lastName: draft?.guests[index]?.lastName ?? (index === 0 ? (user?.lastName ?? '') : ''),
      })),
      contactEmail: draft?.contact.email ?? user?.email ?? '',
      contactPhone: draft?.contact.phone ?? '',
      specialRequests: draft?.specialRequests ?? '',
      couponCode: draft?.couponCode ?? '',
    },
  });
  const { fields } = useFieldArray({ control, name: 'guests' });

  // The phone number from the profile, once, when it has loaded and the customer has not typed one. Never again:
  // clearing the field on purpose must stay cleared.
  const savedPhone = profile.data?.phone;
  const phoneFilled = useRef(false);
  useEffect(() => {
    if (savedPhone && !phoneFilled.current) {
      phoneFilled.current = true;
      if (!getValues('contactPhone')) {
        setValue('contactPhone', savedPhone);
      }
    }
  }, [savedPhone, getValues, setValue]);

  const coupon = useMutation({
    mutationFn: (code: string) => bookingApi.checkCoupon({ code, bookingType: 'HOTEL', amount: quote.total, destinationCity: undefined }),
    onSuccess: (result) =>
      setCouponResult({
        code: result.code,
        tone: 'success',
        message: `${result.title}: you save ${formatMoney(result.discount, result.currency, true)} (the final amount is confirmed with the hotel's price).`,
      }),
    onError: (error) => setCouponResult({ code: '', tone: 'danger', message: ApiError.from(error).message }),
  });

  const onSubmit = (form: GuestDetailsForm) => {
    saveDraft({
      quoteId: quote.quoteId,
      contact: { email: form.contactEmail, phone: form.contactPhone },
      guests: form.guests,
      specialRequests: form.specialRequests,
      couponCode: form.couponCode.toUpperCase(),
    });
    void navigate(`/book/hotel/${quote.quoteId}/review`);
  };

  const checkCoupon = () => {
    const code = getValues('couponCode').trim();
    if (code) {
      setCouponResult(null);
      coupon.mutate(code);
    }
  };

  return (
    <PageContainer width="lg">
      <BookingSteps current={1} />
      <PageHeader
        className="mt-6"
        title="Guest details"
        description="Who is checking in, and how the hotel can reach you. It takes a minute."
      />
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {fields.map((field, index) => (
            <DetailCard key={field.id} title={quote.rooms > 1 ? `Room ${index + 1} guest` : 'Lead guest'} icon={<UserRound />}>
              <p className="mt-2 text-sm text-slate-600">Name of the person who checks in. Use the name on their ID.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <TextField label="First name" autoComplete={index === 0 ? 'given-name' : 'off'}
                  error={errors.guests?.[index]?.firstName?.message} {...register(`guests.${index}.firstName`)} />
                <TextField label="Last name" autoComplete={index === 0 ? 'family-name' : 'off'}
                  error={errors.guests?.[index]?.lastName?.message} {...register(`guests.${index}.lastName`)} />
              </div>
            </DetailCard>
          ))}

          <DetailCard title="Contact for the confirmation" icon={<Mail />}>
            <p className="mt-2 text-sm text-slate-600">We send the confirmation here, and the hotel may call this number.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Email" type="email" autoComplete="email" error={errors.contactEmail?.message} {...register('contactEmail')} />
              <TextField label="Phone" type="tel" autoComplete="tel" hint="With country code, for example +91 98000 00000"
                error={errors.contactPhone?.message} {...register('contactPhone')} />
            </div>
            <div className="mt-4">
              <TextField label="Special requests" optional hint="Not guaranteed; the hotel does its best."
                error={errors.specialRequests?.message} {...register('specialRequests')} />
            </div>
          </DetailCard>

          <DetailCard title="Coupon" icon={<BadgePercent />}>
            <div className="mt-4 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Coupon code" optional autoComplete="off" error={errors.couponCode?.message}
                  {...register('couponCode', { onChange: () => setCouponResult(null) })} />
              </div>
              <Button type="button" variant="secondary" className="mt-7" loading={coupon.isPending} onClick={checkCoupon}>
                Check
              </Button>
            </div>
            {couponResult && <Alert tone={couponResult.tone} className="mt-3">{couponResult.message}</Alert>}
          </DetailCard>
        </div>

        <StaySummaryCard
          quote={quote}
          remaining={remaining}
          note="Including taxes. Coupons are applied on the next step."
          footer={
            <>
              <Button type="submit" size="lg" className="mt-5 w-full" disabled={expired}>
                Review booking
              </Button>
              <Link to={`/hotels/quote/${quote.quoteId}`} className="mt-3 block text-center text-sm font-semibold text-role-700 hover:underline">
                Back to price details
              </Link>
            </>
          }
        />
      </form>
    </PageContainer>
  );
}
