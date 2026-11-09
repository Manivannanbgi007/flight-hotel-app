package com.flighthotel.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
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
 * {@code gateway.role-paths}: a signed-in user whose role has nothing to do with a staff area gets 403 at the gateway,
 * before any service reads (and validates) the request body. Allowed roles pass on to the route; the services are not
 * running here, so passing shows up as a 5xx from the dead upstream, never as 401/403.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.data.redis.port=6399",
        "IDENTITY_SERVICE_URL=http://127.0.0.1:9", "HOTEL_SERVICE_URL=http://127.0.0.1:9",
        "BOOKING_SERVICE_URL=http://127.0.0.1:9", "PAYMENT_SERVICE_URL=http://127.0.0.1:9",
        "NOTIFICATION_SERVICE_URL=http://127.0.0.1:9", "REPORTING_SERVICE_URL=http://127.0.0.1:9",
        "FLIGHT_SERVICE_URL=http://127.0.0.1:9", "SEARCH_SERVICE_URL=http://127.0.0.1:9"
})
class GatewayRolePathsTest {

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

    WebTestClient client;

    @BeforeEach
    void setUp() {
        client = WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build();
    }

    @Test
    void customersAreKeptOutOfEveryStaffArea() {
        String customer = token("CUSTOMER");
        for (String path : List.of("/api/admin/settings", "/api/admin/users", "/api/admin/bookings",
                "/api/hotel-manager/hotels", "/api/support/bookings", "/api/admin/support/tickets")) {
            assertThat(get(path, customer)).as(path).isEqualTo(HttpStatus.FORBIDDEN);
        }
        // A write with an invalid body: 403 at the gateway, so the caller never sees validation details.
        assertThat(client.post().uri("/api/admin/coupons").header(HttpHeaders.AUTHORIZATION, "Bearer " + customer)
                .header(HttpHeaders.CONTENT_TYPE, "application/json").bodyValue("{}")
                .exchange().returnResult(Void.class).getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void eachStaffRoleReachesOnlyItsAreas() {
        String manager = token("HOTEL_MANAGER");
        assertThat(get("/api/admin/bookings", manager)).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get("/api/support/bookings", manager)).isEqualTo(HttpStatus.FORBIDDEN);
        assertPassed(get("/api/hotel-manager/hotels", manager));

        String agent = token("SUPPORT_AGENT");
        assertThat(get("/api/hotel-manager/hotels", agent)).isEqualTo(HttpStatus.FORBIDDEN);
        assertPassed(get("/api/admin/support/tickets", agent));
        assertPassed(get("/api/support/bookings", agent));

        String admin = token("ADMIN");
        assertPassed(get("/api/admin/settings", admin));
        assertPassed(get("/api/hotel-manager/hotels", admin));
        assertPassed(get("/api/support/bookings", admin));
    }

    @Test
    void ordinaryRoutesOnlyNeedATokenAndPublicRoutesNone() {
        assertPassed(get("/api/bookings", token("CUSTOMER")));
        assertPassed(get("/api/hotels/search?city=Goa", null));
        assertThat(get("/api/admin/settings", null)).isEqualTo(HttpStatus.UNAUTHORIZED);
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
            return new RSAKeyGenerator(2048).keyID("gateway-test").generate();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
