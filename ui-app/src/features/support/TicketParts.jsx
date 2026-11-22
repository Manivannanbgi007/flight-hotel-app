import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

import { ApiError } from '@/lib/api/apiError';
import { queryKeys } from '@/lib/api/queryKeys';
import { agentTicketApi } from './agentTicketApi';
import { agentStatusInfo, mergeTicket, priorityLabels } from './ticketQueueText';

export function AgentStatusBadge({ status }) {
  const info = agentStatusInfo[status] ?? { label: status, tone: 'neutral' };
  return <Badge tone={info.tone}>{info.label}</Badge>;
}

/** High priority is spelled out (with a flag icon), never shown by colour alone. Normal priority shows nothing unless `showNormal`. */
export function PriorityBadge({ priority, showNormal = false }) {
  if (priority === 'HIGH') {
    return (
      <Badge tone="danger">
        <Flag className="size-3" aria-hidden="true" /> {priorityLabels.HIGH} priority
      </Badge>
    );
  }
  return showNormal && priority ? <Badge>{priorityLabels[priority]} priority</Badge> : null;
}

/**
 * Assigns the ticket to the current agent. Refreshes the queue, its counts and the open conversation. `ticketNumber`
 * is added for screen readers when several buttons share a page (queue rows).
 */
export function AssignToMeButton({ ticketId, ticketNumber, size = 'sm', variant = 'secondary' }) {
  const queryClient = useQueryClient();
  const assign = useMutation({
    mutationFn: () => agentTicketApi.assign(ticketId),
    onSuccess: (ticket) => {
      queryClient.setQueryData(queryKeys.support.ticket(ticketId), (old) => old && mergeTicket(old, ticket));
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.queue });
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.summary });
      toast.success(`${ticket.ticketNumber ?? ticketNumber ?? 'The ticket'} is assigned to you.`);
    },
    onError: (error) => {
      const problem = ApiError.from(error);
      toast.error(problem.message, {
        description: problem.correlationId ? `Support reference: ${problem.correlationId}` : undefined,
      });
    },
  });
  return (
    <Button size={size} variant={variant} loading={assign.isPending} onClick={() => assign.mutate()}>
      Assign to me
      {ticketNumber && (
        <>
          {' '}
          <span className="sr-only">{ticketNumber}</span>
        </>
      )}
    </Button>
  );
}
