import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { BellRing, Link2, Send, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Alert } from '@/components/ui/Alert';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { SectionHeader } from '@/features/account/AccountLayout';
import { BackLink } from '@/features/account/BackLink';
import { bookingApi } from '@/features/bookings/bookingApi';
import type { BookingSummary } from '@/features/bookings/types';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDate } from '@/lib/format';
import { ticketApi } from './ticketApi';
import { MESSAGE_MAX_LENGTH, newTicketSchema, TICKET_CATEGORIES, ticketCategoryLabels, type NewTicketForm } from './ticketText';
import type { TicketCategory } from './types';

/** How many of the customer's bookings the picker offers (newest first). */
const BOOKING_CHOICES = 50;

type BookingChoice = Pick<BookingSummary, 'id' | 'reference' | 'title' | 'type' | 'startDate'>;

const choiceLabel = (booking: BookingChoice) =>
  [booking.reference, booking.title ?? (booking.type === 'FLIGHT' ? 'Flight' : 'Hotel stay'), booking.startDate && formatDate(booking.startDate)]
    .filter(Boolean)
    .join(' · ');

/**
 * /account/support/new — a new ticket: subject, topic, optionally one of my bookings, and the message.
 * `?bookingId=` pre-selects a booking ("Get help with this booking"); a reply that could not be sent to a closed ticket
 * arrives as the router state `{ message }`, so the text is not lost.
 */
export function NewTicketPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const preselected = params.get('bookingId') ?? '';
  const state = location.state as { message?: unknown } | null;
  const carriedMessage = typeof state?.message === 'string' ? state.message : '';

  const bookings = useQuery({
    queryKey: queryKeys.bookings.list({ tab: 'ALL', page: 0, size: BOOKING_CHOICES }),
    queryFn: () => bookingApi.list('ALL', 0, BOOKING_CHOICES),
  });
  const listed: BookingChoice[] = bookings.data?.content ?? [];
  // A pre-selected booking older than the list (or the list failed): load just that one.
  const needDetails = preselected !== '' && !bookings.isPending && !listed.some((booking) => booking.id === preselected);
  const single = useQuery({
    queryKey: queryKeys.bookings.detail(preselected),
    queryFn: () => bookingApi.details(preselected),
    enabled: needDetails,
    retry: false,
  });
  const ready = !bookings.isPending && (!needDetails || !single.isPending);
  const choices = needDetails && single.data ? [single.data, ...listed] : listed;
  const bookingId = choices.some((booking) => booking.id === preselected) ? preselected : '';

  return (
    <div>
      <BackLink to="/account/support" className="mb-3">Support tickets</BackLink>
      <SectionHeader title="New support ticket" description="Tell us what happened. We answer here and send you a notification." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        {ready ? (
          <TicketForm
            choices={choices}
            bookingsFailed={bookings.isError}
            defaults={{ subject: '', category: bookingId ? 'BOOKING' : '', bookingId, message: carriedMessage }}
          />
        ) : (
          <Skeleton className="h-96 w-full rounded-2xl" />
        )}
        <aside aria-labelledby="ticket-tips-title" className="self-start rounded-2xl bg-gradient-sky p-5 ring-1 ring-brand-100">
          <h3 id="ticket-tips-title" className="text-sm font-bold text-slate-900">Help us help you</h3>
          <ul className="mt-3 flex flex-col gap-3 text-sm text-slate-700">
            <li className="flex gap-2.5">
              <Link2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span>Choose the booking it is about, so support sees its details.</span>
            </li>
            <li className="flex gap-2.5">
              <BellRing className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span>Answers appear in the ticket, and you get a notification.</span>
            </li>
            <li className="flex gap-2.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <span>Never write card numbers or passwords in a ticket.</span>
            </li>
          </ul>
          <p className="mt-4 border-t border-brand-100 pt-3 text-sm text-slate-700">
            Quick answers: <Link to="/help" className="font-semibold text-brand-700 hover:underline">Help &amp; Support</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

function TicketForm({ choices, bookingsFailed, defaults }: { choices: BookingChoice[]; bookingsFailed: boolean; defaults: NewTicketForm }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [shownOnField, setShownOnField] = useState(false);
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<NewTicketForm>({
    resolver: zodResolver(newTicketSchema),
    defaultValues: defaults,
  });
  const message = useWatch({ control, name: 'message' }) ?? '';

  const create = useMutation({
    mutationFn: (form: NewTicketForm) =>
      ticketApi.create({
        subject: form.subject,
        category: form.category as TicketCategory,
        message: form.message,
        ...(form.bookingId ? { bookingId: form.bookingId } : {}),
      }),
    onMutate: () => setShownOnField(false),
    onSuccess: (ticket) => {
      queryClient.setQueryData(queryKeys.support.ticket(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.ticketLists });
      toast.success(`Ticket ${ticket.ticketNumber} created. We will answer here.`);
      void navigate(`/account/support/${encodeURIComponent(ticket.id)}`);
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      if (problem.code === 'INVALID_BOOKING') {
        setError('bookingId', { type: 'server', message: problem.message }, { shouldFocus: true });
        setShownOnField(true);
      } else {
        setShownOnField(applyServerErrors(problem, setError, ['subject', 'category', 'bookingId', 'message']));
      }
    },
  });
  const problem = create.error && !shownOnField ? ApiError.from(create.error) : null;

  let bookingHint = 'Choose the booking this is about, so support can see it.';
  if (bookingsFailed) bookingHint = 'We could not load your bookings. You can still send the ticket: mention the booking reference in your message.';
  else if (choices.length === 0) bookingHint = 'You have no bookings yet.';

  return (
    <Card className="p-5 sm:p-6">
      <form aria-label="New support ticket" noValidate className="flex flex-col gap-5" onSubmit={handleSubmit((form) => create.mutate(form))}>
        {problem && (
          <Alert tone="danger" title="The ticket was not sent">
            {problem.message}
            {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
          </Alert>
        )}
        <TextField label="Subject" maxLength={120} placeholder="For example: wrong name on my booking" error={errors.subject?.message} {...register('subject')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="What is it about?" error={errors.category?.message} {...register('category')}>
            <option value="">Choose…</option>
            {TICKET_CATEGORIES.map((category) => <option key={category} value={category}>{ticketCategoryLabels[category]}</option>)}
          </SelectField>
          <SelectField label="Booking" optional hint={bookingHint} error={errors.bookingId?.message} {...register('bookingId')}>
            <option value="">No booking</option>
            {choices.map((booking) => <option key={booking.id} value={booking.id}>{choiceLabel(booking)}</option>)}
          </SelectField>
        </div>
        <TextAreaField
          label="Message"
          rows={6}
          maxLength={MESSAGE_MAX_LENGTH}
          hint={`${message.length} / ${MESSAGE_MAX_LENGTH} characters. Please don't include card numbers or passwords.`}
          error={errors.message?.message}
          {...register('message')}
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
          <Button type="submit" loading={create.isPending}>
            <Send className="size-4" aria-hidden="true" />
            Send ticket
          </Button>
          <ButtonLink to="/account/support" variant="ghost">Cancel</ButtonLink>
        </div>
      </form>
    </Card>
  );
}
