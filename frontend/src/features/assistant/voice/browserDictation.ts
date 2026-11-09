import { RecorderError, type RecorderErrorKind } from './recorder';

/**
 * The browser's own speech recognition (Web Speech API), used when the server's speech-to-text is off. It listens
 * for one utterance and stops by itself after a pause (`continuous = false`), or at the time limit.
 */

/** The parts of `SpeechRecognition` we use (not in TypeScript's DOM types). */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

export function speechRecognitionConstructor(): RecognitionConstructor | null {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** SpeechRecognition `error` codes → what to tell the user; null = ignore (our own abort). */
export function dictationErrorKind(code: string): RecorderErrorKind | 'network' | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'audio-capture':
      return 'no-device';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'aborted':
      return null;
    default:
      return 'failed';
  }
}

export const DICTATION_NETWORK_MESSAGE = "Your browser's speech service can't be reached. Please type your question.";

export interface DictationCallbacks {
  onStart?: () => void;
  /** The words so far (not final yet). */
  onInterim?: (text: string) => void;
  /** The final text, or why it failed. Called once (not after cancel). */
  onFinished: (result: { text: string } | { error: string }) => void;
}

export class BrowserDictation {
  private recognition: SpeechRecognitionLike | null = null;
  private finalText = '';
  private interimText = '';
  private failure: string | null = null;
  private done = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly Recognition: RecognitionConstructor,
    private readonly options: { lang: string; maxSeconds: number },
    private readonly callbacks: DictationCallbacks,
  ) {}

  start(): void {
    const recognition = new this.Recognition();
    this.recognition = recognition;
    recognition.lang = this.options.lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => this.callbacks.onStart?.();
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) {
          this.finalText = `${this.finalText} ${result[0].transcript}`.trim();
        } else {
          interim += result[0].transcript;
        }
      }
      this.interimText = interim.trim();
      this.callbacks.onInterim?.(`${this.finalText} ${this.interimText}`.trim());
    };
    recognition.onerror = (event) => {
      const kind = dictationErrorKind(event.error);
      if (kind) {
        this.failure = kind === 'network' ? DICTATION_NETWORK_MESSAGE : new RecorderError(kind).message;
      }
    };
    recognition.onend = () => this.finish();
    try {
      recognition.start();
    } catch {
      this.failure = new RecorderError('failed').message;
      this.finish();
      return;
    }
    this.timer = setTimeout(() => this.stop(), this.options.maxSeconds * 1000);
  }

  /** Stop listening; the words heard so far are delivered. */
  stop(): void {
    this.clearTimer();
    try {
      this.recognition?.stop();
    } catch {
      this.finish();
    }
  }

  /** Stop without delivering anything. */
  cancel(): void {
    this.done = true;
    this.clearTimer();
    try {
      this.recognition?.abort();
    } catch {
      // Not started.
    }
  }

  private finish(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.clearTimer();
    const text = `${this.finalText} ${this.interimText}`.trim();
    if (text) {
      this.callbacks.onFinished({ text });
    } else {
      this.callbacks.onFinished({ error: this.failure ?? new RecorderError('no-speech').message });
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
