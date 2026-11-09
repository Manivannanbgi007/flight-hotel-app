import { RecorderError, recorderErrorOf, VoiceRecorder, type Recording, type RecorderDeps } from './recorder';
import { SilenceDetector } from './silence';

/** MediaRecorder stand-in: `emit` delivers a slice of audio, `stop` delivers the last one and fires onstop. */
class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice: number | undefined;
  constructor(readonly mimeType: string) {}
  start(timeslice?: number) {
    this.state = 'recording';
    this.timeslice = timeslice;
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) } as BlobEvent);
  }
  stop() {
    this.state = 'inactive';
    this.emit(10);
    this.onstop?.();
  }
}

function setup({ levels, getUserMedia }: { levels?: number[]; getUserMedia?: RecorderDeps['getUserMedia'] } = {}) {
  let now = 0;
  const track = { stop: vi.fn() };
  const recorders: FakeRecorder[] = [];
  const meterLevels = [...(levels ?? [])];
  const deps: RecorderDeps = {
    getUserMedia: getUserMedia ?? vi.fn().mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream),
    createRecorder: (_stream, options) => {
      const recorder = new FakeRecorder(options.mimeType ?? 'audio/webm');
      recorders.push(recorder);
      return recorder as unknown as MediaRecorder;
    },
    isTypeSupported: (type) => type === 'audio/ogg;codecs=opus',
    createLevelMeter: levels ? () => ({ level: () => meterLevels.shift() ?? 0, close: vi.fn() }) : () => null,
    now: () => now,
  };
  const results: (Recording | RecorderError)[] = [];
  const ticks: number[] = [];
  const recorder = new VoiceRecorder(deps, { maxSeconds: 60, maxBytes: 5_000 }, {
    onTick: (seconds) => ticks.push(seconds),
    onFinished: (result) => results.push(result),
  });
  const advance = (ms: number) => {
    for (let step = 0; step < ms; step += 200) {
      now += 200;
      vi.advanceTimersByTime(200);
    }
  };
  return { recorder, deps, track, recorders, results, ticks, advance };
}

describe('VoiceRecorder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records in a format the server accepts and hands over the audio when the user stops', async () => {
    const { recorder, deps, track, recorders, results, ticks, advance } = setup();

    await recorder.start();
    advance(2_000);
    recorders[0]!.emit(300);
    recorder.stop();

    expect(deps.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: true }) });
    expect(recorders[0]!.mimeType).toBe('audio/ogg;codecs=opus');
    expect(recorders[0]!.timeslice).toBe(1_000);
    expect(ticks.at(-1)).toBeCloseTo(2, 1);
    expect(results).toHaveLength(1);
    const result = results[0] as Recording;
    expect(result).toMatchObject({ mimeType: 'audio/ogg;codecs=opus', reason: 'user' });
    expect(result.blob.size).toBe(310);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops by itself just before the maximum length', async () => {
    const { recorder, results, track, advance } = setup();

    await recorder.start();
    advance(59_000);
    expect(results).toHaveLength(0);
    advance(1_000);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ reason: 'max-duration' });
    expect((results[0] as Recording).seconds).toBeLessThan(60);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops by itself before the maximum size', async () => {
    const { recorder, recorders, results } = setup();

    await recorder.start();
    recorders[0]!.emit(2_000);
    expect(results).toHaveLength(0);
    recorders[0]!.emit(2_600);

    expect(results[0]).toMatchObject({ reason: 'max-size' });
  });

  it('stops after a pause once the user has spoken (one tap per question)', async () => {
    const loud = Array<number>(10).fill(0.2);
    const quiet = Array<number>(20).fill(0.001);
    const { recorder, results, advance } = setup({ levels: [...loud, ...quiet] });

    await recorder.start();
    advance(2_000);
    expect(results).toHaveLength(0);
    advance(2_000);

    expect(results[0]).toMatchObject({ reason: 'silence' });
  });

  it('gives up when nothing is heard', async () => {
    const { recorder, results, track, advance } = setup({ levels: Array<number>(100).fill(0.001) });

    await recorder.start();
    advance(10_200);

    expect(results[0]).toBeInstanceOf(RecorderError);
    expect((results[0] as RecorderError).kind).toBe('no-speech');
    expect(track.stop).toHaveBeenCalled();
  });

  it('cancel throws the recording away and frees the microphone', async () => {
    const { recorder, results, track, advance } = setup();

    await recorder.start();
    recorder.cancel();
    advance(60_000);

    expect(results).toEqual([]);
    expect(track.stop).toHaveBeenCalled();
  });

  it('a blocked or missing microphone becomes a clear error', async () => {
    const denied = setup({ getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) });
    await expect(denied.recorder.start()).rejects.toMatchObject({ kind: 'denied', message: expect.stringContaining('Microphone access is blocked') });

    const missing = setup({ getUserMedia: vi.fn().mockRejectedValue(new DOMException('none', 'NotFoundError')) });
    await expect(missing.recorder.start()).rejects.toMatchObject({ kind: 'no-device', message: expect.stringContaining('No microphone was found') });

    expect(recorderErrorOf(new DOMException('busy', 'NotReadableError')).kind).toBe('busy');
    expect(recorderErrorOf(new Error('?')).kind).toBe('failed');
  });
});

describe('SilenceDetector', () => {
  it('waits for speech, then for a pause', () => {
    const detector = new SilenceDetector({ threshold: 0.05, silenceMs: 1_000, noSpeechMs: 5_000 });

    expect(detector.push(0.01, 0)).toBeNull();
    expect(detector.push(0.2, 500)).toBeNull();
    expect(detector.heardSpeech).toBe(true);
    expect(detector.push(0.01, 1_400)).toBeNull();
    expect(detector.push(0.01, 1_500)).toBe('silence');
  });

  it('reports no speech after the wait', () => {
    const detector = new SilenceDetector({ threshold: 0.05, noSpeechMs: 5_000 });

    expect(detector.push(0.01, 0)).toBeNull();
    expect(detector.push(0.01, 4_999)).toBeNull();
    expect(detector.push(0.01, 5_000)).toBe('no-speech');
  });
});
