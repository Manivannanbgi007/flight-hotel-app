import { createLevelMeter, SilenceDetector } from './silence';
import { chooseRecordingType } from './voiceSupport';

/**
 * Records one spoken question with `MediaRecorder` for the speech server, within the server's limits
 * (`config.limits.maxAudioSeconds` / `maxAudioBytes`): it stops by itself just before either is reached, after a
 * pause once the user has spoken, or when nothing is heard. The microphone is released as soon as it stops.
 */

export class RecorderError extends Error {
  constructor(kind) {
    super(RECORDER_MESSAGES[kind]);
    this.kind = kind;
    this.name = 'RecorderError';
  }
}

/** Friendly texts, also used for the browser's own speech recognition. */
export const RECORDER_MESSAGES = {
  denied: "Microphone access is blocked. Allow it for this site in your browser's settings, or type your question.",
  'no-device': 'No microphone was found. Connect one, or type your question.',
  busy: 'The microphone is being used by another app. Close it, or type your question.',
  unsupported: "This browser can't record audio. Please type your question.",
  failed: "The recording didn't work. Please try again or type your question.",
  empty: 'Nothing was recorded. Tap the microphone and try again.',
  'no-speech': "I didn't hear anything. Tap the microphone and try again.",
};

/** `getUserMedia` errors (DOMException names) → what to tell the user. */
export function recorderErrorOf(error) {
  const name =
    error instanceof Error || (error && typeof error === 'object' && 'name' in error) ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return new RecorderError('denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    return new RecorderError('no-device');
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError')
    return new RecorderError('busy');
  return new RecorderError('failed');
}

/** Margins: stop a little before the server's limits (the last chunk arrives after `stop()`). */
const SECONDS_MARGIN = 0.5;
const BYTES_MARGIN = 0.9;
const TICK_MS = 200;

export function browserRecorderDeps() {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    createLevelMeter,
    now: () => performance.now(),
  };
}

export class VoiceRecorder {
  stream = null;
  recorder = null;
  meter = null;
  timer = null;
  chunks = [];
  bytes = 0;
  startedAt = null;
  stopReason = 'user';
  finished = false;
  cancelled = false;
  silence = new SilenceDetector();
  now;

  constructor(deps, limits, callbacks) {
    this.deps = deps;
    this.limits = limits;
    this.callbacks = callbacks;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Asks for the microphone and starts. Rejects with a {@link RecorderError} (denied, no device, …). */
  async start() {
    let stream;
    try {
      stream = await this.deps.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
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
      this.recorder = this.deps.createRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      });
    } catch {
      this.release();
      throw new RecorderError('unsupported');
    }
    const recorder = this.recorder;
    recorder.ondataavailable = (event) => {
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
  stop(reason = 'user') {
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
  cancel() {
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

  get seconds() {
    return this.startedAt === null ? 0 : (this.now() - this.startedAt) / 1000;
  }

  tick() {
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

  finish() {
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

  fail(error) {
    if (this.finished || this.cancelled) {
      return;
    }
    this.finished = true;
    this.cancel();
    this.callbacks.onFinished(error);
  }

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  release() {
    this.clearTimer();
    this.meter?.close();
    this.meter = null;
    if (this.stream) {
      stopTracks(this.stream);
      this.stream = null;
    }
  }
}

function stopTracks(stream) {
  stream.getTracks().forEach((track) => track.stop());
}
