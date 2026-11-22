import { apiClient } from '@/lib/api/client';

/** The assistant's non-streaming endpoints (the chat stream is `chatStream.js`). */
export const assistantApi = {
  /** `404 CONVERSATION_NOT_FOUND`: expired (24 h) or not this user's. */
  async conversation(id, signal) {
    const { data } = await apiClient.get(`/assistant/conversations/${encodeURIComponent(id)}`, { signal });
    return data;
  },

  async deleteConversation(id) {
    await apiClient.delete(`/assistant/conversations/${encodeURIComponent(id)}`);
  },

  /** Speech to text (only when `config.voice.transcription`): one multipart part `file`, at most 5 MB and 60 s. */
  async transcribe(audio, fileName, signal) {
    const form = new FormData();
    form.append('file', audio, fileName);
    // The first transcription loads the speech model (about 10 s); a busy CPU makes it slower.
    const { data } = await apiClient.post('/assistant/voice/transcriptions', form, { timeout: 90_000, signal });
    return typeof data?.text === 'string' ? data.text.trim() : '';
  },

  /** Text to speech (only when `config.voice.speech`): up to `maxSpeechChars` characters → MP3. */
  async speech(text, signal) {
    const { data } = await apiClient.post(
      '/assistant/voice/speech',
      { text },
      {
        responseType: 'blob',
        headers: { Accept: 'audio/mpeg' },
        timeout: 60_000,
        signal,
      },
    );
    return data;
  },
};
