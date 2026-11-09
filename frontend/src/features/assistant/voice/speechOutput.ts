import { plainText } from '../messageFormat';

/**
 * Reading answers aloud: with the speech server (MP3 from `/voice/speech`, played from a `blob:` URL; needs
 * `media-src blob:` in the CSP) or with the browser's `speechSynthesis`. Long answers are read in parts.
 */

/** At most this many parts are read (each ≤ the limit), so a very long answer cannot keep the speaker busy for long. */
const MAX_PARTS = 4;

/** Text as it should be spoken: no markers, amounts as words the voice reads well (`₹9,609.60` → `9609.60 rupees`). */
export function speakableText(text: string): string {
  return plainText(text)
    .replace(/(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)/g, (_, amount: string) => `${amount.replace(/,/g, '')} rupees`)
    .replace(/([^.!?:;,\s])\s*\n+/g, '$1. ')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/** Splits text into parts of at most `max` characters, at sentence ends where possible, else at a space. */
export function speechParts(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max && parts.length < MAX_PARTS) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    if (cut >= max * 0.4) {
      cut += 1;
    } else {
      cut = window.lastIndexOf(' ');
      if (cut <= 0) cut = max;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest && parts.length < MAX_PARTS) {
    parts.push(rest.slice(0, max));
  }
  return parts.filter(Boolean);
}

export interface SpeechPlayer {
  /** Resolves when everything was read or `stop()` was called; rejects when the voice failed. */
  play(parts: string[]): Promise<void>;
  stop(): void;
}

export interface ServerSpeechDeps {
  fetchSpeech: (text: string, signal: AbortSignal) => Promise<Blob>;
  createAudio?: (url: string) => HTMLAudioElement;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}

/** Plays the speech server's MP3 for each part; the next part is fetched while the current one plays. */
export class ServerSpeechPlayer implements SpeechPlayer {
  private stopped = false;
  private readonly abort = new AbortController();
  private current: { audio: HTMLAudioElement; url: string; done: () => void } | null = null;

  constructor(private readonly deps: ServerSpeechDeps) {}

  async play(parts: string[]): Promise<void> {
    let next: Promise<Blob> | null = parts[0] ? this.fetch(parts[0]) : null;
    for (let i = 0; i < parts.length && next && !this.stopped; i++) {
      const blob = await next;
      next = i + 1 < parts.length ? this.fetch(parts[i + 1]!) : null;
      if (this.stopped) break;
      await this.playBlob(blob);
    }
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    const current = this.current;
    this.current = null;
    if (current) {
      current.audio.pause();
      current.done();
    }
  }

  private fetch(text: string): Promise<Blob> {
    const promise = this.deps.fetchSpeech(text, this.abort.signal);
    promise.catch(() => undefined); // awaited later; never an unhandled rejection after stop()
    return promise;
  }

  private playBlob(blob: Blob): Promise<void> {
    const createUrl = this.deps.createUrl ?? ((value: Blob) => URL.createObjectURL(value));
    const revokeUrl = this.deps.revokeUrl ?? ((value: string) => URL.revokeObjectURL(value));
    const createAudio = this.deps.createAudio ?? ((value: string) => new Audio(value));
    return new Promise<void>((resolve, reject) => {
      const url = createUrl(blob);
      const audio = createAudio(url);
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (this.current?.audio === audio) this.current = null;
        audio.onended = null;
        audio.onerror = null;
        revokeUrl(url);
        if (error === undefined) resolve();
        else reject(error instanceof Error ? error : new Error('The answer could not be played.'));
      };
      this.current = { audio, url, done: () => settle() };
      audio.onended = () => settle();
      audio.onerror = () => settle(new Error('The answer could not be played.'));
      audio.play().catch((error: unknown) => settle(error ?? new Error('The answer could not be played.')));
    });
  }
}

export interface BrowserSpeechDeps {
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel'>;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  lang: string;
}

/** The browser's own voice (`speechSynthesis`); parts are queued so long answers are not cut off. */
export class BrowserSpeechPlayer implements SpeechPlayer {
  private finish: (() => void) | null = null;

  constructor(private readonly deps: BrowserSpeechDeps) {}

  play(parts: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (parts.length === 0) {
        resolve();
        return;
      }
      this.finish = resolve;
      this.deps.synth.cancel();
      parts.forEach((part, index) => {
        const utterance = this.deps.createUtterance(part);
        utterance.lang = this.deps.lang;
        if (index === parts.length - 1) {
          utterance.onend = () => resolve();
        }
        utterance.onerror = (event) => {
          // `interrupted` / `canceled`: stopped on purpose.
          if (event.error === 'interrupted' || event.error === 'canceled') resolve();
          else reject(new Error('The answer could not be read aloud.'));
        };
        this.deps.synth.speak(utterance);
      });
    });
  }

  stop(): void {
    this.deps.synth.cancel();
    this.finish?.();
    this.finish = null;
  }
}
