import { z } from 'zod';

import type { AttentionReason, SupportNote, SupportNoteAction } from '@/features/bookings/types';

/** Why a booking is in the "Needs attention" queue (set automatically, or by an agent: ESCALATED). */
export const attentionReasonLabels: Record<AttentionReason, string> = {
  REFUND_FAILED: 'Refund failed',
  CANCELLATION_REJECTED: 'Cancellation rejected',
  CANCELLATION_NO_ANSWER: 'No answer to the cancellation',
  REFUND_NO_ANSWER: 'No answer about the refund',
  REFUND_DIFFERS: 'Airline refund differs from the quote',
  ESCALATED: 'Escalated',
};

/** The label of a reason; a reason this page does not know yet is shown as sent. */
export function attentionLabel(reason: string): string {
  return attentionReasonLabels[reason as AttentionReason] ?? reason;
}

/** What an entry of the internal support history records. */
export const supportNoteActionLabels: Record<SupportNoteAction, string> = {
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  REFUND_RETRIED: 'Refund retried',
  CANCELLED_ON_BEHALF: 'Cancelled on behalf of the customer',
};

export function supportNoteAuthor(note: Pick<SupportNote, 'authorRole'>): string {
  return note.authorRole === 'ADMIN' ? 'Admin' : 'Support agent';
}

const NOTE_MAX = 500;
const noteText = z.string().trim().max(NOTE_MAX, `Please keep the note under ${NOTE_MAX} characters`);

/** Escalate: an internal note is required (1 to 500 characters). */
export const escalateNoteSchema = z.object({ note: noteText.min(1, 'Write a short note') });
/** Resolve: the note is optional (up to 500 characters). */
export const resolveNoteSchema = z.object({ note: noteText });
export type NoteForm = z.infer<typeof resolveNoteSchema>;
