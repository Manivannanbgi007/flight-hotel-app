import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, Info, Maximize2, Minimize2, Minus, RotateCcw, SquarePen } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { AssistantMascot } from './AssistantMascot';
import { Tooltip } from '@/components/ui/Tooltip';
import { queryKeys } from '@/lib/api/queryKeys';
import type { AuthUser } from '@/lib/auth/types';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { Composer, VoiceOptions } from './Composer';
import { MessageList } from './MessageList';
import { ASSISTANT_PANEL_ID, panelFrameClass, type PanelSize } from './panelFrame';
import { assistantRoleOf, PLACEHOLDERS, SUGGESTIONS, type AssistantRole, type Suggestion } from './suggestions';
import type { AssistantConfig } from './types';
import { useMediaQuery, useStoredFlag } from './uiHooks';
import { useAssistantChat } from './useAssistantChat';
import { useSpeechOutput } from './voice/useSpeechOutput';
import { useVoiceInput } from './voice/useVoiceInput';
import { chooseVoiceModes, detectVoiceSupport } from './voice/voiceSupport';

export interface AssistantPanelProps {
  open: boolean;
  /** Minimize: hide the panel (the conversation and a running answer are kept). */
  onClose: () => void;
  size: PanelSize;
  onSizeChange: (size: PanelSize) => void;
  config: AssistantConfig;
  user: AuthUser;
  /** Whether an answer is being written (the launcher shows it while the panel is closed). */
  onActivity: (busy: boolean) => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const INTRO: Record<AssistantRole, string> = {
  customer: 'Ask about your trips, bookings, payments and support tickets, or look up hotels, flights and offers.',
  admin: 'Ask about bookings, payments, refunds and revenue.',
  manager: "Ask about your hotels' arrivals, departures, reservations and occupancy.",
  support: "Ask about the ticket queue and customers' bookings.",
};

/**
 * The chat panel (loaded on first use): a labelled dialog. Normal: docked bottom-right on larger screens. Maximized:
 * the whole window (the messages and the question box in a centred column). Phones: a full-screen sheet. Maximized and
 * on phones it is modal (focus stays inside). Minimize (the header button, Escape or the launcher) hides it and gives
 * the focus back to the launcher; it stays mounted, so the conversation and a running answer are kept.
 */
export default function AssistantPanel({ open, onClose, size, onSizeChange, config, user, onActivity }: AssistantPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const role = assistantRoleOf(user);
  const isPhone = useMediaQuery('(max-width: 639.98px)');
  const maximized = size === 'maximized' && !isPhone;
  const modal = isPhone || maximized;
  const reducedMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const recheck = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.assistant.config });
  }, [queryClient]);

  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [input, setInput] = useState('');
  const maxLength = config.limits.maxMessageLength;

  // ---- Voice: the server's speech when it runs, else the browser's; hidden when neither works ----
  const support = useMemo(() => detectVoiceSupport(), []);
  const [serverVoiceDown, setServerVoiceDown] = useState({ transcription: false, speech: false });
  const modes = chooseVoiceModes(
    { transcription: config.voice.transcription && !serverVoiceDown.transcription, speech: config.voice.speech && !serverVoiceDown.speech },
    support,
  );
  const [readAloud, setReadAloud] = useStoredFlag('fh.assistant.readAloud', false);
  const [handsFree, setHandsFree] = useState(false);
  const speech = useSpeechOutput({
    mode: modes.output,
    maxChars: config.limits.maxSpeechChars,
    onServerUnavailable: () => {
      setServerVoiceDown((down) => ({ ...down, speech: true }));
      recheck();
    },
  });

  // Callbacks of the chat and the recorder run later (after an answer, after a recording): they read the latest values.
  const latest = useRef<{ open: boolean; readAloud: boolean; handsFree: boolean; speech: typeof speech; send: (text: string) => boolean }>(
    { open, readAloud, handsFree, speech, send: () => false },
  );
  const chat = useAssistantChat({
    userId: user.id,
    maxMessageLength: maxLength,
    onUnavailable: recheck,
    onAnswer: ({ text }) => {
      const now = latest.current;
      if (!now.open) return;
      if (now.readAloud || now.handsFree) {
        void now.speech.speak(text).then(() => {
          // Voice conversation: ready for the next turn (one tap on the microphone; never listening by itself).
          if (latest.current.handsFree && latest.current.open) micRef.current?.focus();
        });
      }
    },
  });
  useEffect(() => {
    latest.current = { open, readAloud, handsFree, speech, send: chat.send };
  });

  const voice = useVoiceInput({
    mode: modes.input,
    limits: config.limits,
    onServerUnavailable: () => {
      setServerVoiceDown((down) => ({ ...down, transcription: true }));
      recheck();
    },
    onText: (text) => {
      const clipped = text.slice(0, maxLength);
      if (latest.current.handsFree) {
        latest.current.speech.stop();
        if (latest.current.send(clipped)) return;
      }
      // For the user to check, then send.
      setInput((current) => (current.trim() ? `${current.trimEnd()} ${clipped}` : clipped).slice(0, maxLength));
      textareaRef.current?.focus();
    },
  });

  const send = (text: string) => {
    speech.stop();
    if (chat.send(text)) {
      setInput('');
    }
  };

  const onMic = () => {
    if (voice.status === 'recording') {
      voice.stop();
      return;
    }
    speech.stop();
    void voice.start();
  };

  const onSuggestion = (suggestion: Suggestion) => {
    if (suggestion.send) {
      send(suggestion.prompt);
      return;
    }
    setInput(suggestion.prompt);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      // The caret after the prompt, where the reference or the dates go.
      requestAnimationFrame(() => textarea.setSelectionRange(suggestion.prompt.length, suggestion.prompt.length));
    }
  };

  const newChat = () => {
    speech.stop();
    voice.cancel();
    chat.newChat();
    setInput('');
    textareaRef.current?.focus();
  };

  // Opening: focus the question box (on phones the sheet itself, so the keyboard does not cover the suggestions).
  // Closing: stop reading aloud and recording (never keep the microphone).
  const current = useRef({ speech, voice, isPhone });
  useEffect(() => {
    current.current = { speech, voice, isPhone };
  });
  useEffect(() => {
    if (open) {
      (current.current.isPhone ? rootRef.current : textareaRef.current ?? closeRef.current)?.focus();
    } else {
      current.current.speech.stop();
      current.current.voice.cancel();
    }
  }, [open]);

  useEffect(() => {
    onActivity(chat.busy);
  }, [chat.busy, open, onActivity]);

  // Maximize / restore: a short settle animation, so the jump in size reads as one panel growing or shrinking.
  const previousSize = useRef(size);
  useEffect(() => {
    if (previousSize.current === size) return;
    previousSize.current = size;
    const root = rootRef.current;
    if (open && root && !reducedMotion && typeof root.animate === 'function') {
      root.animate(
        [{ opacity: 0.6, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
  }, [size, open, reducedMotion]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.stopPropagation();
      onClose();
      return;
    }
    // Full-screen on phones and maximized (modal): Tab stays inside the panel.
    if (event.key === 'Tab' && modal && rootRef.current) {
      const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  const voiceErrors = [voice.error, speech.error].filter((error): error is string => !!error);

  return (
    <div
      ref={rootRef}
      id={ASSISTANT_PANEL_ID}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      hidden={!open}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        panelFrameClass(size),
        'animate-fade-in focus:outline-none sm:animate-scale-in',
        maximized ? 'sm:origin-center' : 'sm:origin-bottom-right',
      )}
    >
      <header className="relative z-10 flex shrink-0 items-center gap-3 bg-[linear-gradient(135deg,var(--role-600),var(--role-800))] px-4 py-3 text-white sm:px-5">
        {/* Soft light in the corner, for depth (clipped on its own layer, so the buttons' hints can hang below). */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute -right-10 -top-16 size-44 rounded-full bg-white/10 blur-2xl" />
        </span>
        <span aria-hidden="true" className="relative flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/25">
          <AssistantMascot busy={chat.busy} className="size-8" />
          {config.enabled && (
            <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-success-500 ring-2 ring-[var(--role-700)]" />
          )}
        </span>
        <div className="relative min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-base font-bold leading-tight">AI assistant</h2>
          <p id={descriptionId} className="truncate text-xs font-medium leading-tight text-white/85">
            {config.model ? `Model: ${config.model}` : 'Looks things up, changes nothing'}
          </p>
        </div>
        <div className="relative flex shrink-0 items-center gap-0.5">
          {config.enabled && (
            <button
              type="button"
              onClick={newChat}
              disabled={chat.messages.length === 0 && !chat.restoring && input === ''}
              className={cn(HEADER_BUTTON, 'gap-1.5 px-2.5 text-sm font-semibold disabled:opacity-60')}
            >
              <SquarePen className="size-4" aria-hidden="true" />
              New chat
            </button>
          )}
          {!isPhone && (
            <HeaderTip content={maximized ? 'Restore size' : 'Maximize'}>
              <button
                type="button"
                onClick={() => onSizeChange(maximized ? 'normal' : 'maximized')}
                aria-label={maximized ? 'Restore the assistant to its normal size' : 'Maximize the assistant'}
                className={cn(HEADER_BUTTON, 'size-9')}
              >
                {maximized ? <Minimize2 className="size-[1.1rem]" aria-hidden="true" /> : <Maximize2 className="size-[1.1rem]" aria-hidden="true" />}
              </button>
            </HeaderTip>
          )}
          <HeaderTip content="Minimize">
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Minimize the assistant" className={cn(HEADER_BUTTON, 'size-9')}>
              <Minus className="size-5" aria-hidden="true" />
            </button>
          </HeaderTip>
        </div>
      </header>

      {config.enabled ? (
        <>
          <MessageList
            messages={chat.messages}
            open={open}
            busy={chat.busy}
            restoring={chat.restoring}
            restoreFailed={chat.restoreFailed}
            onRetryRestore={chat.retryRestore}
            onRetry={(answerId) => {
              speech.stop();
              chat.retry(answerId);
            }}
            intro={<Intro user={user} role={role} onSuggestion={onSuggestion} />}
            wide={maximized}
            // After a button opened a page, a maximized panel returns to its normal size so the page can be seen.
            onNavigate={() => {
              if (maximized) onSizeChange('normal');
            }}
          />
          <Composer
            wide={maximized}
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onStop={chat.stop}
            busy={chat.busy}
            maxLength={maxLength}
            placeholder={PLACEHOLDERS[role]}
            textareaRef={textareaRef}
            micRef={micRef}
            inputMode={modes.input}
            voice={voice}
            maxAudioSeconds={config.limits.maxAudioSeconds}
            onMic={onMic}
            handsFree={handsFree}
          />
          <VoiceOptions
            wide={maximized}
            inputMode={modes.input}
            outputMode={modes.output}
            readAloud={readAloud}
            onReadAloud={(value) => {
              setReadAloud(value);
              if (!value) speech.stop();
            }}
            handsFree={handsFree}
            onHandsFree={(value) => {
              setHandsFree(value);
              if (!value) speech.stop();
            }}
            speaking={speech.speaking}
            onStopSpeaking={speech.stop}
            errors={voiceErrors}
          />
        </>
      ) : (
        <Unavailable onRecheck={recheck} />
      )}

      {/* Screen readers: status lines, whole sentences of the answer as they complete, errors. */}
      <div aria-live="polite" className="sr-only">
        {chat.announcement && <p key={chat.announcement.id}>{chat.announcement.text}</p>}
      </div>
    </div>
  );
}

const HEADER_BUTTON = cn(
  'inline-flex h-9 shrink-0 items-center justify-center rounded-xl text-white transition-colors duration-(--duration-fast)',
  'hover:bg-white/15 focus-visible:outline-white',
);

/** A hint under a header icon button (below it: the header is at the top of the panel). */
function HeaderTip({ content, children }: { content: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  return (
    <Tooltip content={content} side="bottom">
      {children}
    </Tooltip>
  );
}

function Intro({ user, role, onSuggestion }: { user: AuthUser; role: AssistantRole; onSuggestion: (suggestion: Suggestion) => void }) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-md">
          <AssistantMascot className="size-9" />
        </span>
        <div>
          <h3 className="text-base font-bold text-slate-900">Hi {user.firstName}, how can I help?</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{INTRO[role]}</p>
        </div>
      </div>
      <p className="flex gap-2 rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
        <Info className="mt-px size-3.5 shrink-0 text-role-600" aria-hidden="true" />
        The assistant can look things up; changes such as cancelling or paying are made on the pages. It answers only
        from the app's data.
      </p>
      <div>
        <h4 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-slate-600">Try asking</h4>
        <ul aria-labelledby={headingId} className="mt-2 flex flex-wrap gap-2">
          {SUGGESTIONS[role].map((suggestion) => (
            <li key={suggestion.label}>
              <button
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className="rounded-full border border-role-200 bg-white px-3 py-1.5 text-left text-sm font-medium text-role-700 shadow-xs transition-colors hover:border-role-300 hover:bg-role-50"
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Unavailable({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <CloudOff className="size-6" />
      </span>
      <h3 className="text-base font-bold text-slate-900">The assistant is unavailable right now</h3>
      <p className="max-w-xs text-sm leading-relaxed text-slate-600">
        It may be starting up or under maintenance. Everything else in the app works as usual. Please try again in a few
        minutes.
      </p>
      <Button variant="secondary" onClick={onRecheck}>
        <RotateCcw className="size-4" aria-hidden="true" />
        Check again
      </Button>
    </div>
  );
}
