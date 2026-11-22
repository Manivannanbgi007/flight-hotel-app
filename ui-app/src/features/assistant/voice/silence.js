/**
 * Ends a recording by itself, so a voice question needs only one tap: after the user spoke, a pause of `silenceMs`
 * stops it; if nothing is heard at all for `noSpeechMs`, it gives up. Fed with the microphone level (RMS, 0…1)
 * several times a second.
 */
export class SilenceDetector {
  startedAt = null;
  lastLoudAt = null;

  constructor(options = {}) {
    this.options = options;
  }

  /** @returns `silence` (spoke, then paused), `no-speech` (nothing heard) or null (keep recording). */
  push(level, now) {
    const { threshold = 0.015, silenceMs = 1_600, noSpeechMs = 10_000 } = this.options;
    this.startedAt ??= now;
    if (level >= threshold) {
      this.lastLoudAt = now;
      return null;
    }
    if (this.lastLoudAt !== null) {
      return now - this.lastLoudAt >= silenceMs ? 'silence' : null;
    }
    return now - this.startedAt >= noSpeechMs ? 'no-speech' : null;
  }

  get heardSpeech() {
    return this.lastLoudAt !== null;
  }
}

export function createLevelMeter(stream) {
  const scope = globalThis;
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) {
    return null;
  }
  try {
    const context = new Context();
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    return {
      level() {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        return Math.sqrt(sum / samples.length);
      },
      close() {
        source.disconnect();
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
}
