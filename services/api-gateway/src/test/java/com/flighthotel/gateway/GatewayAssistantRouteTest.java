package com.flighthotel.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.cloud.gateway.filter.FilterDefinition;
import org.springframework.cloud.gateway.route.RouteDefinition;
import org.springframework.cloud.gateway.route.RouteDefinitionLocator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.web.reactive.server.WebTestClient;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * Phase 11: the assistant's routes. Every signed-in role may use the assistant (what it can read is decided by the
 * tools of the role, with the user's own token); without a token the gateway refuses. The chat streams, so its route
 * has no response timeout, and both routes have their own, stricter rate limit.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.data.redis.port=6399",
        "MCP_CLIENT_SERVICE_URL=http://127.0.0.1:9"
})
class GatewayAssistantRouteTest {

    static final RSAKey KEY = generateKey();

    @TestConfiguration
    static class LocalKeys {
        @Bean
        @Primary
        ReactiveJwtDecoder testJwtDecoder() throws JOSEException {
            NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withPublicKey(KEY.toRSAPublicKey()).build();
            decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer("flight-hotel-identity"));
            return decoder;
        }
    }

    @LocalServerPort
    int port;

    @Autowired
    RouteDefinitionLocator routes;

    WebTestClient client;

    @BeforeEach
    void setUp() {
        client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
    }

    @Test
    void theAssistantNeedsALoginAndIsOpenToEveryRole() {
        assertThat(chat(null)).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get("/api/assistant/config", null)).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get("/api/assistant/conversations/" + UUID.randomUUID(), null)).isEqualTo(HttpStatus.UNAUTHORIZED);
        for (String role : List.of("CUSTOMER", "ADMIN", "HOTEL_MANAGER", "SUPPORT_AGENT")) {
            assertPassed(chat(token(role)));
            assertPassed(get("/api/assistant/config", token(role)));
        }
    }

    @Test
    void theChatStreamsWithoutTimeoutAndHasItsOwnRateLimit() {
        RouteDefinition chat = route("assistant-chat");
        RouteDefinition rest = route("assistant");

        assertThat(chat.getPredicates().getFirst().getArgs()).containsValue("/api/assistant/chat");
        assertThat(chat.getOrder()).isLessThan(rest.getOrder());
        assertThat(chat.getMetadata()).containsEntry("response-timeout", -1);
        assertThat(rest.getMetadata()).containsEntry("response-timeout", 90000);
        assertThat(limiter(chat)).containsEntry("redis-rate-limiter.replenishRate", "1")
                .containsEntry("redis-rate-limiter.burstCapacity", "30")
                .containsEntry("redis-rate-limiter.requestedTokens", "10");
        assertThat(limiter(rest)).containsEntry("redis-rate-limiter.replenishRate", "2")
                .containsEntry("redis-rate-limiter.burstCapacity", "10");
        // The MCP server is never routed.
        assertThat(routes.getRouteDefinitions().collectList().block())
                .noneMatch(route -> route.getUri().toString().contains("8109"));
    }

    private RouteDefinition route(String id) {
        return routes.getRouteDefinitions().filter(route -> route.getId().equals(id)).blockFirst();
    }

    private static Map<String, String> limiter(RouteDefinition route) {
        return route.getFilters().stream().filter(filter -> filter.getName().equals("RequestRateLimiter"))
                .map(FilterDefinition::getArgs).findFirst().orElseThrow();
    }

    private HttpStatusCode chat(String token) {
        WebTestClient.RequestBodySpec request = client.post().uri("/api/assistant/chat")
                .contentType(MediaType.APPLICATION_JSON).accept(MediaType.TEXT_EVENT_STREAM);
        if (token != null) {
            request = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        }
        return request.bodyValue("{\"message\":\"hello\"}").exchange().returnResult(Void.class).getStatus();
    }

    private HttpStatusCode get(String path, String token) {
        WebTestClient.RequestHeadersSpec<?> request = client.get().uri(path);
        if (token != null) {
            request = request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
        }
        return request.exchange().returnResult(Void.class).getStatus();
    }

    private static void assertPassed(HttpStatusCode status) {
        assertThat(status.is5xxServerError()).as("passed the gateway's security (dead upstream → 5xx), got " + status)
                .isTrue();
    }

    private static String token(String role) {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer("flight-hotel-identity")
                    .subject(UUID.randomUUID().toString())
                    .claim("roles", List.of(role))
                    .issueTime(new Date())
                    .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY.getKeyID()).build(), claims);
            jwt.sign(new RSASSASigner(KEY));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    private static RSAKey generateKey() {
        try {
            return new RSAKeyGenerator(2048).keyID("gateway-assistant-test").generate();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
