package com.flighthotel.assistant.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.util.unit.DataSize;

/**
 * Settings of the assistant ({@code assistant.*}). Every value has an environment variable in docker-compose.yml and
 * .env.example (AI_ASSISTANT.md §Configuration).
 *
 * @param model    the local model and how it runs
 * @param chat     limits and timeouts of one chat request
 * @param memory   conversation memory in Redis
 * @param mcp      the MCP tool server
 * @param voice    the optional speech server (profile {@code voice})
 */
@ConfigurationProperties("assistant")
public record AssistantProperties(
        @DefaultValue Model model,
        @DefaultValue Chat chat,
        @DefaultValue Memory memory,
        @DefaultValue Mcp mcp,
        @DefaultValue Voice voice) {

    /**
     * @param baseUrl        Ollama ({@code OLLAMA_BASE_URL})
     * @param name           model tag ({@code ASSISTANT_CHAT_MODEL}), e.g. {@code granite4:tiny-h}
     * @param numCtx         context window in tokens ({@code ASSISTANT_NUM_CTX}); keep equal to Ollama's
     *                       {@code OLLAMA_CONTEXT_LENGTH}, or every request reloads the model
     * @param temperature    {@code ASSISTANT_TEMPERATURE}; low = factual
     * @param keepAlive      how long Ollama keeps the model loaded ({@code ASSISTANT_KEEP_ALIVE})
     * @param maxAnswerTokens longest answer (Ollama {@code num_predict})
     * @param connectTimeout TCP connect timeout to Ollama
     * @param warmUp         load the model into memory when the service starts
     */
    public record Model(
            @DefaultValue("http://localhost:11434") String baseUrl,
            @DefaultValue("granite4:tiny-h") String name,
            @DefaultValue("8192") int numCtx,
            @DefaultValue("0.2") double temperature,
            @DefaultValue("30m") String keepAlive,
            @DefaultValue("600") int maxAnswerTokens,
            @DefaultValue("3s") Duration connectTimeout,
            @DefaultValue("true") boolean warmUp) {
    }

    /**
     * @param maxMessageLength longest user message (characters)
     * @param firstTokenTimeout time until the model's first answer token (includes queueing, model loading and
     *                          reading the prompt on this CPU)
     * @param idleTimeout      longest pause between two events (a tool call or tokens)
     * @param totalTimeout     the whole answer
     * @param maxToolCalls     tool calls per question; more are refused
     * @param statusCacheTtl   how long the model check (config.enabled) is cached
     */
    public record Chat(
            @DefaultValue("2000") int maxMessageLength,
            @DefaultValue("150s") Duration firstTokenTimeout,
            @DefaultValue("90s") Duration idleTimeout,
            @DefaultValue("240s") Duration totalTimeout,
            @DefaultValue("4") int maxToolCalls,
            @DefaultValue("20s") Duration statusCacheTtl) {
    }

    /**
     * @param ttl         a conversation is forgotten this long after its last message
     * @param maxMessages messages kept (and sent to the model) per conversation
     */
    public record Memory(
            @DefaultValue("24h") Duration ttl,
            @DefaultValue("20") int maxMessages) {
    }

    /**
     * @param apiKey          shared secret with mcp-server-service ({@code MCP_SERVER_API_KEY})
     * @param connectTimeout  TCP connect timeout to the MCP server
     * @param toolListCacheTtl how long the tool list of a role is cached
     */
    public record Mcp(
            String apiKey,
            @DefaultValue("2s") Duration connectTimeout,
            @DefaultValue("5m") Duration toolListCacheTtl) {
    }

    /**
     * Speech server with the OpenAI audio API ({@code /v1/audio/transcriptions}, {@code /v1/audio/speech}).
     * An empty URL switches that direction off (the browser's own speech API is used instead).
     */
    public record Voice(
            @DefaultValue("") String sttUrl,
            @DefaultValue("Systran/faster-whisper-small") String sttModel,
            @DefaultValue("") String ttsUrl,
            @DefaultValue("speaches-ai/Kokoro-82M-v1.0-ONNX") String ttsModel,
            @DefaultValue("af_heart") String ttsVoice,
            @DefaultValue("5MB") DataSize maxAudioSize,
            @DefaultValue("60s") Duration maxAudioDuration,
            @DefaultValue("1000") int maxSpeechChars,
            @DefaultValue("60s") Duration timeout) {

        public boolean transcriptionConfigured() {
            return sttUrl != null && !sttUrl.isBlank();
        }

        public boolean speechConfigured() {
            return ttsUrl != null && !ttsUrl.isBlank();
        }
    }
}
