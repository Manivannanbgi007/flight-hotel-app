package com.flighthotel.mcpserver.gateway;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import com.flighthotel.common.correlation.CorrelationId;
import com.flighthotel.mcpserver.config.McpServerProperties;
import com.flighthotel.mcpserver.gateway.DownstreamException.Kind;
import com.flighthotel.mcpserver.security.Caller;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Read-only calls to the API gateway <b>as the user</b>: the user's own bearer token goes along, so the gateway and
 * the services apply every rule they already have (ownership 404s, permissions, rate limits).
 * <ul>
 * <li>short connect and read timeouts ({@code mcp-server.gateway.*});</li>
 * <li>a GET that hit a timeout, a connection error or 502/503/504 is tried once more (reads are idempotent);</li>
 * <li>one {@link CircuitBreaker} per area ({@code /api/bookings}, {@code /api/admin/...}), so a service that is
 * down fails fast without slowing every chat.</li>
 * </ul>
 * Response bodies are never logged.
 */
@Component
public class GatewayClient {

    private static final Logger log = LoggerFactory.getLogger(GatewayClient.class);
    private static final int MAX_BODY_BYTES = 2 * 1024 * 1024;

    private final RestClient rest;
    private final String baseUrl;
    private final JsonMapper jsonMapper;
    private final McpServerProperties.Breaker breakerSettings;
    private final Clock clock;
    private final Map<String, CircuitBreaker> breakers = new ConcurrentHashMap<>();

    public GatewayClient(McpServerProperties properties, JsonMapper jsonMapper, Clock clock) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.gateway().connectTimeout())
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.gateway().readTimeout());
        this.rest = RestClient.builder().requestFactory(requestFactory).build();
        this.baseUrl = properties.gateway().url();
        this.jsonMapper = jsonMapper;
        this.breakerSettings = properties.breaker();
        this.clock = clock;
    }

    /**
     * GET {@code pathTemplate} ({@code "/api/bookings/{id}"}) with the variables encoded strictly and the query
     * parameters that are not null.
     */
    public JsonNode get(Caller caller, String pathTemplate, Map<String, ?> pathVariables, Map<String, ?> query) {
        MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
        query.forEach((name, value) -> {
            if (value != null && !value.toString().isBlank()) {
                params.add(name, value.toString());
            }
        });
        URI uri = UriComponentsBuilder.fromUriString(baseUrl).path(pathTemplate).queryParams(params).encode()
                .buildAndExpand(pathVariables).toUri();
        String area = area(pathTemplate);
        CircuitBreaker breaker = breakers.computeIfAbsent(area,
                key -> new CircuitBreaker(breakerSettings.failureThreshold(), breakerSettings.openFor(), clock));
        if (!breaker.tryAcquire()) {
            throw new DownstreamException(Kind.UNAVAILABLE, 503, "CIRCUIT_OPEN", area + " is unavailable (open circuit)");
        }
        for (int attempt = 1; ; attempt++) {
            long start = System.nanoTime();
            try {
                Response response = exchange(caller, uri);
                long durationMs = (System.nanoTime() - start) / 1_000_000;
                if (response.status() >= 500) {
                    if (attempt == 1 && retriable(response.status())) {
                        log.info("Gateway call retried: area={} status={} durationMs={}", area, response.status(),
                                durationMs);
                        continue;
                    }
                    breaker.onFailure();
                    log.warn("Gateway call failed: area={} status={} durationMs={}", area, response.status(),
                            durationMs);
                    throw new DownstreamException(Kind.UNAVAILABLE, response.status(), errorCode(response.body()),
                            area + " answered " + response.status());
                }
                breaker.onSuccess();
                if (response.status() >= 400) {
                    log.info("Gateway call refused: area={} status={} durationMs={}", area, response.status(),
                            durationMs);
                    throw new DownstreamException(DownstreamException.kindOf(response.status()), response.status(),
                            errorCode(response.body()), area + " answered " + response.status());
                }
                log.debug("Gateway call: area={} status={} durationMs={}", area, response.status(), durationMs);
                return parse(response.body());
            } catch (ResourceAccessException ex) {
                if (attempt == 1) {
                    log.info("Gateway call retried after an I/O error: area={} error={}", area,
                            ex.getClass().getSimpleName());
                    continue;
                }
                breaker.onFailure();
                log.warn("Gateway call failed: area={} error={}", area, rootCauseName(ex));
                throw new DownstreamException(Kind.UNAVAILABLE, 503, "GATEWAY_UNREACHABLE", area + " unreachable");
            }
        }
    }

    public JsonNode get(Caller caller, String path, Map<String, ?> query) {
        return get(caller, path, Map.of(), query);
    }

    private Response exchange(Caller caller, URI uri) {
        return rest.get().uri(uri)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + caller.accessToken())
                .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .headers(headers -> {
                    String correlationId = CorrelationId.current();
                    if (correlationId != null) {
                        headers.set(CorrelationId.HEADER, correlationId);
                    }
                })
                .exchange((request, response) -> {
                    byte[] body;
                    try (var in = response.getBody()) {
                        body = in.readNBytes(MAX_BODY_BYTES);
                        StreamUtils.drain(in);
                    } catch (IOException ex) {
                        throw new ResourceAccessException("Could not read the gateway response", ex);
                    }
                    return new Response(response.getStatusCode().value(), body);
                }, true);
    }

    private JsonNode parse(byte[] body) {
        if (body.length == 0) {
            return jsonMapper.nullNode();
        }
        try {
            return jsonMapper.readTree(new String(body, StandardCharsets.UTF_8));
        } catch (RuntimeException ex) {
            throw new DownstreamException(Kind.UNAVAILABLE, 502, "INVALID_RESPONSE", "Unreadable gateway response");
        }
    }

    private String errorCode(byte[] body) {
        try {
            JsonNode node = jsonMapper.readTree(new String(body, StandardCharsets.UTF_8));
            return node.path("code").asString(null);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static boolean retriable(int status) {
        return status == 502 || status == 503 || status == 504;
    }

    /** {@code /api/admin/payments/x} → {@code /api/admin/payments}; {@code /api/bookings/{id}} → {@code /api/bookings}. */
    static String area(String pathTemplate) {
        String[] parts = pathTemplate.split("/");
        int keep = parts.length > 2 && ("admin".equals(parts[2]) || "hotel-manager".equals(parts[2])
                || "support".equals(parts[2])) ? 4 : 3;
        StringBuilder area = new StringBuilder();
        for (int i = 1; i < Math.min(keep, parts.length); i++) {
            area.append('/').append(parts[i]);
        }
        return area.toString();
    }

    private static String rootCauseName(Throwable ex) {
        Throwable cause = ex;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause.getClass().getSimpleName();
    }

    private record Response(int status, byte[] body) {
    }
}
