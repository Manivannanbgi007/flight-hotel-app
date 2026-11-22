import { RecorderError } from './recorder';

/**
 * The browser's own speech recognition (Web Speech API), used when the server's speech-to-text is off. It listens
 * for one utterance and stops by itself after a pause (`continuous = false`), or at the time limit.
 */

export function speechRecognitionConstructor() {
  const scope = globalThis;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** SpeechRecognition `error` codes → what to tell the user; null = ignore (our own abort). */
export function dictationErrorKind(code) {
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

export class BrowserDictation {
  recognition = null;
  finalText = '';
  interimText = '';
  failure = null;
  done = false;
  timer = null;

  constructor(Recognition, options, callbacks) {
    this.Recognition = Recognition;
    this.options = options;
    this.callbacks = callbacks;
  }

  start() {
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
        const result = event.results[i];
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
  stop() {
    this.clearTimer();
    try {
      this.recognition?.stop();
    } catch {
      this.finish();
    }
  }

  /** Stop without delivering anything. */
  cancel() {
    this.done = true;
    this.clearTimer();
    try {
      this.recognition?.abort();
    } catch {
      // Not started.
    }
  }

  finish() {
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

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
