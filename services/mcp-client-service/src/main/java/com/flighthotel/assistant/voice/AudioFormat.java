package com.flighthotel.assistant.voice;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.Optional;

/**
 * The audio formats accepted for transcription, recognised from the file's first bytes (never from its name or
 * Content-Type): what browsers record (WebM/Opus, Ogg/Opus, MP4/AAC) and common uploads (WAV, MP3, FLAC).
 */
public enum AudioFormat {

    WEBM("audio/webm", "webm"),
    OGG("audio/ogg", "ogg"),
    WAV("audio/wav", "wav"),
    MP3("audio/mpeg", "mp3"),
    MP4("audio/mp4", "m4a"),
    FLAC("audio/flac", "flac");

    private final String mediaType;
    private final String extension;

    AudioFormat(String mediaType, String extension) {
        this.mediaType = mediaType;
        this.extension = extension;
    }

    public String mediaType() {
        return mediaType;
    }

    public String extension() {
        return extension;
    }

    public static Optional<AudioFormat> detect(byte[] bytes) {
        if (bytes.length < 12) {
            return Optional.empty();
        }
        if (startsWith(bytes, 0, 0x1A, 0x45, 0xDF, 0xA3)) {
            return Optional.of(WEBM);
        }
        if (startsWith(bytes, 0, 'O', 'g', 'g', 'S')) {
            return Optional.of(OGG);
        }
        if (startsWith(bytes, 0, 'R', 'I', 'F', 'F') && startsWith(bytes, 8, 'W', 'A', 'V', 'E')) {
            return Optional.of(WAV);
        }
        if (startsWith(bytes, 0, 'f', 'L', 'a', 'C')) {
            return Optional.of(FLAC);
        }
        if (startsWith(bytes, 4, 'f', 't', 'y', 'p')) {
            return Optional.of(MP4);
        }
        if (startsWith(bytes, 0, 'I', 'D', '3')
                || ((bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xE0) == 0xE0)) {
            return Optional.of(MP3);
        }
        return Optional.empty();
    }

    /** Length of a PCM WAV file from its header, if it can be read. */
    public static Optional<Duration> wavDuration(byte[] bytes) {
        if (bytes.length < 44) {
            return Optional.empty();
        }
        ByteBuffer header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int byteRate = header.getInt(28);
        if (byteRate <= 0) {
            return Optional.empty();
        }
        long dataBytes = Math.max(0, bytes.length - 44L);
        return Optional.of(Duration.ofMillis(dataBytes * 1000 / byteRate));
    }

    private static boolean startsWith(byte[] bytes, int offset, int... expected) {
        if (bytes.length < offset + expected.length) {
            return false;
        }
        for (int i = 0; i < expected.length; i++) {
            if ((bytes[offset + i] & 0xFF) != expected[i]) {
                return false;
            }
        }
        return true;
    }
}
