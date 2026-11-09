import { useEffect, useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { CalendarClock, Hash, Luggage, Send, Tag, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { usePollingFallback } from '@/app/providers/useRealtime';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextAreaField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { BackLink } from '@/features/account/BackLink';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime } from '@/lib/format';
import { ticketApi } from './ticketApi';
import { TicketMessageList } from './TicketMessageList';
import { authorLabels, MESSAGE_MAX_LENGTH, replySchema, ticketCategoryLabels, ticketStatusInfo, type ReplyForm } from './ticketText';
import type { Ticket, TicketStatus } from './types';

/** A reply to one of these reopens the ticket (API_DOCUMENTATION.md §10c). */
const REOPENED_BY_REPLY: readonly TicketStatus[] = ['WAITING_CUSTOMER', 'RESOLVED'];

/**
 * /account/support/:ticketId — the conversation with support: messages with who wrote them, a reply box and
 * "Close ticket". Live updates (`support.ticket-changed`) bring new answers in; without them the page polls.
 */
export function TicketPage() {
  const { ticketId = '' } = useParams();
  const fallback = usePollingFallback(10_000);
  const ticket = useQuery({
    queryKey: queryKeys.support.ticket(ticketId),
    queryFn: () => ticketApi.get(ticketId),
    refetchInterval: (query) => (query.state.data?.status === 'CLOSED' ? false : fallback),
  });

  if (ticket.isPending) {
    return <LoadingState label="Loading the conversation…" rows={3} />;
  }
  if (ticket.isError) {
    const error = ApiError.from(ticket.error);
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorState title={error.status === 404 ? 'Ticket not found' : undefined} description={error.message}
          illustration={error.status === 404 ? 'lost' : 'error'} className="w-full"
          correlationId={error.correlationId} onRetry={error.status === 404 ? undefined : () => void ticket.refetch()} />
        <ButtonLink to="/account/support" variant="secondary">Support tickets</ButtonLink>
      </div>
    );
  }
  return <Conversation ticket={ticket.data} />;
}

const newTicketPath = (bookingId: string | null) =>
  `/account/support/new${bookingId ? `?bookingId=${encodeURIComponent(bookingId)}` : ''}`;

function Conversation({ ticket }: { ticket: Ticket }) {
  const info = ticketStatusInfo[ticket.status];
  const closed = ticket.status === 'CLOSED';
  const statusRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();
  const [confirmClose, setConfirmClose] = useState(false);
  /** A reply the server refused because the ticket had been closed meanwhile (409 TICKET_CLOSED). */
  const [unsent, setUnsent] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <BackLink to="/account/support">Support tickets</BackLink>
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h2 className="min-w-0 break-words text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{ticket.subject}</h2>
          <Badge tone={info.tone} dot className="mt-1">{info.label}</Badge>
          <LiveIndicator className="ml-auto mt-1" />
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600" aria-label="Ticket details">
          <li className="flex items-center gap-1.5">
            <Hash className="size-4 text-slate-500" aria-hidden="true" />
            <span>{ticket.ticketNumber}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Tag className="size-4 text-slate-500" aria-hidden="true" />
            <span>{ticketCategoryLabels[ticket.category] ?? ticket.category}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-slate-500" aria-hidden="true" />
            <span>Opened {formatDateTime(ticket.createdAt)}</span>
          </li>
          {ticket.bookingId && (
            <li className="flex items-center gap-1.5">
              <Luggage className="size-4 text-slate-500" aria-hidden="true" />
              <Link to={`/my-trips/${encodeURIComponent(ticket.bookingId)}`} className="font-semibold text-brand-700 hover:underline">
                Booking {ticket.bookingReference ?? ''}
              </Link>
            </li>
          )}
        </ul>
      </header>

      <div ref={statusRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        <Alert tone={ticket.status === 'WAITING_CUSTOMER' ? 'warning' : ticket.status === 'RESOLVED' ? 'success' : 'info'} title={info.label}>
          {info.description}
          {closed && (
            <Link to={newTicketPath(ticket.bookingId)} className="mt-1 block font-medium underline">Create a new ticket</Link>
          )}
        </Alert>
      </div>

      {unsent !== null && (
        <Alert tone="danger" title="Your reply was not sent">
          This ticket was closed before your reply arrived.{' '}
          <Link to={newTicketPath(ticket.bookingId)} state={{ message: unsent }} className="font-medium underline">
            Start a new ticket with your text
          </Link>
        </Alert>
      )}

      <div className="rounded-2xl bg-slate-100/70 p-3 ring-1 ring-slate-200/70 sm:p-5">
        <TicketMessageList
          messages={ticket.messages}
          authorLabel={(role) => authorLabels[role] ?? 'Support'}
          isOwn={(role) => role === 'CUSTOMER'}
        />
      </div>

      {!closed && (
        <>
          <Card className="p-5">
            <ReplyBox ticket={ticket} onRefusedAsClosed={setUnsent} />
          </Card>
          <div className="flex flex-col gap-3">
            <div>
              <Button ref={closeButtonRef} variant="secondary" aria-expanded={confirmClose} aria-controls={confirmId}
                onClick={() => setConfirmClose((open) => !open)}>
                <XCircle className="size-4" aria-hidden="true" />
                Close ticket
              </Button>
            </div>
            {confirmClose && (
              <CloseConfirmation
                id={confirmId}
                ticket={ticket}
                onCancel={() => {
                  setConfirmClose(false);
                  closeButtonRef.current?.focus();
                }}
                onClosed={() => statusRef.current?.focus()}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ReplyBox({ ticket, onRefusedAsClosed }: { ticket: Ticket; onRefusedAsClosed: (text: string) => void }) {
  const queryClient = useQueryClient();
  const key = queryKeys.support.ticket(ticket.id);
  const reopens = ticket.status === 'RESOLVED';
  const [shownOnField, setShownOnField] = useState(false);
  const { register, handleSubmit, reset, setError, control, formState: { errors } } = useForm<ReplyForm>({
    resolver: zodResolver(replySchema),
    defaultValues: { message: '' },
  });
  const text = useWatch({ control, name: 'message' }) ?? '';
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.ticketLists });
  };

  const reply = useMutation({
    mutationFn: (form: ReplyForm) => ticketApi.reply(ticket.id, form.message),
    onMutate: () => setShownOnField(false),
    onSuccess: (message) => {
      // Show the reply at once; the refetch brings the new status (a reply reopens a resolved ticket).
      queryClient.setQueryData<Ticket>(key, (old) => old && {
        ...old,
        status: REOPENED_BY_REPLY.includes(old.status) ? 'OPEN' : old.status,
        messages: [...old.messages.filter((existing) => existing.id !== message.id), message],
        lastMessageAt: message.createdAt,
        lastMessageBy: 'CUSTOMER',
      });
      refresh();
      reset({ message: '' });
      toast.success(reopens ? 'Reply sent. The ticket is open again.' : 'Reply sent.');
    },
    onError: (error, form) => {
      const problem = ApiError.from(error);
      if (problem.code === 'TICKET_CLOSED') {
        onRefusedAsClosed(form.message);
        queryClient.setQueryData<Ticket>(key, (old) => old && { ...old, status: 'CLOSED' });
        refresh();
      } else {
        setShownOnField(applyServerErrors(problem, setError, ['message']));
      }
    },
  });
  const problem = reply.error && !shownOnField ? ApiError.from(reply.error) : null;

  return (
    <form aria-label="Reply" noValidate className="flex flex-col gap-3" onSubmit={handleSubmit((form) => reply.mutate(form))}>
      <TextAreaField
        label="Your reply"
        rows={4}
        maxLength={MESSAGE_MAX_LENGTH}
        hint={`${text.length} / ${MESSAGE_MAX_LENGTH} characters`}
        error={errors.message?.message}
        {...register('message')}
      />
      {problem && problem.code !== 'TICKET_CLOSED' && (
        <Alert tone="danger" title="Your reply was not sent">
          {problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={reply.isPending}>
          <Send className="size-4" aria-hidden="true" />
          {reopens ? 'Send and reopen' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}

function CloseConfirmation({ id, ticket, onCancel, onClosed }: { id: string; ticket: Ticket; onCancel: () => void; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const key = queryKeys.support.ticket(ticket.id);

  const close = useMutation({
    mutationFn: () => ticketApi.close(ticket.id),
    onSuccess: (closedTicket) => {
      queryClient.setQueryData(key, closedTicket);
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.ticketLists });
      toast.success(`Ticket ${closedTicket.ticketNumber} closed.`);
      onClosed();
    },
    onError: (error) => {
      if (ApiError.from(error).code === 'TICKET_CLOSED') {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
  const problem = close.error ? ApiError.from(close.error) : null;

  return (
    <section id={id} aria-labelledby={headingId} className="rounded-2xl border border-danger-200 bg-danger-50/60 p-4 animate-scale-in sm:p-5">
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold text-slate-900 focus:outline-none">Close this ticket?</h3>
      <p className="mt-1 text-sm text-slate-600">
        Close it when your question is answered. A closed ticket takes no more replies, but you can always create a new one.
      </p>
      {problem && (
        <Alert tone="danger" className="mt-3">
          {problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="danger" loading={close.isPending} onClick={() => close.mutate()}>Yes, close ticket</Button>
        <Button variant="ghost" onClick={onCancel}>Keep it open</Button>
      </div>
    </section>
  );
}
