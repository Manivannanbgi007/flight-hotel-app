package com.flighthotel.assistant.voice;

import java.io.IOException;
import java.time.Duration;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.flighthotel.assistant.chat.AssistantDtos.SpeechRequest;
import com.flighthotel.assistant.chat.AssistantDtos.TranscriptionResponse;
import com.flighthotel.assistant.config.AssistantProperties;
import com.flighthotel.common.error.ApiException;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * Voice through the local speech server (profile {@code voice}). Without it both endpoints answer
 * {@code 503 VOICE_UNAVAILABLE} and {@code GET /api/assistant/config} says so, so the browser uses its own speech APIs.
 */
@RestController
@RequestMapping("/api/assistant/voice")
@Tag(name = "Assistant voice", description = "Speech to text and text to speech (optional speech server)")
public class VoiceController {

    private final SpeechClient speech;
    private final AssistantProperties.Voice settings;

    public VoiceController(SpeechClient speech, AssistantProperties properties) {
        this.speech = speech;
        this.settings = properties.voice();
    }

    @PostMapping(path = "/transcriptions", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Speech to text: multipart part 'file' (WebM/Ogg/MP4/WAV/MP3/FLAC, max 5 MB, max 60 s)")
    public TranscriptionResponse transcribe(@RequestPart("file") MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "EMPTY_AUDIO", "The recording is empty.");
        }
        if (file.getSize() > settings.maxAudioSize().toBytes()) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", "The recording is too large.");
        }
        byte[] audio = file.getBytes();
        AudioFormat format = AudioFormat.detect(audio).orElseThrow(() -> new ApiException(
                HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_AUDIO",
                "Unsupported audio format. Use WebM, Ogg, MP4, WAV, MP3 or FLAC."));
        if (format == AudioFormat.WAV) {
            AudioFormat.wavDuration(audio).filter(this::tooLong).ifPresent(d -> {
                throw tooLongError();
            });
        }
        SpeechClient.Transcript transcript = speech.transcribe(audio, format);
        if (transcript.durationSeconds() != null
                && tooLong(Duration.ofMillis((long) (transcript.durationSeconds() * 1000)))) {
            throw tooLongError();
        }
        return new TranscriptionResponse(transcript.text());
    }

    @PostMapping(path = "/speech", consumes = MediaType.APPLICATION_JSON_VALUE, produces = "audio/mpeg")
    @Operation(summary = "Text to speech: {text} (max 1000 characters) → MP3")
    public ResponseEntity<byte[]> speak(@Valid @RequestBody SpeechRequest request) {
        String text = request.text().strip();
        if (text.length() > settings.maxSpeechChars()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TEXT_TOO_LONG", "The text is too long to read aloud.");
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("audio/mpeg"))
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(speech.speak(text));
    }

    private boolean tooLong(Duration duration) {
        return duration.compareTo(settings.maxAudioDuration().plusSeconds(1)) > 0;
    }

    private ApiException tooLongError() {
        return new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "AUDIO_TOO_LONG",
                "The recording is too long (at most " + settings.maxAudioDuration().toSeconds() + " seconds).");
    }
}
