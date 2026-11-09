package com.flighthotel.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.cloud.gateway.filter.FilterDefinition;
import org.springframework.cloud.gateway.route.RouteDefinition;
import org.springframework.cloud.gateway.route.RouteDefinitionLocator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.EntityExchangeResult;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.flighthotel.gateway.config.RateLimitConfig;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;

/**
 * The rate limits against a real Redis (Phase 11 fix). Before the fix, a route with its own limit (login, realtime,
 * assistant) also ran the default limit with the route's settings on the same bucket: every request was charged twice
 * (a login burst of 5 instead of 10, one assistant question instead of 3). Upstreams are a stub that answers 200, so the
 * gateway's own headers can be read.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayRateLimitIntegrationTest {

    @Container
    @ServiceConnection(name = "redis")
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.4.8").withExposedPorts(6379);

    static final RSAKey KEY = generateKey();
    static final HttpServer UPSTREAM = startUpstream();

    @DynamicPropertySource
    static void upstreams(DynamicPropertyRegistry registry) {
        String url = "http://127.0.0.1:" + UPSTREAM.getAddress().getPort();
        for (String name : List.of("IDENTITY_SERVICE_URL", "HOTEL_SERVICE_URL", "BOOKING_SERVICE_URL",
                "NOTIFICATION_SERVICE_URL", "MCP_CLIENT_SERVICE_URL")) {
            registry.add(name, () -> url);
        }
    }

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

    @AfterAll
    static void stopUpstream() {
        UPSTREAM.stop(0);
    }

    @Test
    void aLoginIsChargedOnceFromItsOwnBucketPerIp() {
        EntityExchangeResult<byte[]> first = login("203.0.113.11");
        EntityExchangeResult<byte[]> otherIp = login("203.0.113.12");

        assertThat(first.getStatus()).isEqualTo(HttpStatus.OK);
        // One limiter ran (one header value), with the login settings, and took one token of 10.
        assertThat(first.getResponseHeaders().get("X-RateLimit-Remaining")).containsExactly("9");
        assertThat(first.getResponseHeaders().get("X-RateLimit-Burst-Capacity")).containsExactly("10");
        // Another IP has its own bucket.
        assertThat(otherIp.getResponseHeaders().get("X-RateLimit-Remaining")).containsExactly("9");
    }

    @Test
    void tenLoginsInARowAreAllowed() {
        long allowed = 0;
        for (int i = 0; i < 12; i++) {
            if (login("203.0.113.21").getStatus().value() != 429) {
                allowed++;
            }
        }
        // Burst 10 (plus at most what 2 tokens/second refill meanwhile). Charged twice it was 5.
        assertThat(allowed).isBetween(10L, 12L);
    }

    @Test
    void browsingDoesNotUseUpTheLoginAllowanceOfTheSameIp() {
        String ip = "203.0.113.31";
        boolean limited = false;
        // Up to 300 tries: the bucket refills 20 tokens each whole second, so the loop must outrun the refill.
        for (int i = 0; i < 300 && !limited; i++) {
            limited = client.get().uri("/api/hotels").header("X-Forwarded-For", ip).exchange()
                    .returnResult(Void.class).getStatus().value() == 429;
        }
        assertThat(limited).as("the default limit (burst 40) stops anonymous browsing").isTrue();

        EntityExchangeResult<byte[]> login = login(ip);

        assertThat(login.getStatus()).isEqualTo(HttpStatus.OK);
        assertThat(login.getResponseHeaders().get("X-RateLimit-Remaining")).containsExactly("9");
    }

    @Test
    void theDefaultLimitCountsPerUserAndRoute() {
        String token = token("CUSTOMER");
        boolean limited = false;
        for (int i = 0; i < 300 && !limited; i++) {
            limited = get("/api/hotels", token).getStatus().value() == 429;
        }
        assertThat(limited).as("the default limit (burst 40) stops one user on one route").isTrue();

        // The Redis key includes the route id: another route of the same user has its own, full bucket.
        EntityExchangeResult<byte[]> bookings = get("/api/bookings", token);
        assertThat(bookings.getStatus()).isEqualTo(HttpStatus.OK);
        assertThat(bookings.getResponseHeaders().get("X-RateLimit-Remaining")).containsExactly("39");
        assertThat(bookings.getResponseHeaders().get("X-RateLimit-Burst-Capacity")).containsExactly("40");
    }

    @Test
    void anAssistantQuestionCostsTenTokensOnceSoThreeFitInTheBurst() {
        String token = token("CUSTOMER");

        EntityExchangeResult<byte[]> first = chat(token);
        int second = chat(token).getStatus().value();
        int third = chat(token).getStatus().value();

        assertThat(first.getStatus()).isEqualTo(HttpStatus.OK);
        assertThat(first.getResponseHeaders().get("X-RateLimit-Requested-Tokens")).containsExactly("10");
        assertThat(first.getResponseHeaders().get("X-RateLimit-Remaining")).containsExactly("20");
        assertThat(List.of(second, third)).containsOnly(200);
        // The assistant's bucket is not the default one.
        assertThat(get("/api/hotels", token).getResponseHeaders().get("X-RateLimit-Remaining")).containsExactly("39");
    }

    @Test
    void everyRouteWithItsOwnLimiterIsMarkedSoTheDefaultStepsAside() {
        List<RouteDefinition> all = routes.getRouteDefinitions().collectList().block();
        assertThat(all).isNotEmpty();
        List<String> withOwnLimit = all.stream().filter(route -> limiter(route) != null).map(RouteDefinition::getId).toList();
        assertThat(withOwnLimit).containsExactlyInAnyOrder("realtime", "assistant-chat", "assistant", "identity-auth");

        for (RouteDefinition route : all) {
            Map<String, String> limiter = limiter(route);
            boolean marked = Boolean.parseBoolean(String.valueOf(route.getMetadata().get(RateLimitConfig.OWN_LIMIT)));
            assertThat(marked).as("route %s: metadata %s", route.getId(), RateLimitConfig.OWN_LIMIT).isEqualTo(limiter != null);
        }
    }

    private static Map<String, String> limiter(RouteDefinition route) {
        return route.getFilters().stream().filter(filter -> filter.getName().equals("RequestRateLimiter"))
                .map(FilterDefinition::getArgs).findFirst().orElse(null);
    }

    private EntityExchangeResult<byte[]> login(String ip) {
        return client.post().uri("/api/auth/login").header("X-Forwarded-For", ip)
                .contentType(MediaType.APPLICATION_JSON).bodyValue("{}")
                .exchange().expectBody().returnResult();
    }

    private EntityExchangeResult<byte[]> chat(String token) {
        return client.post().uri("/api/assistant/chat").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).bodyValue("{\"message\":\"hello\"}")
                .exchange().expectBody().returnResult();
    }

    private EntityExchangeResult<byte[]> get(String path, String token) {
        return client.get().uri(path).header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange().expectBody().returnResult();
    }

    private static HttpServer startUpstream() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
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
            return new RSAKeyGenerator(2048).keyID("gateway-rate-limit-test").generate();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
