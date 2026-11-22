import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/apiError';
import { assistantApi } from '../assistantApi';
import { BrowserSpeechPlayer, ServerSpeechPlayer, speakableText, speechParts } from './speechOutput';

/** The browser's voices stop on long utterances in some browsers: shorter parts there. */
const BROWSER_PART_CHARS = 220;

/** Text to speech for finished answers: the speech server's MP3, or the browser's `speechSynthesis`. */
export function useSpeechOutput({ mode, maxChars, onServerUnavailable }) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState(null);
  const playerRef = useRef(null);
  const unavailable = useRef(onServerUnavailable);
  useEffect(() => {
    unavailable.current = onServerUnavailable;
  });

  const stop = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      player.stop();
      setSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    async (text) => {
      stop();
      const spoken = speakableText(text);
      if (mode === 'none' || !spoken) {
        return;
      }
      const player =
        mode === 'server'
          ? new ServerSpeechPlayer({ fetchSpeech: (part, signal) => assistantApi.speech(part, signal) })
          : new BrowserSpeechPlayer({
              synth: window.speechSynthesis,
              createUtterance: (part) => new SpeechSynthesisUtterance(part),
              lang: navigator.language || 'en-IN',
            });
      playerRef.current = player;
      setSpeaking(true);
      setError(null);
      try {
        await player.play(speechParts(spoken, mode === 'server' ? maxChars : BROWSER_PART_CHARS));
      } catch (cause) {
        if (playerRef.current === player) {
          // The API client turns every failed request into an ApiError.
          if (cause instanceof ApiError && (cause.code === 'VOICE_UNAVAILABLE' || cause.status === 503)) {
            unavailable.current();
          }
          setError("The answer couldn't be read aloud right now.");
        }
      } finally {
        if (playerRef.current === player) {
          playerRef.current = null;
          setSpeaking(false);
        }
      }
    },
    [mode, maxChars, stop],
  );

  useEffect(
    () => () => {
      playerRef.current?.stop();
      playerRef.current = null;
    },
    [],
  );

  return { speaking, error, speak, stop };
}
