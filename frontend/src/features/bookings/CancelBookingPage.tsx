import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BedDouble, Info, Plane } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { LostIllustration, StormIllustration } from '@/components/illustrations';
import { buttonClass } from '@/components/ui/buttonStyles';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/StateViews';
import { ApiError } from '@/lib/api/apiError';
import { formatDate } from '@/lib/format';
import { Art, BackLink, BookingPageSkeleton } from './BookingUi';
import { CancelBookingForm } from './CancelBookingForm';
import type { BookingDetails } from './types';
import { useBookingDetails } from './useBookingDetails';

/**
 * /my-trips/:bookingId/cancel — what cancelling costs and returns, then the confirmation. After the `202` the
 * customer goes back to the booking, which shows "Cancellation in progress" until the hotel or airline answers.
 */
export function CancelBookingPage() {
  const { bookingId = '' } = useParams();
  const booking = useBookingDetails(bookingId);

  if (booking.isPending) {
    return <PageContainer width="md"><BookingPageSkeleton label="Loading your booking…" aside={false} /></PageContainer>;
  }
  if (booking.isError) {
    const error = ApiError.from(booking.error);
    return (
      <PageContainer width="md">
        <div className="mx-auto max-w-xl">
          <ErrorState title={error.status === 404 ? 'Booking not found' : undefined} description={error.message}
            illustration={<Art>{error.status === 404 ? <LostIllustration /> : <StormIllustration />}</Art>}
            correlationId={error.correlationId} onRetry={error.status === 404 ? undefined : () => void booking.refetch()} />
          <p className="mt-4 text-center"><Link to="/my-trips" className="font-semibold text-role-700 hover:underline">My Trips</Link></p>
        </div>
      </PageContainer>
    );
  }
  return <CancelStep booking={booking.data} />;
}

function CancelStep({ booking }: { booking: BookingDetails }) {
  const navigate = useNavigate();
  const back = `/my-trips/${booking.id}`;
  const supplier = booking.type === 'FLIGHT' ? 'airline' : 'hotel';
  const dates = booking.startDate
    ? booking.endDate && booking.endDate !== booking.startDate
      ? `${formatDate(booking.startDate)} to ${formatDate(booking.endDate)}`
      : formatDate(booking.startDate)
    : null;

  return (
    <PageContainer width="md">
      <BackLink to={back}>← Back to the booking</BackLink>
      <PageHeader
        className="mt-3"
        icon={booking.type === 'FLIGHT' ? <Plane className="size-5" /> : <BedDouble className="size-5" />}
        title="Cancel booking"
        description={
          <>
            {booking.title ?? (booking.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking')}
            {dates && ` · ${dates}`} · reference <strong className="text-slate-900">{booking.reference}</strong>
          </>
        }
      />
      <div className="mt-5 flex gap-3 rounded-2xl border border-info-200 bg-info-50 px-4 py-3 text-info-700">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="text-sm">
          Your booking is cancelled once the {supplier} confirms. The refund then goes back to your original payment method.
        </p>
      </div>
      <div className="mt-6">
        <CancelBookingForm
          booking={booking}
          onCancelled={() => {
            toast.success(`Cancellation requested. We will let you know when the ${supplier} confirms.`);
            void navigate(back, { replace: true });
          }}
          secondaryAction={<Link to={back} className={buttonClass({ variant: 'ghost' })}>Keep my booking</Link>}
        />
      </div>
    </PageContainer>
  );
}
