import { BrowserDictation, type SpeechRecognitionLike } from './browserDictation';
import { BrowserSpeechPlayer, ServerSpeechPlayer, speakableText, speechParts } from './speechOutput';

describe('speakableText and speechParts', () => {
  it('reads amounts as words and drops the text markers', () => {
    expect(speakableText('Your stay costs **₹9,609.60**.\n- HT-ANSB6KZ8\n- Rs 2,00,000')).toBe(
      'Your stay costs 9609.60 rupees. HT-ANSB6KZ8. 200000 rupees',
    );
  });

  it('splits long text at sentence ends, never above the limit', () => {
    const text = 'First sentence is here. Second sentence follows it. Third one ends.';

    const parts = speechParts(text, 30);

    expect(parts).toEqual(['First sentence is here.', 'Second sentence follows it.', 'Third one ends.']);
    expect(parts.every((part) => part.length <= 30)).toBe(true);
  });

  it('cuts at a space when a sentence is too long, and reads at most four parts', () => {
    expect(speechParts('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc']);
    expect(speechParts('x'.repeat(50), 10)).toHaveLength(4);
    expect(speechParts('   ', 10)).toEqual([]);
  });
});

describe('ServerSpeechPlayer', () => {
  function audio() {
    const element = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), onended: null as (() => void) | null, onerror: null as (() => void) | null };
    return element;
  }

  it('fetches and plays each part from a blob URL, then revokes the URL', async () => {
    const elements: ReturnType<typeof audio>[] = [];
    const fetchSpeech = vi.fn(async (text: string) => new Blob([text], { type: 'audio/mpeg' }));
    const revokeUrl = vi.fn();
    const player = new ServerSpeechPlayer({
      fetchSpeech,
      createUrl: () => `blob:${elements.length}`,
      revokeUrl,
      createAudio: () => {
        const element = audio();
        elements.push(element);
        queueMicrotask(() => element.onended?.());
        return element as unknown as HTMLAudioElement;
      },
    });

    await player.play(['One.', 'Two.']);

    expect(fetchSpeech.mock.calls.map(([text]) => text)).toEqual(['One.', 'Two.']);
    expect(elements).toHaveLength(2);
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });

  it('stop pauses the playing part and ends at once', async () => {
    const element = audio();
    const player = new ServerSpeechPlayer({
      fetchSpeech: async () => new Blob(['x']),
      createUrl: () => 'blob:1',
      revokeUrl: vi.fn(),
      createAudio: () => element as unknown as HTMLAudioElement,
    });

    const playing = player.play(['One.', 'Two.']);
    await vi.waitFor(() => expect(element.play).toHaveBeenCalled());
    player.stop();
    await playing;

    expect(element.pause).toHaveBeenCalled();
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it('rejects when the speech server fails', async () => {
    const player = new ServerSpeechPlayer({ fetchSpeech: () => Promise.reject(new Error('503')) });

    await expect(player.play(['One.'])).rejects.toThrow('503');
  });
});

describe('BrowserSpeechPlayer', () => {
  it('queues every part with the language and resolves after the last one', async () => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const synth = { speak: vi.fn((u: SpeechSynthesisUtterance) => spoken.push(u)), cancel: vi.fn() };
    const player = new BrowserSpeechPlayer({ synth, lang: 'en-IN', createUtterance: (text) => ({ text } as SpeechSynthesisUtterance) });

    const done = player.play(['One.', 'Two.']);
    spoken.at(-1)!.onend?.({} as SpeechSynthesisEvent);
    await done;

    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken.map((u) => [u.text, u.lang])).toEqual([['One.', 'en-IN'], ['Two.', 'en-IN']]);
  });
});

describe('BrowserDictation', () => {
  class FakeRecognition implements SpeechRecognitionLike {
    static last: FakeRecognition;
    lang = '';
    continuous = true;
    interimResults = false;
    maxAlternatives = 0;
    onstart: (() => void) | null = null;
    onresult: SpeechRecognitionLike['onresult'] = null;
    onerror: SpeechRecognitionLike['onerror'] = null;
    onend: (() => void) | null = null;
    start = vi.fn(() => this.onstart?.());
    stop = vi.fn(() => this.onend?.());
    abort = vi.fn();
    constructor() {
      FakeRecognition.last = this;
    }
    say(text: string, isFinal: boolean) {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
    }
  }

  it('listens for one utterance and delivers the final text', () => {
    const onFinished = vi.fn();
    const onInterim = vi.fn();
    const dictation = new BrowserDictation(FakeRecognition, { lang: 'en-IN', maxSeconds: 60 }, { onFinished, onInterim });

    dictation.start();
    FakeRecognition.last.say('what are my', false);
    FakeRecognition.last.say('what are my upcoming trips', true);
    FakeRecognition.last.onend?.();

    expect(FakeRecognition.last).toMatchObject({ lang: 'en-IN', continuous: false, interimResults: true });
    expect(onInterim).toHaveBeenCalledWith('what are my');
    expect(onFinished).toHaveBeenCalledWith({ text: 'what are my upcoming trips' });
  });

  it('explains a blocked microphone and silence', () => {
    const onFinished = vi.fn();
    new BrowserDictation(FakeRecognition, { lang: 'en', maxSeconds: 60 }, { onFinished }).start();
    FakeRecognition.last.onerror?.({ error: 'not-allowed' });
    FakeRecognition.last.onend?.();
    expect(onFinished).toHaveBeenLastCalledWith({ error: expect.stringContaining('Microphone access is blocked') });

    new BrowserDictation(FakeRecognition, { lang: 'en', maxSeconds: 60 }, { onFinished }).start();
    FakeRecognition.last.onend?.();
    expect(onFinished).toHaveBeenLastCalledWith({ error: expect.stringContaining("didn't hear anything") });
  });

  it('stops at the time limit; cancel delivers nothing', () => {
    vi.useFakeTimers();
    try {
      const onFinished = vi.fn();
      new BrowserDictation(FakeRecognition, { lang: 'en', maxSeconds: 5 }, { onFinished }).start();
      vi.advanceTimersByTime(5_000);
      expect(FakeRecognition.last.stop).toHaveBeenCalled();

      const cancelled = vi.fn();
      const dictation = new BrowserDictation(FakeRecognition, { lang: 'en', maxSeconds: 5 }, { onFinished: cancelled });
      dictation.start();
      dictation.cancel();
      FakeRecognition.last.onend?.();
      expect(FakeRecognition.last.abort).toHaveBeenCalled();
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
