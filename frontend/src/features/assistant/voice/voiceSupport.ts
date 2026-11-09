/**
 * Which voice path the panel uses (AI_ASSISTANT.md §9):
 * - `server`: the app's own speech server (compose profile `voice`), through `/api/assistant/voice/*`; audio stays
 *   on our machines;
 * - `browser`: the browser's Web Speech API (`SpeechRecognition` / `speechSynthesis`), when the server's voice is
 *   off. Its speech service may send the audio to its provider (Chrome: Google), so the panel says so;
 * - `none`: the microphone (or "read aloud") is hidden.
 * Everything is feature-detected; nothing is assumed from the browser's name.
 */
export type VoiceInputMode = 'server' | 'browser' | 'none';
export type VoiceOutputMode = 'server' | 'browser' | 'none';

export interface BrowserVoiceSupport {
  /** `MediaRecorder` and `navigator.mediaDevices.getUserMedia` (records audio for the speech server). */
  mediaRecorder: boolean;
  /** `SpeechRecognition` or `webkitSpeechRecognition`. */
  speechRecognition: boolean;
  /** `speechSynthesis` and `SpeechSynthesisUtterance`. */
  speechSynthesis: boolean;
  /** `Audio` and `URL.createObjectURL` (plays the speech server's MP3). */
  audio: boolean;
}

type VoiceGlobals = Partial<{
  MediaRecorder: unknown;
  SpeechRecognition: unknown;
  webkitSpeechRecognition: unknown;
  speechSynthesis: unknown;
  SpeechSynthesisUtterance: unknown;
  Audio: unknown;
  URL: { createObjectURL?: unknown };
  navigator: { mediaDevices?: { getUserMedia?: unknown } };
}>;

export function detectVoiceSupport(scope: VoiceGlobals = globalThis as VoiceGlobals): BrowserVoiceSupport {
  return {
    mediaRecorder: typeof scope.MediaRecorder === 'function' && typeof scope.navigator?.mediaDevices?.getUserMedia === 'function',
    speechRecognition: typeof (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) === 'function',
    speechSynthesis: typeof scope.speechSynthesis === 'object' && scope.speechSynthesis !== null
      && typeof scope.SpeechSynthesisUtterance === 'function',
    audio: typeof scope.Audio === 'function' && typeof scope.URL?.createObjectURL === 'function',
  };
}

/** The server's voice wins when it is on and the browser can record or play; otherwise the browser's own speech. */
export function chooseVoiceModes(
  server: { transcription: boolean; speech: boolean },
  support: BrowserVoiceSupport,
): { input: VoiceInputMode; output: VoiceOutputMode } {
  const input: VoiceInputMode = server.transcription && support.mediaRecorder ? 'server' : support.speechRecognition ? 'browser' : 'none';
  const output: VoiceOutputMode = server.speech && support.audio ? 'server' : support.speechSynthesis ? 'browser' : 'none';
  return { input, output };
}

/** Recording formats the speech server accepts (checked from the bytes), best first. */
export const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'] as const;

/** The first format this browser can record, or undefined for the browser's default. */
export function chooseRecordingType(isTypeSupported: ((type: string) => boolean) | undefined): string | undefined {
  if (typeof isTypeSupported !== 'function') {
    return undefined;
  }
  return RECORDING_TYPES.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/** A file name for the upload (the server goes by the bytes; the name only helps reading logs). */
export function recordingFileName(mimeType: string): string {
  const type = mimeType.toLowerCase();
  if (type.includes('ogg')) return 'question.ogg';
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return 'question.m4a';
  if (type.includes('wav')) return 'question.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'question.mp3';
  return 'question.webm';
}
