package com.flighthotel.assistant.config;

import java.net.http.HttpClient;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.ToolCallingAdvisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.model.tool.DefaultToolCallingManager;
import org.springframework.ai.model.tool.ToolCallLimitBehavior;
import org.springframework.ai.ollama.api.OllamaApi;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.web.client.RestClient;
import org.springframework.web.reactive.function.client.WebClient;

import io.micrometer.observation.ObservationRegistry;

/**
 * The model connection and the chat client.
 * <ul>
 * <li>Ollama is reached through the JDK HttpClient (connect timeout {@code assistant.model.connect-timeout}); the
 * answer's timing is limited in {@code ChatService} (first token, pauses, total).</li>
 * <li>Tool calls: only the tools attached to the request can run (no lookup of other tool beans by name), and at
 * most {@code assistant.chat.max-tool-calls} + 2 per question as a hard stop (each tool callback already refuses
 * more than {@code max-tool-calls}).</li>
 * </ul>
 */
@Configuration
public class AssistantAiConfig {

    @Bean
    OllamaApi ollamaApi(AssistantProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.model().connectTimeout())
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        JdkClientHttpConnector connector = new JdkClientHttpConnector(httpClient);
        connector.setReadTimeout(properties.chat().totalTimeout());
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.chat().totalTimeout());
        return OllamaApi.builder()
                .baseUrl(properties.model().baseUrl())
                .restClientBuilder(RestClient.builder().requestFactory(requestFactory))
                .webClientBuilder(WebClient.builder().clientConnector(connector))
                .build();
    }

    @Bean
    ChatClient assistantChatClient(ChatModel chatModel, AssistantProperties properties,
            ObjectProvider<ObservationRegistry> observationRegistry) {
        ObservationRegistry registry = observationRegistry.getIfUnique(() -> ObservationRegistry.NOOP);
        DefaultToolCallingManager toolCallingManager = DefaultToolCallingManager.builder()
                .observationRegistry(registry)
                .maxTotalToolCalls(properties.chat().maxToolCalls() + 2)
                .onLimitExceeded(ToolCallLimitBehavior.THROW)
                .resolutionFallbackEnabled(false)
                .build();
        return ChatClient.builder(chatModel, registry, null, null,
                ToolCallingAdvisor.builder().toolCallingManager(toolCallingManager)).build();
    }
}
