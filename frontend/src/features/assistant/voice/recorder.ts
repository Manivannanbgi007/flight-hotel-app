import { createLevelMeter, SilenceDetector, type LevelMeter } from './silence';
import { chooseRecordingType } from './voiceSupport';

/**
 * Records one spoken question with `MediaRecorder` for the speech server, within the server's limits
 * (`config.limits.maxAudioSeconds` / `maxAudioBytes`): it stops by itself just before either is reached, after a
 * pause once the user has spoken, or when nothing is heard. The microphone is released as soon as it stops.
 */

export type RecorderErrorKind = 'denied' | 'no-device' | 'busy' | 'unsupported' | 'failed' | 'empty' | 'no-speech';

export class RecorderError extends Error {
  constructor(readonly kind: RecorderErrorKind) {
    super(RECORDER_MESSAGES[kind]);
    this.name = 'RecorderError';
  }
}

/** Friendly texts, also used for the browser's own speech recognition. */
export const RECORDER_MESSAGES: Record<RecorderErrorKind, string> = {
  denied: "Microphone access is blocked. Allow it for this site in your browser's settings, or type your question.",
  'no-device': 'No microphone was found. Connect one, or type your question.',
  busy: 'The microphone is being used by another app. Close it, or type your question.',
  unsupported: "This browser can't record audio. Please type your question.",
  failed: "The recording didn't work. Please try again or type your question.",
  empty: 'Nothing was recorded. Tap the microphone and try again.',
  'no-speech': "I didn't hear anything. Tap the microphone and try again.",
};

/** `getUserMedia` errors (DOMException names) → what to tell the user. */
export function recorderErrorOf(error: unknown): RecorderError {
  const name = error instanceof Error || (error && typeof error === 'object' && 'name' in error) ? String((error as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new RecorderError('denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return new RecorderError('no-device');
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return new RecorderError('busy');
  return new RecorderError('failed');
}

export type StopReason = 'user' | 'max-duration' | 'max-size' | 'silence';

export interface Recording {
  blob: Blob;
  mimeType: string;
  seconds: number;
  reason: StopReason;
}

export interface RecorderLimits {
  maxSeconds: number;
  maxBytes: number;
}

export interface RecorderDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported?: (type: string) => boolean;
  /** null = no automatic stop on silence (the user taps again). */
  createLevelMeter?: (stream: MediaStream) => LevelMeter | null;
  now?: () => number;
}

export interface RecorderCallbacks {
  /** Seconds recorded so far (a few times a second). */
  onTick?: (seconds: number) => void;
  /** The recording ended (any reason except cancel) or failed after it started. Called once. */
  onFinished: (result: Recording | RecorderError) => void;
}

/** Margins: stop a little before the server's limits (the last chunk arrives after `stop()`). */
const SECONDS_MARGIN = 0.5;
const BYTES_MARGIN = 0.9;
const TICK_MS = 200;

export function browserRecorderDeps(): RecorderDeps {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    createLevelMeter,
    now: () => performance.now(),
  };
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private meter: LevelMeter | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly chunks: Blob[] = [];
  private bytes = 0;
  private startedAt: number | null = null;
  private stopReason: StopReason = 'user';
  private finished = false;
  private cancelled = false;
  private readonly silence = new SilenceDetector();
  private readonly now: () => number;

  constructor(
    private readonly deps: RecorderDeps,
    private readonly limits: RecorderLimits,
    private readonly callbacks: RecorderCallbacks,
  ) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Asks for the microphone and starts. Rejects with a {@link RecorderError} (denied, no device, …). */
  async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (error) {
      throw recorderErrorOf(error);
    }
    if (this.cancelled) {
      stopTracks(stream);
      return;
    }
    this.stream = stream;
    const mimeType = chooseRecordingType(this.deps.isTypeSupported);
    try {
      this.recorder = this.deps.createRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    } catch {
      this.release();
      throw new RecorderError('unsupported');
    }
    const recorder = this.recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
        this.bytes += event.data.size;
        if (this.bytes >= this.limits.maxBytes * BYTES_MARGIN) {
          this.stop('max-size');
        }
      }
    };
    recorder.onstop = () => this.finish();
    recorder.onerror = () => this.fail(new RecorderError('failed'));
    try {
      // 1 s slices: the size limit is checked while recording, not only at the end.
      recorder.start(1_000);
    } catch {
      this.release();
      throw new RecorderError('failed');
    }
    this.startedAt = this.now();
    this.meter = this.deps.createLevelMeter?.(stream) ?? null;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Ends the recording; `onFinished` follows with the audio. */
  stop(reason: StopReason = 'user'): void {
    const recorder = this.recorder;
    if (!recorder || this.finished || this.cancelled || recorder.state === 'inactive') {
      return;
    }
    this.stopReason = reason;
    this.clearTimer();
    try {
      recorder.stop();
    } catch {
      this.finish();
    }
  }

  /** Throws the recording away and frees the microphone; `onFinished` is not called. */
  cancel(): void {
    this.cancelled = true;
    this.clearTimer();
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    this.release();
  }

  get seconds(): number {
    return this.startedAt === null ? 0 : (this.now() - this.startedAt) / 1000;
  }

  private tick(): void {
    const seconds = this.seconds;
    this.callbacks.onTick?.(seconds);
    if (seconds >= this.limits.maxSeconds - SECONDS_MARGIN) {
      this.stop('max-duration');
      return;
    }
    if (this.meter) {
      const verdict = this.silence.push(this.meter.level(), this.now());
      if (verdict === 'silence') {
        this.stop('silence');
      } else if (verdict === 'no-speech') {
        this.fail(new RecorderError('no-speech'));
      }
    }
  }

  private finish(): void {
    if (this.finished || this.cancelled) {
      return;
    }
    this.finished = true;
    const seconds = this.seconds;
    const mimeType = this.recorder?.mimeType || this.chunks[0]?.type || 'audio/webm';
    this.release();
    const blob = new Blob(this.chunks, { type: mimeType });
    if (blob.size === 0) {
      this.callbacks.onFinished(new RecorderError('empty'));
      return;
    }
    this.callbacks.onFinished({ blob, mimeType, seconds, reason: this.stopReason });
  }

  private fail(error: RecorderError): void {
    if (this.finished || this.cancelled) {
      return;
    }
    this.finished = true;
    this.cancel();
    this.callbacks.onFinished(error);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private release(): void {
    this.clearTimer();
    this.meter?.close();
    this.meter = null;
    if (this.stream) {
      stopTracks(this.stream);
      this.stream = null;
    }
  }
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
