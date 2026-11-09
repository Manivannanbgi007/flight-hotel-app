import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, Copy, Info, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { AssistantMascot } from './AssistantMascot';
import { cn } from '@/lib/cn';
import type { AssistantMessage, ChatMessage } from './chatReducer';
import { AnswerActions } from './AnswerActions';
import { AnswerBlocks } from './AnswerBlocks';
import { MessageText } from './MessageText';

/** After this long without any answer text, say that answers can take a while (a local model on a CPU). */
const SLOW_AFTER_MS = 15_000;
/** Closer than this to the bottom: new text keeps the list scrolled to the end. */
const STICK_DISTANCE = 96;

interface MessageListProps {
  messages: ChatMessage[];
  open: boolean;
  busy: boolean;
  restoring: boolean;
  restoreFailed: boolean;
  onRetryRestore: () => void;
  onRetry: (answerId: string) => void;
  /** Shown while there are no messages (greeting and suggestions). */
  intro: ReactNode;
  /** Maximized: the conversation in a centred column of a readable width. */
  wide?: boolean;
  /** A button under an answer opened a page: the panel steps aside (a maximized panel returns to its normal size). */
  onNavigate?: () => void;
}

/**
 * The conversation. Not a live region itself (it would read every word): the panel announces whole sentences in its
 * own live region. It scrolls with the answer unless the user scrolled up to read.
 */
export function MessageList({ messages, open, busy, restoring, restoreFailed, onRetryRestore, onRetry, intro, wide = false, onNavigate }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = useRef(messages.length);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A new question always scrolls down; streaming text only while the user is at the end.
    if (messages.length > count.current) stick.current = true;
    count.current = messages.length;
    if (stick.current && messages.length > 0) element.scrollTop = element.scrollHeight;
  }, [messages]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    // Reopened: the latest message. (Without messages the greeting stays at the top.)
    if (open && element && count.current > 0) {
      stick.current = true;
      element.scrollTop = element.scrollHeight;
    }
  }, [open]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (element) {
      stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_DISTANCE;
    }
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="region"
      aria-label="Conversation"
      // Keyboard users can scroll the conversation (axe: scrollable-region-focusable).
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,var(--color-slate-50),#fff)] px-4 py-5 focus-visible:outline-offset-[-2px] sm:px-5"
    >
      <div className={cn('flex flex-col', wide && 'mx-auto w-full max-w-3xl')}>
        {messages.length === 0 && !restoring && !restoreFailed && intro}
        {restoring && (
          <p role="status" className="flex items-center gap-2 py-2 text-sm text-slate-600">
            <Loader2 className="size-4 animate-spin text-role-600" aria-hidden="true" />
            Loading your conversation…
          </p>
        )}
        {restoreFailed && (
          <div className="mb-4 flex flex-col items-start gap-2 rounded-2xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200">
            <p>Your earlier conversation couldn't be loaded.</p>
            <Button variant="secondary" size="sm" onClick={onRetryRestore}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
        {messages.length > 0 && (
          <ol aria-label="Messages" className="flex flex-col gap-5">
            {messages.map((message) => (
              <li key={message.id} className="animate-message-in">
                {message.role === 'user' && (
                  <div className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[linear-gradient(135deg,var(--role-600),var(--role-700))] px-4 py-2.5 text-sm leading-relaxed text-white shadow-md shadow-role-600/20 [overflow-wrap:anywhere]">
                      <span className="sr-only">You: </span>
                      {message.text}
                    </p>
                  </div>
                )}
                {message.role === 'notice' && (
                  <p className="mx-auto w-fit max-w-[90%] rounded-full bg-white px-3 py-1 text-center text-xs font-medium text-slate-600 shadow-xs ring-1 ring-slate-200">
                    {message.text}
                  </p>
                )}
                {message.role === 'assistant' && <AnswerBubble answer={message} busy={busy} onRetry={onRetry} onNavigate={onNavigate} />}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function AnswerBubble({ answer, busy, onRetry, onNavigate }: {
  answer: AssistantMessage;
  busy: boolean;
  onRetry: (answerId: string) => void;
  onNavigate?: () => void;
}) {
  const streaming = answer.status === 'streaming';
  const showBubble = answer.text !== '' || streaming || answer.status === 'stopped';
  const finished = answer.status === 'done';
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden="true" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-sm ring-2 ring-white">
        <AssistantMascot busy={streaming} className="size-7" />
      </span>
      <div className="flex min-w-0 max-w-[92%] flex-col gap-2">
        {showBubble && (
          <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 shadow-sm ring-1 ring-slate-200/80">
            <span className="sr-only">Assistant: </span>
            {answer.text && <MessageText text={answer.text} />}
            {streaming && !answer.text && (
              // Before the first words: "typing" dots, with what the assistant is doing when it says so.
              <p className="flex items-center gap-2.5 text-slate-600">
                <TypingDots />
                {answer.statusText}
              </p>
            )}
            {streaming && answer.text && answer.statusText && (
              <p className="mt-1.5 flex items-center gap-2 text-slate-600">
                <Loader2 className="size-4 shrink-0 animate-spin text-role-600" aria-hidden="true" />
                {answer.statusText}
              </p>
            )}
            {streaming && !answer.text && <SlowHint />}
            {answer.status === 'stopped' && (
              <p className={answer.text ? 'mt-1.5 text-xs text-slate-600' : 'text-xs text-slate-600'}>
                {answer.text ? 'You stopped this answer.' : 'You stopped this answer before it started.'}
              </p>
            )}
          </div>
        )}
        {answer.blocks.length > 0 && <AnswerBlocks blocks={answer.blocks} />}
        {finished && answer.actions.length > 0 && <AnswerActions actions={answer.actions} onNavigate={onNavigate} />}
        {answer.status === 'error' && answer.error && (
          <div className="flex flex-col items-start gap-2.5 rounded-2xl rounded-tl-md bg-danger-50 px-4 py-3 text-sm text-danger-700 shadow-xs ring-1 ring-danger-200">
            <p className="flex gap-2.5">
              <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-danger-600 ring-1 ring-danger-200">
                <AlertCircle className="size-4" />
              </span>
              <span className="pt-0.5">{answer.error.message}</span>
            </p>
            {answer.error.retryable && (
              <Button variant="secondary" size="sm" onClick={() => onRetry(answer.id)} disabled={busy}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            )}
          </div>
        )}
        {finished && answer.text && <CopyAnswer text={answer.text} />}
        {answer.status === 'done' && answer.sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-600">Based on:</span>
            <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
              {answer.sources.map((source) => (
                <li key={source.tool} className="rounded-full bg-role-50 px-2 py-0.5 font-medium text-role-700 ring-1 ring-role-200">
                  {source.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        {answer.status === 'done' && !answer.grounded && (
          <p className="flex gap-1.5 text-xs text-slate-600">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-role-600" aria-hidden="true" />
            Part of the first answer couldn't be checked against your data, so a checked answer is shown instead.
          </p>
        )}
      </div>
    </div>
  );
}

/** "Copy answer": the text of the answer to the clipboard, with a short "Copied" (hidden where copying is not possible). */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return null;
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}
      className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {copied ? <Check className="size-3.5 text-success-600" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy answer'}
    </button>
  );
}

/** Three dots that rise one after another (still under reduced motion). */
function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex h-4 shrink-0 items-center gap-1">
      {[0, 160, 320].map((delay) => (
        <span key={delay} className="size-1.5 rounded-full bg-role-500 animate-typing" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

/** "This can take up to a minute": shown only when the first words are slow to come. */
function SlowHint() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <p className="mt-1.5 flex gap-1.5 text-xs text-slate-600">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      The assistant runs on our own servers, so an answer can take up to a minute.
    </p>
  );
}
