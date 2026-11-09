import { useId, useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { ArrowUp, Loader2, Mic, Square, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/cn';
import type { VoiceInput } from './voice/useVoiceInput';
import type { VoiceInputMode, VoiceOutputMode } from './voice/voiceSupport';

/** The input grows with the text up to this height, then scrolls. */
const MAX_INPUT_HEIGHT = 160;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  maxLength: number;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  micRef: RefObject<HTMLButtonElement | null>;
  inputMode: VoiceInputMode;
  voice: VoiceInput;
  maxAudioSeconds: number;
  onMic: () => void;
  handsFree: boolean;
  /** Maximized: a centred column of a readable width. */
  wide?: boolean;
}

/** Round icon buttons of the question box (send, stop, microphone). */
const ROUND_BUTTON = cn(
  'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,color,box-shadow,scale] duration-(--duration-fast) ease-out-soft',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-600 active:scale-95',
  'disabled:cursor-not-allowed disabled:active:scale-100',
);

/** The question box: grows with the text, Enter sends, Shift+Enter adds a line; Stop while an answer streams. */
export function Composer({
  value, onChange, onSend, onStop, busy, maxLength, placeholder, textareaRef, micRef, inputMode, voice, maxAudioSeconds, onMic, handsFree,
  wide = false,
}: ComposerProps) {
  const inputId = useId();
  const hintId = useId();
  const counterId = useId();
  const showCounter = value.length >= maxLength * 0.8;
  const listening = voice.status === 'recording' || voice.status === 'starting';
  const transcribing = voice.status === 'transcribing';

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Empty: one line (a long placeholder must not make it taller).
      textarea.style.height = 'auto';
      textarea.style.height = value === '' ? '' : `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    }
  }, [value, textareaRef]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <form onSubmit={submit} className="border-t border-slate-200/80 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
      <div className={cn(wide && 'mx-auto w-full max-w-3xl')}>
        {(listening || transcribing) && (
          <div
            className={cn(
              'mb-2 flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm ring-1',
              transcribing ? 'bg-role-50 text-role-800 ring-role-200' : 'bg-danger-50 text-danger-700 ring-danger-200',
            )}
          >
            {transcribing ? (
              <>
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                <span className="font-semibold">Turning your voice into text…</span>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="relative flex size-3 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-danger-500 animate-pulse-ring" />
                  <span className="relative size-3 rounded-full bg-danger-600" />
                </span>
                <span className="shrink-0 font-semibold">{inputMode === 'server' ? 'Recording' : 'Listening'}</span>
                {inputMode === 'server' && (
                  <span className="shrink-0 tabular-nums">
                    <span aria-hidden="true">{clock(voice.seconds)} / {clock(maxAudioSeconds)}</span>
                    <span className="sr-only">{`${Math.floor(voice.seconds)} of ${maxAudioSeconds} seconds`}</span>
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-slate-700">{voice.interim}</span>
                <Button variant="ghost" size="sm" aria-label="Cancel recording" className="ml-auto text-danger-700 hover:bg-danger-100" onClick={voice.cancel}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}

        <div className="flex items-end gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shadow-inner shadow-slate-900/[0.03] transition-[border-color,box-shadow,background-color] duration-(--duration-fast) focus-within:border-role-400 focus-within:bg-white focus-within:shadow-none focus-within:ring-4 focus-within:ring-role-500/15">
          {inputMode !== 'none' && (
            <button
              ref={micRef}
              type="button"
              aria-label={listening ? 'Stop recording' : handsFree ? 'Ask by voice (sent when you stop talking)' : 'Ask by voice'}
              onClick={onMic}
              disabled={transcribing || voice.status === 'starting' || (busy && handsFree)}
              className={cn(
                ROUND_BUTTON,
                listening
                  ? 'bg-danger-600 text-white shadow-md shadow-danger-600/30 hover:bg-danger-700'
                  : 'text-role-700 hover:bg-role-50 disabled:text-slate-400 disabled:hover:bg-transparent',
              )}
            >
              {listening ? <Square className="size-4 fill-current" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
            </button>
          )}
          <label htmlFor={inputId} className="sr-only">Your question</label>
          <textarea
            ref={textareaRef}
            id={inputId}
            rows={1}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby={showCounter ? `${hintId} ${counterId}` : hintId}
            className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-6 text-slate-900 placeholder:text-slate-500 focus-visible:outline-none"
          />
          {busy ? (
            <button type="button" aria-label="Stop the answer" onClick={onStop} className={cn(ROUND_BUTTON, 'bg-slate-900 text-white shadow-md hover:bg-slate-700')}>
              <Square className="size-3.5 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={value.trim() === ''}
              className={cn(
                ROUND_BUTTON,
                'bg-[linear-gradient(135deg,var(--role-500),var(--role-700))] text-white shadow-md shadow-role-600/30 hover:shadow-lg',
                'disabled:bg-none disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none',
              )}
            >
              <ArrowUp className="size-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-xs text-slate-600">
          <span id={hintId} className="max-sm:sr-only">Enter to send, Shift+Enter for a new line</span>
          {showCounter && (
            <span id={counterId} className={cn('ml-auto tabular-nums', value.length >= maxLength && 'font-semibold text-danger-700')}>
              {value.length} / {maxLength} characters
            </span>
          )}
        </div>
      </div>
    </form>
  );
}

/** Read aloud, voice conversation, the browser-speech note and voice errors. */
export function VoiceOptions({
  inputMode, outputMode, readAloud, onReadAloud, handsFree, onHandsFree, speaking, onStopSpeaking, errors, wide = false,
}: {
  inputMode: VoiceInputMode;
  outputMode: VoiceOutputMode;
  readAloud: boolean;
  onReadAloud: (value: boolean) => void;
  handsFree: boolean;
  onHandsFree: (value: boolean) => void;
  speaking: boolean;
  onStopSpeaking: () => void;
  errors: string[];
  wide?: boolean;
}) {
  const readAloudId = useId();
  const handsFreeId = useId();
  const usesBrowser = inputMode === 'browser' || outputMode === 'browser';
  if (inputMode === 'none' && outputMode === 'none') {
    return null;
  }
  return (
    <div className={cn('flex flex-col gap-1.5 border-t border-slate-100 bg-white px-4 pb-3 pt-2 text-xs text-slate-700', wide && 'sm:px-[max(1rem,calc((100%-48rem)/2))]')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {outputMode !== 'none' && (
          <label className="flex cursor-pointer items-center gap-2">
            <Switch checked={readAloud || handsFree} disabled={handsFree} onCheckedChange={onReadAloud} aria-labelledby={readAloudId} />
            <span id={readAloudId}>Read answers aloud</span>
          </label>
        )}
        {inputMode !== 'none' && (
          <label className="flex cursor-pointer items-center gap-2">
            <Switch checked={handsFree} onCheckedChange={onHandsFree} aria-labelledby={handsFreeId} />
            <span id={handsFreeId}>Voice conversation</span>
          </label>
        )}
        {speaking && (
          <Button variant="secondary" size="sm" onClick={onStopSpeaking} className="ml-auto">
            <VolumeX className="size-4" aria-hidden="true" />
            Stop reading
          </Button>
        )}
      </div>
      {handsFree && (
        <p className="text-slate-600">
          Tap the microphone and ask. Your question is sent when you stop talking, and the answer is read aloud.
        </p>
      )}
      {usesBrowser && (
        <p className="text-slate-600">
          Voice uses your browser's speech service, which may send the audio to its provider (in Chrome: Google).
        </p>
      )}
      {errors.map((error) => (
        <p key={error} role="alert" className="font-medium text-danger-700">{error}</p>
      ))}
    </div>
  );
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
