import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';

import { useAuth } from '@/app/providers/useAuth';
import { usePollingFallback } from '@/app/providers/useRealtime';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextAreaField } from '@/components/ui/Field';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { TicketMessageList } from '@/features/tickets/TicketMessageList';
import { MESSAGE_MAX_LENGTH, replySchema, TICKET_STATUSES, type ReplyForm } from '@/features/tickets/ticketText';
import type { TicketStatus } from '@/features/tickets/types';
import { ApiError } from '@/lib/api/apiError';
import { applyServerErrors } from '@/lib/api/formErrors';
import { queryKeys } from '@/lib/api/queryKeys';
import { formatDateTime } from '@/lib/format';
import { agentTicketApi } from './agentTicketApi';
import { AgentStatusBadge, AssignToMeButton, PriorityBadge } from './TicketParts';
import {
  agentAuthorLabels,
  agentCategoryLabel,
  agentStatusLabel,
  isAssignedToMe,
  isSupportMessage,
  mergeTicket,
  priorityLabels,
  TICKET_PRIORITIES,
} from './ticketQueueText';
import type { AgentTicket, TicketPriority } from './types';

/**
 * /support/tickets/:ticketId — a ticket as a support agent handles it: the conversation, a reply box, status and
 * priority, assignment and a link to the booking. Live updates (`support.ticket-changed`) bring new messages in; without
 * them the page polls.
 */
export function AgentTicketPage() {
  const { ticketId = '' } = useParams();
  const fallback = usePollingFallback(10_000);
  const ticket = useQuery({
    queryKey: queryKeys.support.ticket(ticketId),
    queryFn: () => agentTicketApi.get(ticketId),
    refetchInterval: (query) => (query.state.data?.status === 'CLOSED' ? false : fallback),
  });

  if (ticket.isPending) {
    return <LoadingState label="Loading the ticket…" rows={4} />;
  }
  if (ticket.isError) {
    const error = ApiError.from(ticket.error);
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorState title={error.status === 404 ? 'Ticket not found' : undefined} description={error.message}
          correlationId={error.correlationId} onRetry={error.status === 404 ? undefined : () => void ticket.refetch()} />
        <Link to="/support/tickets" className="font-medium text-role-700 hover:underline">Ticket queue</Link>
      </div>
    );
  }
  return <AgentConversation ticket={ticket.data} />;
}

function AgentConversation({ ticket }: { ticket: AgentTicket }) {
  const { user } = useAuth();
  const closed = ticket.status === 'CLOSED';
  const mine = isAssignedToMe(ticket, user?.id);
  /** A reply the server refused because the ticket had been closed meanwhile (409 TICKET_CLOSED). */
  const [unsent, setUnsent] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm"><Link to="/support/tickets" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-semibold text-role-700 shadow-xs ring-1 ring-slate-200 transition-colors hover:bg-role-50">← Ticket queue</Link></p>
      <header className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card animate-fade-up">
        <p className="text-xs font-semibold uppercase tracking-wider text-role-700">Support ticket {ticket.ticketNumber}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="break-words text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{ticket.subject}</h1>
          <AgentStatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <LiveIndicator className="ml-auto" />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {ticket.ticketNumber} · {agentCategoryLabel(ticket.category)} · opened {formatDateTime(ticket.createdAt)}
        </p>
        {ticket.customerEmail && <p className="mt-1 break-all text-sm text-slate-700">Customer: {ticket.customerEmail}</p>}
        {ticket.bookingId && (
          <p className="mt-1 text-sm">
            <Link to={`/support/bookings/${encodeURIComponent(ticket.bookingId)}`} className="font-medium text-role-700 hover:underline">
              Open booking {ticket.bookingReference ?? ''}
            </Link>
          </p>
        )}
      </header>

      <section aria-label="Assignment" className="flex flex-wrap items-center gap-3 rounded-2xl border border-role-100 bg-role-50/60 px-4 py-3">
        <p className="text-sm text-slate-700">
          {mine === true ? 'Assigned to you.' : mine === false ? (ticket.assignedAgentId ? 'Assigned to another agent.' : 'Nobody is assigned yet.') : 'Assignment not shown.'}
        </p>
        {mine !== true && !closed && <AssignToMeButton ticketId={ticket.id} />}
      </section>

      <TicketMessageList
        messages={ticket.messages}
        authorLabel={(role) => agentAuthorLabels[role] ?? 'Support'}
        isOwn={isSupportMessage}
      />

      {unsent !== null && (
        <Alert tone="danger" title="Your reply was not sent">
          The ticket was closed before your reply arrived. Your text:
          <span className="mt-1 block whitespace-pre-line break-words rounded-lg border border-danger-200 bg-white px-3 py-2 text-slate-800">{unsent}</span>
        </Alert>
      )}

      {closed ? (
        <Alert tone="info" title="Closed">This ticket is closed and takes no more replies. The customer can open a new one.</Alert>
      ) : (
        <>
          <Card className="p-5"><ReplyBox ticket={ticket} onRefusedAsClosed={setUnsent} /></Card>
          <Card className="p-5">
            <StatusForm key={`${ticket.status}-${ticket.priority ?? ''}`} ticket={ticket} />
          </Card>
        </>
      )}
    </div>
  );
}

function useRefreshTicket(ticketId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.ticket(ticketId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.queue });
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.summary });
  };
}

function ReplyBox({ ticket, onRefusedAsClosed }: { ticket: AgentTicket; onRefusedAsClosed: (text: string) => void }) {
  const queryClient = useQueryClient();
  const key = queryKeys.support.ticket(ticket.id);
  const refresh = useRefreshTicket(ticket.id);
  const [shownOnField, setShownOnField] = useState(false);
  const { register, handleSubmit, reset, setError, control, formState: { errors } } = useForm<ReplyForm>({
    resolver: zodResolver(replySchema),
    defaultValues: { message: '' },
  });
  const text = useWatch({ control, name: 'message' }) ?? '';

  const reply = useMutation({
    mutationFn: (form: ReplyForm) => agentTicketApi.reply(ticket.id, form.message),
    onMutate: () => setShownOnField(false),
    onSuccess: (message) => {
      // Show the reply at once; an agent's reply waits for the customer (the refetch confirms it).
      queryClient.setQueryData<AgentTicket>(key, (old) => old && {
        ...old,
        status: 'WAITING_CUSTOMER',
        messages: [...old.messages.filter((existing) => existing.id !== message.id), message],
        lastMessageAt: message.createdAt,
        lastMessageBy: 'SUPPORT',
      });
      refresh();
      reset({ message: '' });
      toast.success('Reply sent. The customer has been notified.');
    },
    onError: (error, form) => {
      const problem = ApiError.from(error);
      if (problem.code === 'TICKET_CLOSED') {
        onRefusedAsClosed(form.message);
        queryClient.setQueryData<AgentTicket>(key, (old) => old && { ...old, status: 'CLOSED' });
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
        label="Reply to the customer"
        rows={4}
        maxLength={MESSAGE_MAX_LENGTH}
        hint={`${text.length} / ${MESSAGE_MAX_LENGTH} characters. The customer gets a notification and the ticket waits for their answer.`}
        error={errors.message?.message}
        {...register('message')}
      />
      {problem && problem.code !== 'TICKET_CLOSED' && (
        <Alert tone="danger" title="Your reply was not sent">
          {problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}
      <div><Button type="submit" loading={reply.isPending}>Send reply</Button></div>
    </form>
  );
}

function StatusForm({ ticket }: { ticket: AgentTicket }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshTicket(ticket.id);
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority ?? 'NORMAL');
  const unchanged = status === ticket.status && priority === (ticket.priority ?? 'NORMAL');

  const save = useMutation({
    mutationFn: () => agentTicketApi.changeStatus(ticket.id, { status, priority }),
    onSuccess: (updated) => {
      queryClient.setQueryData<AgentTicket>(queryKeys.support.ticket(ticket.id), (old) => old && mergeTicket(old, updated));
      refresh();
      toast.success(`Ticket ${updated.ticketNumber ?? ticket.ticketNumber} updated: ${agentStatusLabel(updated.status ?? status)}.`);
    },
  });
  const problem = save.error ? ApiError.from(save.error) : null;

  return (
    <form aria-label="Status and priority" noValidate className="flex flex-col gap-3"
      onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h2 className="font-semibold text-slate-900">Status and priority</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Status" value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)}
          hint={status === 'CLOSED' ? 'Closing is final: the customer can no longer reply.' : undefined}>
          {TICKET_STATUSES.map((value) => <option key={value} value={value}>{agentStatusLabel(value)}</option>)}
        </SelectField>
        <SelectField label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
          {TICKET_PRIORITIES.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}
        </SelectField>
      </div>
      {problem && (
        <Alert tone="danger" title="Not saved">
          {problem.message}
          {problem.correlationId && <span className="block text-xs">Support reference: {problem.correlationId}</span>}
        </Alert>
      )}
      <div><Button type="submit" variant="secondary" disabled={unchanged} loading={save.isPending}>Save status</Button></div>
    </form>
  );
}
