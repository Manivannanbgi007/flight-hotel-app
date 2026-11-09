package com.flighthotel.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import org.junit.jupiter.api.Test;

import com.flighthotel.assistant.voice.AudioFormat;

/** Voice through the (stub) speech server: limits, format detection from the bytes, and the proxying. */
class VoiceIntegrationTest extends AssistantIntegrationTest {

    private static final String BOUNDARY = "----voice-test-boundary";

    private HttpResponse<String> upload(String token, byte[] audio, String declaredType) throws Exception {
        byte[] head = ("--" + BOUNDARY + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"rec.webm\"\r\n"
                + "Content-Type: " + declaredType + "\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] tail = ("\r\n--" + BOUNDARY + "--\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] body = new byte[head.length + audio.length + tail.length];
        System.arraycopy(head, 0, body, 0, head.length);
        System.arraycopy(audio, 0, body, head.length, audio.length);
        System.arraycopy(tail, 0, body, head.length + audio.length, tail.length);
        HttpRequest request = HttpRequest.newBuilder(URI.create(url("/api/assistant/voice/transcriptions")))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "multipart/form-data; boundary=" + BOUNDARY)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    }

    /** A PCM WAV (16 kHz, 16 bit, mono) of the given length. */
    static byte[] wav(int seconds) {
        int byteRate = 16_000 * 2;
        int dataBytes = byteRate * seconds;
        ByteBuffer buffer = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN);
        buffer.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + dataBytes)
                .put("WAVE".getBytes(StandardCharsets.US_ASCII)).put("fmt ".getBytes(StandardCharsets.US_ASCII))
                .putInt(16).putShort((short) 1).putShort((short) 1).putInt(16_000).putInt(byteRate)
                .putShort((short) 2).putShort((short) 16).put("data".getBytes(StandardCharsets.US_ASCII))
                .putInt(dataBytes);
        return buffer.array();
    }

    @Test
    void aRecordingIsTranscribed() throws Exception {
        HttpResponse<String> response = upload(TestTokens.token("CUSTOMER"), wav(2), "audio/wav");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JSON.readTree(response.body()).path("text").asString()).isEqualTo("what are my upcoming trips");
        assertThat(SPEECH.requests).anySatisfy(request -> assertThat(request)
                .startsWith("/v1/audio/transcriptions").contains("Systran/faster-whisper-small")
                .contains("verbose_json"));
    }

    @Test
    void theFormatComesFromTheBytesNotTheDeclaredType() throws Exception {
        byte[] html = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);

        HttpResponse<String> response = upload(TestTokens.token("CUSTOMER"), html, "audio/webm");

        assertThat(response.statusCode()).isEqualTo(415);
        assertThat(response.body()).contains("UNSUPPORTED_AUDIO");
        assertThat(SPEECH.requests).isEmpty();
    }

    @Test
    void sizeAndDurationAreLimited() throws Exception {
        String token = TestTokens.token("CUSTOMER");
        byte[] big = Arrays.copyOf(wav(1), 5 * 1024 * 1024 + 10);
        assertThat(upload(token, big, "audio/wav").statusCode()).isEqualTo(413);

        HttpResponse<String> tooLong = upload(token, wav(62), "audio/wav");
        assertThat(tooLong.statusCode()).isEqualTo(422);
        assertThat(tooLong.body()).contains("AUDIO_TOO_LONG");

        // Formats without a readable length are checked with the duration the speech server reports.
        SPEECH.duration = 75;
        try {
            byte[] webm = Arrays.copyOf(new byte[] {0x1A, 0x45, (byte) 0xDF, (byte) 0xA3}, 64);
            assertThat(upload(token, webm, "audio/webm").statusCode()).isEqualTo(422);
        } finally {
            SPEECH.duration = 3.2;
        }
        assertThat(upload(token, new byte[0], "audio/webm").statusCode()).isEqualTo(400);
    }

    @Test
    void textIsReadAloudAsMp3() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url("/api/assistant/voice/speech")))
                .header("Authorization", "Bearer " + TestTokens.token("CUSTOMER"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\"You have two upcoming trips.\"}")).build();

        HttpResponse<byte[]> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofByteArray());

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type")).hasValue("audio/mpeg");
        assertThat(response.headers().firstValue("Cache-Control").orElse("")).contains("no-store");
        assertThat(AudioFormat.detect(response.body())).hasValue(AudioFormat.MP3);
        assertThat(SPEECH.requests).anySatisfy(sent -> assertThat(sent).startsWith("/v1/audio/speech")
                .contains("af_heart").contains("\"response_format\":\"mp3\""));

        HttpRequest tooLong = HttpRequest.newBuilder(URI.create(url("/api/assistant/voice/speech")))
                .header("Authorization", "Bearer " + TestTokens.token("CUSTOMER"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\"" + "a".repeat(1001) + "\"}")).build();
        assertThat(HttpClient.newHttpClient().send(tooLong, HttpResponse.BodyHandlers.ofString()).statusCode())
                .isEqualTo(400);
    }

    @Test
    void audioFormatsAreRecognised() {
        assertThat(AudioFormat.detect(wav(1))).hasValue(AudioFormat.WAV);
        assertThat(AudioFormat.detect(Arrays.copyOf("OggS".getBytes(StandardCharsets.US_ASCII), 16)))
                .hasValue(AudioFormat.OGG);
        assertThat(AudioFormat.detect(Arrays.copyOf(new byte[] {0, 0, 0, 0x20, 'f', 't', 'y', 'p'}, 16)))
                .hasValue(AudioFormat.MP4);
        assertThat(AudioFormat.detect(Arrays.copyOf("ID3".getBytes(StandardCharsets.US_ASCII), 16)))
                .hasValue(AudioFormat.MP3);
        assertThat(AudioFormat.detect("not audio at all".getBytes(StandardCharsets.UTF_8))).isEmpty();
        assertThat(AudioFormat.wavDuration(wav(3))).hasValueSatisfying(d -> assertThat(d.toSeconds()).isEqualTo(3));
    }
}
