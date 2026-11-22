export function detectVoiceSupport(scope = globalThis) {
  return {
    mediaRecorder:
      typeof scope.MediaRecorder === 'function' && typeof scope.navigator?.mediaDevices?.getUserMedia === 'function',
    speechRecognition: typeof (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) === 'function',
    speechSynthesis:
      typeof scope.speechSynthesis === 'object' &&
      scope.speechSynthesis !== null &&
      typeof scope.SpeechSynthesisUtterance === 'function',
    audio: typeof scope.Audio === 'function' && typeof scope.URL?.createObjectURL === 'function',
  };
}

/** The server's voice wins when it is on and the browser can record or play; otherwise the browser's own speech. */
export function chooseVoiceModes(server, support) {
  const input =
    server.transcription && support.mediaRecorder ? 'server' : support.speechRecognition ? 'browser' : 'none';
  const output = server.speech && support.audio ? 'server' : support.speechSynthesis ? 'browser' : 'none';
  return { input, output };
}

/** Recording formats the speech server accepts (checked from the bytes), best first. */
export const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
];

/** The first format this browser can record, or undefined for the browser's default. */
export function chooseRecordingType(isTypeSupported) {
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
export function recordingFileName(mimeType) {
  const type = mimeType.toLowerCase();
  if (type.includes('ogg')) return 'question.ogg';
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return 'question.m4a';
  if (type.includes('wav')) return 'question.wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'question.mp3';
  return 'question.webm';
}
