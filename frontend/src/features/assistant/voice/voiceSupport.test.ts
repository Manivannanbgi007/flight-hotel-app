import { chooseRecordingType, chooseVoiceModes, detectVoiceSupport, recordingFileName, type BrowserVoiceSupport } from './voiceSupport';

const fn = () => undefined;
class Fake {}

const ALL: BrowserVoiceSupport = { mediaRecorder: true, speechRecognition: true, speechSynthesis: true, audio: true };
const NONE: BrowserVoiceSupport = { mediaRecorder: false, speechRecognition: false, speechSynthesis: false, audio: false };

describe('detectVoiceSupport', () => {
  it('finds each API by feature, including the webkit-prefixed recognition', () => {
    expect(detectVoiceSupport({
      MediaRecorder: Fake,
      navigator: { mediaDevices: { getUserMedia: fn } },
      webkitSpeechRecognition: Fake,
      speechSynthesis: {},
      SpeechSynthesisUtterance: Fake,
      Audio: Fake,
      URL: { createObjectURL: fn },
    })).toEqual(ALL);
  });

  it('reports what is missing (no getUserMedia on http, no speech APIs, no object URLs)', () => {
    expect(detectVoiceSupport({ MediaRecorder: Fake, navigator: {}, Audio: Fake, URL: {} })).toEqual(NONE);
    expect(detectVoiceSupport({})).toEqual(NONE);
  });
});

describe('chooseVoiceModes', () => {
  it('uses the speech server when it is on and the browser can record and play', () => {
    expect(chooseVoiceModes({ transcription: true, speech: true }, ALL)).toEqual({ input: 'server', output: 'server' });
  });

  it("falls back to the browser's speech when the server's voice is off", () => {
    expect(chooseVoiceModes({ transcription: false, speech: false }, ALL)).toEqual({ input: 'browser', output: 'browser' });
  });

  it('falls back per direction (no MediaRecorder, but the server speaks)', () => {
    expect(chooseVoiceModes({ transcription: true, speech: true }, { ...ALL, mediaRecorder: false })).toEqual({ input: 'browser', output: 'server' });
    expect(chooseVoiceModes({ transcription: true, speech: true }, { ...ALL, audio: false })).toEqual({ input: 'server', output: 'browser' });
  });

  it('hides voice when neither the server nor the browser can do it', () => {
    expect(chooseVoiceModes({ transcription: false, speech: false }, NONE)).toEqual({ input: 'none', output: 'none' });
    expect(chooseVoiceModes({ transcription: true, speech: false }, { ...NONE, speechSynthesis: true })).toEqual({ input: 'none', output: 'browser' });
  });
});

describe('recording format', () => {
  it('picks the first format the browser can record that the server accepts', () => {
    expect(chooseRecordingType((type) => type.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(chooseRecordingType((type) => type === 'audio/mp4')).toBe('audio/mp4');
    expect(chooseRecordingType(() => false)).toBeUndefined();
    expect(chooseRecordingType(undefined)).toBeUndefined();
  });

  it('names the upload after the format', () => {
    expect(recordingFileName('audio/webm;codecs=opus')).toBe('question.webm');
    expect(recordingFileName('audio/ogg;codecs=opus')).toBe('question.ogg');
    expect(recordingFileName('audio/mp4')).toBe('question.m4a');
    expect(recordingFileName('')).toBe('question.webm');
  });
});
