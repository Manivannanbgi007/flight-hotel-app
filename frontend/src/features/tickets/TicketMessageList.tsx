import { Headset, Info, UserRound } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { TicketAuthorRole, TicketMessage } from './types';

/**
 * A ticket's conversation, oldest message first. Shared by the customer's ticket page and the support agents' view:
 * each passes who wrote a message in its reader's words, and which messages are "ours" (shown on the right).
 */
export function TicketMessageList({ messages, authorLabel, isOwn }: {
  messages: readonly TicketMessage[];
  authorLabel: (role: TicketAuthorRole) => string;
  isOwn: (role: TicketAuthorRole) => boolean;
}) {
  return (
    <section aria-label="Conversation">
      <ol className="flex flex-col gap-4" aria-label="Messages">
        {messages.map((message) => {
          const own = isOwn(message.authorRole);
          if (message.authorRole === 'SYSTEM' && !own) {
            return (
              <li key={message.id} className="flex flex-col items-center gap-1 self-center px-2 text-center animate-fade-in">
                <p className="flex flex-wrap items-center justify-center gap-x-2 text-xs">
                  <Info className="size-3.5 text-slate-500" aria-hidden="true" />
                  <span className="font-semibold text-slate-700">{authorLabel(message.authorRole)}</span>
                  <time dateTime={message.createdAt} className="text-slate-500">{formatDateTime(message.createdAt)}</time>
                </p>
                <p className="max-w-xl whitespace-pre-line break-words rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-700">{message.message}</p>
              </li>
            );
          }
          const Icon = own ? UserRound : Headset;
          return (
            <li key={message.id} className={cn('flex max-w-[92%] items-end gap-2.5 sm:max-w-[80%] animate-fade-in', own ? 'flex-row-reverse self-end' : 'self-start')}>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full ring-1',
                  own ? 'bg-role-100 text-role-700 ring-role-200' : 'bg-white text-slate-600 ring-slate-200',
                )}
              >
                <Icon className="size-4" />
              </span>
              <div
                className={cn(
                  'min-w-0 rounded-2xl px-4 py-3 shadow-xs',
                  own ? 'rounded-br-md bg-role-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800',
                )}
              >
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                  <span className={cn('font-semibold', own ? 'text-white' : 'text-slate-900')}>{authorLabel(message.authorRole)}</span>
                  <time dateTime={message.createdAt} className={own ? 'text-role-50' : 'text-slate-500'}>{formatDateTime(message.createdAt)}</time>
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">{message.message}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
