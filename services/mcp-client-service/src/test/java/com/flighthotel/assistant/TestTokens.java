package com.flighthotel.assistant;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import com.flighthotel.testsupport.RoleTokens;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * Real RS256 access tokens for tests that go over HTTP (like identity-service issues them: sub, email, roles,
 * permissions from {@link RoleTokens#PERMISSIONS}), and a {@link JwtDecoder} that trusts the test key.
 */
public final class TestTokens {

    public static final String ISSUER = "flight-hotel-identity";
    private static final RSAKey KEY = generate();

    private TestTokens() {
    }

    /** A token of a new user with this role. */
    public static String token(String role) {
        return token(UUID.randomUUID(), role, Instant.now().plusSeconds(300));
    }

    public static String token(UUID userId, String role, Instant expiresAt) {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(ISSUER)
                    .subject(userId.toString())
                    .claim("email", role.toLowerCase() + "-" + userId + "@example.com")
                    .claim("roles", List.of(role))
                    .claim("permissions", List.copyOf(RoleTokens.PERMISSIONS.get(role)))
                    .jwtID(UUID.randomUUID().toString())
                    .issueTime(new Date())
                    .expirationTime(Date.from(expiresAt))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY.getKeyID()).build(),
                    claims);
            jwt.sign(new RSASSASigner(KEY));
            return jwt.serialize();
        } catch (JOSEException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static RSAKey generate() {
        try {
            return new RSAKeyGenerator(2048).keyID("assistant-test").generate();
        } catch (JOSEException ex) {
            throw new IllegalStateException(ex);
        }
    }

    @TestConfiguration
    public static class LocalKeys {
        @Bean
        @Primary
        JwtDecoder testJwtDecoder() throws JOSEException {
            NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(KEY.toRSAPublicKey()).build();
            decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(ISSUER));
            return decoder;
        }
    }
}
