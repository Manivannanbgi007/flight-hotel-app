import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/apiError';
import { assistantApi } from '../assistantApi';
import type { AssistantLimits } from '../types';
import { BrowserDictation, speechRecognitionConstructor } from './browserDictation';
import { browserRecorderDeps, RECORDER_MESSAGES, RecorderError, VoiceRecorder, type Recording, type RecorderDeps } from './recorder';
import { recordingFileName, type VoiceInputMode } from './voiceSupport';

export type VoiceInputStatus = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface UseVoiceInputOptions {
  mode: VoiceInputMode;
  limits: AssistantLimits;
  /** The recognised text (to put into the input, or to send in voice conversation mode). */
  onText: (text: string) => void;
  /** The speech server answered 503 VOICE_UNAVAILABLE: use the browser's speech from now on. */
  onServerUnavailable: () => void;
  /** For tests. */
  recorderDeps?: () => RecorderDeps;
}

export interface VoiceInput {
  status: VoiceInputStatus;
  /** Seconds recorded (speech server path). */
  seconds: number;
  /** Words heard so far (browser path). */
  interim: string;
  error: string | null;
  start: () => Promise<void>;
  /** Stop and use what was said. */
  stop: () => void;
  /** Stop and throw it away (closing the panel, Cancel). */
  cancel: () => void;
  clearError: () => void;
}

interface Active {
  stop: () => void;
  cancel: () => void;
}

/** Speech to text for the composer: records for the speech server, or uses the browser's recognition. */
export function useVoiceInput({ mode, limits, onText, onServerUnavailable, recorderDeps = browserRecorderDeps }: UseVoiceInputOptions): VoiceInput {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<Active | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const callbacks = useRef({ onText, onServerUnavailable });
  useEffect(() => {
    callbacks.current = { onText, onServerUnavailable };
  });

  const transcribe = useCallback(async (recording: Recording) => {
    const controller = new AbortController();
    uploadRef.current = controller;
    setStatus('transcribing');
    try {
      const text = await assistantApi.transcribe(recording.blob, recordingFileName(recording.mimeType), controller.signal);
      if (controller.signal.aborted) return;
      if (text) {
        callbacks.current.onText(text);
      } else {
        setError(RECORDER_MESSAGES['no-speech']);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const problem = ApiError.from(cause);
      if (problem.code === 'VOICE_UNAVAILABLE' || problem.status === 503) {
        callbacks.current.onServerUnavailable();
        setError('Voice input is unavailable right now. Tap the microphone to try again, or type your question.');
      } else if (problem.status === 0) {
        setError("Can't reach the server to turn your voice into text. Please type your question.");
      } else {
        // 400 EMPTY_AUDIO, 413 FILE_TOO_LARGE, 415 UNSUPPORTED_AUDIO, 422 AUDIO_TOO_LONG: the server's text is friendly.
        setError(problem.message);
      }
    } finally {
      if (uploadRef.current === controller) {
        uploadRef.current = null;
        setStatus('idle');
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current || uploadRef.current) {
      return;
    }
    setError(null);
    setSeconds(0);
    setInterim('');
    if (mode === 'server') {
      const recorder: VoiceRecorder = new VoiceRecorder(
        recorderDeps(),
        { maxSeconds: limits.maxAudioSeconds, maxBytes: limits.maxAudioBytes },
        {
          onTick: (value) => setSeconds(value),
          onFinished: (result) => {
            if (activeRef.current !== recorder) return;
            activeRef.current = null;
            if (result instanceof RecorderError) {
              setStatus('idle');
              setError(result.message);
            } else {
              void transcribe(result);
            }
          },
        },
      );
      activeRef.current = recorder;
      setStatus('starting');
      try {
        await recorder.start();
        if (activeRef.current === recorder) setStatus('recording');
      } catch (cause) {
        if (activeRef.current === recorder) {
          activeRef.current = null;
          setStatus('idle');
          setError(cause instanceof RecorderError ? cause.message : RECORDER_MESSAGES.failed);
        }
      }
      return;
    }
    const Recognition = mode === 'browser' ? speechRecognitionConstructor() : null;
    if (!Recognition) {
      setError(RECORDER_MESSAGES.unsupported);
      return;
    }
    const dictation: BrowserDictation = new BrowserDictation(
      Recognition,
      { lang: navigator.language || 'en-IN', maxSeconds: limits.maxAudioSeconds },
      {
        onStart: () => {
          if (activeRef.current === dictation) setStatus('recording');
        },
        onInterim: (text) => setInterim(text),
        onFinished: (result) => {
          if (activeRef.current !== dictation) return;
          activeRef.current = null;
          setStatus('idle');
          setInterim('');
          if ('text' in result) {
            callbacks.current.onText(result.text);
          } else {
            setError(result.error);
          }
        },
      },
    );
    activeRef.current = dictation;
    setStatus('starting');
    dictation.start();
  }, [mode, limits.maxAudioSeconds, limits.maxAudioBytes, recorderDeps, transcribe]);

  const stop = useCallback(() => {
    activeRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    const upload = uploadRef.current;
    activeRef.current = null;
    uploadRef.current = null;
    active?.cancel();
    upload?.abort();
    if (active || upload) {
      setStatus('idle');
      setInterim('');
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => () => {
    activeRef.current?.cancel();
    uploadRef.current?.abort();
  }, []);

  return { status, seconds, interim, error, start, stop, cancel, clearError };
}
